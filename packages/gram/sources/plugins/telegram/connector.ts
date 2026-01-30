import { promises as fs } from "node:fs";
import path from "node:path";

import TelegramBot from "node-telegram-bot-api";

import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler
} from "../../engine/connectors/types.js";
import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { FileReference } from "../../files/types.js";

export type TelegramConnectorOptions = {
  token: string;
  polling?: boolean;
  clearWebhook?: boolean;
  statePath?: string | null;
  fileStore: FileStore;
  dataDir: string;
  retry?: {
    minDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: number;
  };
  enableGracefulShutdown?: boolean;
  onFatal?: (reason: string, error?: unknown) => void;
};

const logger = getLogger("connector.telegram");

export class TelegramConnector implements Connector {
  private bot: TelegramBot;
  private handlers: MessageHandler[] = [];
  private pollingEnabled: boolean;
  private statePath: string | null;
  private lastUpdateId: number | null = null;
  private fileStore: FileStore;
  private dataDir: string;
  private retryAttempt = 0;
  private pendingRetry: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private typingTimers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
  private retryOptions?: TelegramConnectorOptions["retry"];
  private clearWebhookOnStart: boolean;
  private clearedWebhook = false;
  private onFatal?: TelegramConnectorOptions["onFatal"];

  constructor(options: TelegramConnectorOptions) {
    logger.debug(`TelegramConnector constructor polling=${options.polling} clearWebhook=${options.clearWebhook} dataDir=${options.dataDir}`);
    this.pollingEnabled = options.polling ?? true;
    this.clearWebhookOnStart = options.clearWebhook ?? true;
    this.retryOptions = options.retry;
    this.onFatal = options.onFatal;
    this.fileStore = options.fileStore;
    this.dataDir = options.dataDir;
    this.statePath =
      options.statePath === undefined
        ? path.join(this.dataDir, "telegram-offset.json")
        : options.statePath;
    if (this.statePath) {
      this.statePath = path.resolve(this.statePath);
    }
    logger.debug(`State path configured statePath=${this.statePath} pollingEnabled=${this.pollingEnabled}`);

    this.bot = new TelegramBot(options.token, { polling: false });
    logger.debug("TelegramBot instance created");

    const originalProcessUpdate = this.bot.processUpdate.bind(this.bot);
    this.bot.processUpdate = (update: TelegramBot.Update) => {
      logger.debug(`Processing Telegram update updateId=${update.update_id}`);
      this.trackUpdate(update);
      return originalProcessUpdate(update);
    };

    this.bot.on("message", async (message) => {
      logger.debug(`Received Telegram message chatId=${message.chat.id} fromId=${message.from?.id} messageId=${message.message_id} hasText=${!!message.text} hasCaption=${!!message.caption} hasPhoto=${!!message.photo} hasDocument=${!!message.document}`);
      const files = await this.extractFiles(message);
      logger.debug(`Extracted files from message fileCount=${files.length}`);
      const payload: ConnectorMessage = {
        text: typeof message.text === "string" ? message.text : message.caption ?? null,
        files: files.length > 0 ? files : undefined
      };

      const context: MessageContext = {
        channelId: String(message.chat.id),
        userId: message.from ? String(message.from.id) : null,
        messageId: message.message_id ? String(message.message_id) : undefined,
        threadId: message.message_thread_id
          ? String(message.message_thread_id)
          : undefined
      };

      logger.debug(`Dispatching to handlers handlerCount=${this.handlers.length} channelId=${context.channelId}`);
      for (const handler of this.handlers) {
        await handler(payload, context);
      }
      logger.debug(`All handlers completed channelId=${context.channelId}`);
    });

    this.bot.on("polling_error", (error) => {
      if (this.shuttingDown) {
        return;
      }
      this.scheduleRetry(error);
    });

    if (options.enableGracefulShutdown ?? true) {
      this.attachSignalHandlers();
    }

    void this.initialize();
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index !== -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  async sendMessage(targetId: string, message: ConnectorMessage): Promise<void> {
    logger.debug(`sendMessage() called targetId=${targetId} hasText=${!!message.text} textLength=${message.text?.length ?? 0} fileCount=${message.files?.length ?? 0} replyTo=${message.replyToMessageId}`);
    const files = message.files ?? [];
    if (files.length === 0) {
      logger.debug(`Sending text-only message targetId=${targetId}`);
      await this.bot.sendMessage(targetId, message.text ?? "", buildReplyOptions(message));
      logger.debug(`Text message sent targetId=${targetId}`);
      return;
    }

    const first = files[0];
    if (!first) {
      logger.debug("No first file found, returning");
      return;
    }
    const rest = files.slice(1);
    const caption = message.text ?? undefined;
    logger.debug(`Sending first file targetId=${targetId} fileName=${first.name} mimeType=${first.mimeType} hasCaption=${!!caption}`);
    await this.sendFile(targetId, first, caption, buildReplyOptions(message));
    for (const file of rest) {
      logger.debug(`Sending additional file targetId=${targetId} fileName=${file.name} mimeType=${file.mimeType}`);
      await this.sendFile(targetId, file);
    }
    logger.debug(`All files sent targetId=${targetId} totalFiles=${files.length}`);
  }

  startTyping(targetId: string): () => void {
    const key = String(targetId);
    if (this.typingTimers.has(key)) {
      return () => {
        this.stopTyping(key);
      };
    }

    const send = () => {
      void this.bot.sendChatAction(targetId, "typing").catch((error) => {
        logger.warn({ error }, "Telegram typing failed");
      });
    };

    send();
    const timer = setInterval(send, 4000);
    this.typingTimers.set(key, timer);

    return () => {
      this.stopTyping(key);
    };
  }

  async setReaction(
    targetId: string,
    messageId: string,
    reaction: string
  ): Promise<void> {
    const emoji = reaction as TelegramBot.TelegramEmoji;
    await this.bot.setMessageReaction(targetId, Number(messageId), {
      reaction: [{ type: "emoji", emoji }]
    });
  }

  private async sendFile(
    targetId: string,
    file: FileReference,
    caption?: string,
    replyOptions?: TelegramBot.SendMessageOptions
  ): Promise<void> {
    const options = replyOptions && caption
      ? { ...replyOptions, caption }
      : caption
        ? { caption }
        : replyOptions;
    if (file.mimeType.startsWith("image/")) {
      await this.bot.sendPhoto(targetId, file.path, options as TelegramBot.SendPhotoOptions | undefined);
      return;
    }
    await this.bot.sendDocument(targetId, file.path, options as TelegramBot.SendDocumentOptions | undefined);
  }

  private async initialize(): Promise<void> {
    logger.debug(`initialize() starting pollingEnabled=${this.pollingEnabled} clearWebhookOnStart=${this.clearWebhookOnStart}`);
    if (this.pollingEnabled && this.clearWebhookOnStart) {
      logger.debug("Clearing webhook before polling");
      await this.ensureWebhookCleared();
    }
    logger.debug("Loading state");
    await this.loadState();
    if (this.pollingEnabled) {
      logger.debug("Starting polling");
      await this.startPolling();
    }
    logger.debug("initialize() complete");
  }

  private trackUpdate(update: TelegramBot.Update): void {
    if (typeof update.update_id !== "number") {
      return;
    }

    if (this.lastUpdateId === null || update.update_id > this.lastUpdateId) {
      this.lastUpdateId = update.update_id;
      this.schedulePersist();
    }
  }

  private async loadState(): Promise<void> {
    if (!this.statePath) {
      return;
    }

    try {
      const content = await fs.readFile(this.statePath, "utf8");
      const parsed = JSON.parse(content) as { lastUpdateId?: number };
      if (typeof parsed.lastUpdateId === "number") {
        this.lastUpdateId = parsed.lastUpdateId;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn({ error }, "Telegram connector state load failed");
      }
    }
  }

  private schedulePersist(): void {
    if (!this.statePath || this.persistTimer) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      void this.persistState();
    }, 500);
  }

  private async persistState(): Promise<void> {
    if (!this.statePath || this.lastUpdateId === null) {
      return;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    try {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      const payload = JSON.stringify({ lastUpdateId: this.lastUpdateId });
      await fs.writeFile(this.statePath, payload, "utf8");
    } catch (error) {
      logger.warn({ error }, "Telegram connector state persist failed");
    }
  }

  private async startPolling(): Promise<void> {
    logger.debug(`startPolling() called pollingEnabled=${this.pollingEnabled} isPolling=${this.bot.isPolling()}`);
    if (!this.pollingEnabled) {
      logger.debug("Polling disabled, returning");
      return;
    }

    if (this.bot.isPolling()) {
      logger.debug("Already polling, returning");
      return;
    }

    const pollingOptions: TelegramBot.PollingOptions = {
      autoStart: true,
      params: {}
    };

    if (this.lastUpdateId !== null) {
      pollingOptions.params = {
        offset: this.lastUpdateId + 1
      };
      logger.debug(`Resuming from last update ID offset=${this.lastUpdateId + 1}`);
    }

    try {
      logger.debug("Starting Telegram polling");
      await this.bot.startPolling({
        restart: true,
        polling: pollingOptions
      });
      this.retryAttempt = 0;
      logger.debug("Telegram polling started successfully");
    } catch (error) {
      logger.debug(`Polling start failed, scheduling retry error=${String(error)}`);
      this.scheduleRetry(error);
    }
  }

  private scheduleRetry(error: unknown): void {
    if (this.pendingRetry) {
      return;
    }

    if (isTelegramConflictError(error)) {
      if (!this.clearedWebhook) {
        logger.warn(
          { error },
          "Telegram polling conflict; clearing webhook and retrying"
        );
        this.pendingRetry = setTimeout(() => {
          this.pendingRetry = null;
          void this.ensureWebhookCleared().then(() => this.restartPolling());
        }, 1000);
        return;
      }

      this.pollingEnabled = false;
      logger.warn(
        { error },
        "Telegram polling stopped (another instance is polling)"
      );
      void this.stopPolling("conflict");
      this.onFatal?.("polling_conflict", error);
      return;
    }

    const delayMs = this.nextRetryDelay();
    logger.warn(
      { error, delayMs },
      "Telegram polling error, retrying"
    );

    this.pendingRetry = setTimeout(() => {
      this.pendingRetry = null;
      void this.restartPolling();
    }, delayMs);
  }

  private async restartPolling(): Promise<void> {
    if (this.shuttingDown || !this.pollingEnabled) {
      return;
    }

    try {
      if (this.bot.isPolling()) {
        await this.bot.stopPolling({ cancel: true, reason: "retry" });
      }
    } catch (error) {
      logger.warn({ error }, "Telegram polling stop failed");
    }

    await this.startPolling();
  }

  private nextRetryDelay(): number {
    const config = this.retryConfig();
    const baseDelay =
      config.minDelayMs * Math.pow(config.factor, this.retryAttempt);
    const cappedDelay = Math.min(config.maxDelayMs, baseDelay);
    const jitterSpan = cappedDelay * config.jitter;
    const jitteredDelay = cappedDelay + (Math.random() * 2 - 1) * jitterSpan;

    this.retryAttempt += 1;

    return Math.max(0, Math.floor(jitteredDelay));
  }

  private retryConfig(): Required<NonNullable<TelegramConnectorOptions["retry"]>> {
    return {
      minDelayMs: 1000,
      maxDelayMs: 30000,
      factor: 2,
      jitter: 0.2,
      ...(this.retryOptions ?? {})
    };
  }

  private attachSignalHandlers(): void {
    const handler = (signal: NodeJS.Signals) => {
      void this.shutdown(signal);
    };

    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  }

  async shutdown(reason: string = "shutdown"): Promise<void> {
    logger.debug(`shutdown() called reason=${reason} alreadyShuttingDown=${this.shuttingDown}`);
    if (this.shuttingDown) {
      logger.debug("Already shutting down, returning");
      return;
    }

    this.shuttingDown = true;
    logger.debug("Beginning shutdown sequence");

    if (this.pendingRetry) {
      logger.debug("Clearing pending retry timer");
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }

    if (this.persistTimer) {
      logger.debug("Clearing persist timer");
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    logger.debug(`Clearing typing timers typingTimerCount=${this.typingTimers.size}`);
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();

    try {
      logger.debug("Stopping polling");
      await this.bot.stopPolling({ cancel: true, reason });
      logger.debug("Polling stopped");
    } catch (error) {
      logger.warn({ error }, "Telegram polling stop failed");
    }

    logger.debug("Persisting state");
    await this.persistState();
    logger.debug("Shutdown complete");
  }

  private async stopPolling(reason: string): Promise<void> {
    try {
      if (this.bot.isPolling()) {
        await this.bot.stopPolling({ cancel: true, reason });
      }
    } catch (error) {
      logger.warn({ error }, "Telegram polling stop failed");
    }
  }

  private async ensureWebhookCleared(): Promise<void> {
    if (this.clearedWebhook) {
      return;
    }

    try {
      await this.bot.deleteWebHook();
      this.clearedWebhook = true;
      logger.info("Telegram webhook cleared for polling");
    } catch (error) {
      logger.warn({ error }, "Failed to clear Telegram webhook");
    }
  }

  private stopTyping(key: string): void {
    const timer = this.typingTimers.get(key);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.typingTimers.delete(key);
  }

  private async extractFiles(message: TelegramBot.Message): Promise<FileReference[]> {
    const files: FileReference[] = [];
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo.reduce((prev, current) =>
        (current.file_size ?? 0) > (prev.file_size ?? 0) ? current : prev
      );
      const stored = await this.downloadFile(
        largest.file_id,
        `photo-${largest.file_id}.jpg`,
        "image/jpeg"
      );
      if (stored) {
        files.push(stored);
      }
    }

    if (message.document?.file_id) {
      const stored = await this.downloadFile(
        message.document.file_id,
        message.document.file_name ?? `document-${message.document.file_id}`,
        message.document.mime_type ?? "application/octet-stream"
      );
      if (stored) {
        files.push(stored);
      }
    }

    return files;
  }

  private async downloadFile(
    fileId: string,
    name: string,
    mimeType: string
  ): Promise<FileReference | null> {
    const downloadDir = path.join(this.dataDir, "downloads");
    await fs.mkdir(downloadDir, { recursive: true });
    try {
      const downloadedPath = await this.bot.downloadFile(fileId, downloadDir);
      const stored = await this.fileStore.saveFromPath({
        name,
        mimeType,
        source: "telegram",
        path: downloadedPath
      });
      await fs.rm(downloadedPath, { force: true });
      return {
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        path: stored.path
      };
    } catch (error) {
      logger.warn({ error }, "Telegram file download failed");
      return null;
    }
  }
}

function isTelegramConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as {
    code?: string;
    response?: { statusCode?: number; body?: { error_code?: number } };
  };

  const status = maybe.response?.statusCode ?? maybe.response?.body?.error_code;
  return maybe.code === "ETELEGRAM" && status === 409;
}

function buildReplyOptions(message: ConnectorMessage): TelegramBot.SendMessageOptions | undefined {
  const replyTo = message.replyToMessageId
    ? Number(message.replyToMessageId)
    : undefined;
  const threadId = message.threadId
    ? Number(message.threadId)
    : undefined;

  if (!Number.isFinite(replyTo ?? NaN) && !Number.isFinite(threadId ?? NaN)) {
    return undefined;
  }

  return {
    ...(Number.isFinite(replyTo ?? NaN) ? { reply_to_message_id: replyTo as number } : {}),
    ...(Number.isFinite(threadId ?? NaN) ? { message_thread_id: threadId as number } : {}),
    allow_sending_without_reply: true
  };
}
