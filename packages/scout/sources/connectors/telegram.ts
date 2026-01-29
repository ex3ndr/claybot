import { promises as fs } from "node:fs";
import path from "node:path";

import TelegramBot from "node-telegram-bot-api";

import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler
} from "./types.js";
import { getLogger } from "../log.js";
import type { FileStore } from "../files/store.js";
import type { FileReference } from "../files/types.js";

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

const DEFAULT_STATE_PATH = ".scout/telegram-offset.json";
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
    this.pollingEnabled = options.polling ?? true;
    this.clearWebhookOnStart = options.clearWebhook ?? true;
    this.retryOptions = options.retry;
    this.onFatal = options.onFatal;
    this.fileStore = options.fileStore;
    this.dataDir = options.dataDir;
    this.statePath =
      options.statePath === undefined ? DEFAULT_STATE_PATH : options.statePath;
    if (this.statePath) {
      this.statePath = path.resolve(this.statePath);
    }

    this.bot = new TelegramBot(options.token, { polling: false });

    const originalProcessUpdate = this.bot.processUpdate.bind(this.bot);
    this.bot.processUpdate = (update: TelegramBot.Update) => {
      this.trackUpdate(update);
      return originalProcessUpdate(update);
    };

    this.bot.on("message", async (message) => {
      const files = await this.extractFiles(message);
      const payload: ConnectorMessage = {
        text: typeof message.text === "string" ? message.text : message.caption ?? null,
        files: files.length > 0 ? files : undefined
      };

      const context: MessageContext = {
        channelId: String(message.chat.id),
        userId: message.from ? String(message.from.id) : null,
        messageId: message.message_id ? String(message.message_id) : undefined
      };

      for (const handler of this.handlers) {
        await handler(payload, context);
      }
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
    const files = message.files ?? [];
    if (files.length === 0) {
      await this.bot.sendMessage(targetId, message.text ?? "");
      return;
    }

    const first = files[0];
    if (!first) {
      return;
    }
    const rest = files.slice(1);
    const caption = message.text ?? undefined;
    await this.sendFile(targetId, first, caption);
    for (const file of rest) {
      await this.sendFile(targetId, file);
    }
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
    caption?: string
  ): Promise<void> {
    if (file.mimeType.startsWith("image/")) {
      await this.bot.sendPhoto(targetId, file.path, caption ? { caption } : undefined);
      return;
    }
    await this.bot.sendDocument(targetId, file.path, caption ? { caption } : undefined);
  }

  private async initialize(): Promise<void> {
    if (this.pollingEnabled && this.clearWebhookOnStart) {
      await this.ensureWebhookCleared();
    }
    await this.loadState();
    if (this.pollingEnabled) {
      await this.startPolling();
    }
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
    if (!this.pollingEnabled) {
      return;
    }

    if (this.bot.isPolling()) {
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
    }

    try {
      await this.bot.startPolling({
        restart: true,
        polling: pollingOptions
      });
      this.retryAttempt = 0;
    } catch (error) {
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
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;

    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();

    try {
      await this.bot.stopPolling({ cancel: true, reason });
    } catch (error) {
      logger.warn({ error }, "Telegram polling stop failed");
    }

    await this.persistState();
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
