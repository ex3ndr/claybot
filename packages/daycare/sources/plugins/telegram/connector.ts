import { promises as fs } from "node:fs";
import path from "node:path";

import TelegramBot from "node-telegram-bot-api";

import type {
  Connector,
  ConnectorMessage,
  ConnectorFile,
  ConnectorCapabilities,
  MessageContext,
  MessageHandler,
  CommandHandler,
  AgentDescriptor,
  PermissionDecision,
  PermissionHandler,
  PermissionRequest,
  FileReference
} from "@/types";
import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import { markdownToTelegramHtml } from "./markdownToTelegramHtml.js";
import { telegramMessageSplit } from "./telegramMessageSplit.js";

export type TelegramConnectorOptions = {
  token: string;
  allowedUids: string[];
  polling?: boolean;
  clearWebhook?: boolean;
  statePath?: string | null;
  fileStore: FileStore;
  dataDir: string;
  enableGracefulShutdown?: boolean;
  onFatal?: (reason: string, error?: unknown) => void;
};

const logger = getLogger("plugin.telegram");

const TELEGRAM_MESSAGE_FORMAT_PROMPT = [
  "Format messages using GitHub-flavored markdown (GFM).",
  "Supported: **bold**, *italic*, ~~strikethrough~~, `inline code`, ```code blocks``` (with optional language), [links](url), > blockquotes, and lists (- or 1.).",
  "Headers (# Title) render as bold text.",
  "Tables render as plain text.",
  "Task lists (- [x] item) render with checkbox symbols.",
  "Do NOT use raw HTML tags; they will be escaped.",
  "Keep formatting simple and well-nested."
].join(" ");

const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;

export class TelegramConnector implements Connector {
  capabilities: ConnectorCapabilities = {
    sendText: true,
    sendFiles: {
      modes: ["document", "photo", "video"]
    },
    messageFormatPrompt: TELEGRAM_MESSAGE_FORMAT_PROMPT,
    reactions: true,
    typing: true
  };
  private bot: TelegramBot;
  private handlers: MessageHandler[] = [];
  private commandHandlers: CommandHandler[] = [];
  private permissionHandlers: PermissionHandler[] = [];
  private pollingEnabled: boolean;
  private statePath: string | null;
  private lastUpdateId: number | null = null;
  private fileStore: FileStore;
  private dataDir: string;
  private persistTimer: NodeJS.Timeout | null = null;
  private typingTimers = new Map<string, NodeJS.Timeout>();
  private startingPolling = false;
  private allowedUids: Set<string>;
  private pendingPermissions = new Map<
    string,
    { request: PermissionRequest; context: MessageContext; descriptor: AgentDescriptor }
  >();
  private shuttingDown = false;
  private clearWebhookOnStart: boolean;
  private clearedWebhook = false;

  constructor(options: TelegramConnectorOptions) {
    logger.debug(`TelegramConnector constructor polling=${options.polling} clearWebhook=${options.clearWebhook} dataDir=${options.dataDir}`);
    this.pollingEnabled = options.polling ?? true;
    this.clearWebhookOnStart = options.clearWebhook ?? true;
    this.fileStore = options.fileStore;
    this.dataDir = options.dataDir;
    this.allowedUids = new Set(options.allowedUids.map((uid) => String(uid)));
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
      if (message.chat?.type !== "private") {
        logger.debug(`Skipping non-private chat type=${message.chat?.type} chatId=${message.chat?.id}`);
        return;
      }
      const senderId = message.from?.id ?? message.chat?.id;
      if (!this.isAllowedUid(senderId)) {
        logger.info({ senderId, chatId: message.chat?.id }, "Skipping telegram message from unapproved uid");
        return;
      }
      logger.debug(`Received Telegram message chatId=${message.chat.id} fromId=${message.from?.id} messageId=${message.message_id} hasText=${!!message.text} hasCaption=${!!message.caption} hasPhoto=${!!message.photo} hasDocument=${!!message.document}`);
      const rawText = typeof message.text === "string" ? message.text : null;
      const trimmedText = rawText?.trim() ?? "";
      const isCommand = trimmedText.startsWith("/");

      const descriptor: AgentDescriptor = {
        type: "user",
        connector: "telegram",
        userId: String(message.from?.id ?? message.chat.id),
        channelId: String(message.chat.id)
      };
      const context: MessageContext = {
        messageId: message.message_id ? String(message.message_id) : undefined
      };

      if (isCommand && rawText) {
        logger.debug(
          `Dispatching to command handlers handlerCount=${this.commandHandlers.length} channelId=${descriptor.channelId}`
        );
        for (const handler of this.commandHandlers) {
          await handler(rawText, context, descriptor);
        }
        logger.debug(`All command handlers completed channelId=${descriptor.channelId}`);
        return;
      }

      const files = await this.extractFiles(message);
      logger.debug(`Extracted files from message fileCount=${files.length}`);
      const payload: ConnectorMessage = {
        text: rawText ?? message.caption ?? null,
        files: files.length > 0 ? files : undefined
      };

      logger.debug(
        `Dispatching to handlers handlerCount=${this.handlers.length} channelId=${descriptor.channelId}`
      );
      for (const handler of this.handlers) {
        await handler(payload, context, descriptor);
      }
      logger.debug(`All handlers completed channelId=${descriptor.channelId}`);
    });

    this.bot.on("callback_query", async (query) => {
      if (!this.isAllowedUid(query.from?.id)) {
        logger.info({ senderId: query.from?.id }, "Skipping telegram callback from unapproved uid");
        return;
      }
      const data = query.data;
      if (!data || !data.startsWith("perm:")) {
        return;
      }
      const parts = data.split(":");
      if (parts.length < 3) {
        return;
      }
      const action = parts[1];
      const token = parts[2];
      if (!token) {
        return;
      }
      const pending = this.pendingPermissions.get(token);
      if (!pending) {
        await this.bot.answerCallbackQuery(query.id, {
          text: "Permission request expired."
        });
        return;
      }
      this.pendingPermissions.delete(token);
      const approved = action === "allow";
      await this.updatePermissionMessage(query, pending.request, approved ? "approved" : "denied");
      const decision: PermissionDecision = {
        token,
        agentId: pending.request.agentId,
        approved,
        permission: pending.request.permission,
        access: pending.request.access
      };
      for (const handler of this.permissionHandlers) {
        await handler(decision, pending.context, pending.descriptor);
      }
      await this.bot.answerCallbackQuery(query.id, {
        text: approved ? "Permission granted." : "Permission denied."
      });
    });

    this.bot.on("polling_error", (error) => {
      if (this.shuttingDown) {
        return;
      }
      this.handlePollingError(error);
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

  onCommand(handler: CommandHandler): () => void {
    this.commandHandlers.push(handler);
    return () => {
      const index = this.commandHandlers.indexOf(handler);
      if (index !== -1) {
        this.commandHandlers.splice(index, 1);
      }
    };
  }

  onPermission(handler: PermissionHandler): () => void {
    this.permissionHandlers.push(handler);
    return () => {
      const index = this.permissionHandlers.indexOf(handler);
      if (index !== -1) {
        this.permissionHandlers.splice(index, 1);
      }
    };
  }

  async sendMessage(targetId: string, message: ConnectorMessage): Promise<void> {
    logger.debug(`sendMessage() called targetId=${targetId} hasText=${!!message.text} textLength=${message.text?.length ?? 0} fileCount=${message.files?.length ?? 0}`);
    if (!this.isAllowedTarget(targetId, "sendMessage")) {
      return;
    }
    const files = message.files ?? [];
    if (files.length === 0) {
      logger.debug(`Sending text-only message targetId=${targetId}`);
      await this.sendTextWithFallback(targetId, message.text ?? "");
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
    const captionChunks = caption ? telegramMessageSplit(caption, TELEGRAM_CAPTION_MAX_LENGTH) : [];
    const sendCaption = captionChunks.length === 1 ? captionChunks[0] : undefined;
    if (!sendCaption && caption) {
      logger.debug(`Caption too long for Telegram; sending as separate message targetId=${targetId} captionLength=${caption.length}`);
    }
    logger.debug(`Sending first file targetId=${targetId} fileName=${first.name} mimeType=${first.mimeType} hasCaption=${!!sendCaption}`);
    await this.sendFile(targetId, first, sendCaption);
    for (const file of rest) {
      logger.debug(`Sending additional file targetId=${targetId} fileName=${file.name} mimeType=${file.mimeType}`);
      await this.sendFile(targetId, file);
    }
    if (!sendCaption && caption) {
      await this.sendTextWithFallback(targetId, caption);
    }
    logger.debug(`All files sent targetId=${targetId} totalFiles=${files.length}`);
  }

  async requestPermission(
    targetId: string,
    request: PermissionRequest,
    context: MessageContext,
    descriptor: AgentDescriptor
  ): Promise<void> {
    if (!this.isAllowedTarget(targetId, "requestPermission")) {
      return;
    }
    const { text, parseMode } = formatPermissionMessage(request, "pending");
    this.pendingPermissions.set(request.token, { request, context, descriptor });
    await this.bot.sendMessage(targetId, text, {
      parse_mode: parseMode,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Allow", callback_data: `perm:allow:${request.token}` },
            { text: "Deny", callback_data: `perm:deny:${request.token}` }
          ]
        ]
      }
    });
  }

  startTyping(targetId: string): () => void {
    if (!this.isAllowedTarget(targetId, "startTyping")) {
      return () => undefined;
    }
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
    if (!this.isAllowedTarget(targetId, "setReaction")) {
      return;
    }
    const emoji = reaction as TelegramBot.TelegramEmoji;
    await this.bot.setMessageReaction(targetId, Number(messageId), {
      reaction: [{ type: "emoji", emoji }]
    });
  }

  private async sendFile(
    targetId: string,
    file: ConnectorFile,
    caption?: string
  ): Promise<void> {
    const htmlCaption = caption ? markdownToTelegramHtml(caption) : undefined;
    const useHtmlCaption = !!htmlCaption && htmlCaption.length <= TELEGRAM_CAPTION_MAX_LENGTH;
    const options = useHtmlCaption
      ? { caption: htmlCaption, parse_mode: "HTML" as TelegramBot.ParseMode }
      : caption
        ? { caption }
        : undefined;
    const sendAs = file.sendAs ?? "auto";
    try {
      await this.sendFileWithOptions(targetId, file, sendAs, options);
    } catch (error) {
      if (!caption || !useHtmlCaption || !isTelegramParseError(error)) {
        throw error;
      }
      logger.warn({ error }, "Telegram HTML caption parse error; retrying without parse_mode");
      await this.sendFileWithOptions(targetId, file, sendAs, { caption });
    }
  }

  private async sendTextWithFallback(targetId: string, text: string): Promise<void> {
    const chunks = telegramMessageSplit(text, TELEGRAM_MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.sendTextChunk(targetId, chunk);
    }
  }

  private async sendTextChunk(targetId: string, text: string): Promise<void> {
    const html = markdownToTelegramHtml(text);
    const useHtml = html.length <= TELEGRAM_MESSAGE_MAX_LENGTH;
    try {
      if (useHtml) {
        await this.bot.sendMessage(targetId, html, {
          parse_mode: "HTML"
        });
        return;
      }
      await this.bot.sendMessage(targetId, text);
    } catch (error) {
      if (!useHtml || !isTelegramParseError(error)) {
        throw error;
      }
      logger.warn({ error }, "Telegram HTML parse error; retrying without parse_mode");
      await this.bot.sendMessage(targetId, text);
    }
  }

  private async sendFileWithOptions(
    targetId: string,
    file: ConnectorFile,
    sendAs: ConnectorFile["sendAs"] | "auto",
    options?: TelegramBot.SendPhotoOptions | TelegramBot.SendVideoOptions | TelegramBot.SendDocumentOptions
  ): Promise<void> {
    const fileOptions: TelegramBot.FileOptions = {
      filename: file.name,
      contentType: file.mimeType
    };

    if (sendAs === "photo") {
      await this.bot.sendPhoto(targetId, file.path, options, fileOptions);
      return;
    }
    if (sendAs === "video") {
      await this.bot.sendVideo(targetId, file.path, options, fileOptions);
      return;
    }
    if (sendAs === "document") {
      await this.bot.sendDocument(targetId, file.path, options, fileOptions);
      return;
    }
    if (file.mimeType.startsWith("image/")) {
      await this.bot.sendPhoto(targetId, file.path, options, fileOptions);
      return;
    }
    if (file.mimeType.startsWith("video/")) {
      await this.bot.sendVideo(targetId, file.path, options, fileOptions);
      return;
    }
    await this.bot.sendDocument(targetId, file.path, options, fileOptions);
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
      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as { lastUpdateId?: number };
        if (typeof parsed.lastUpdateId === "number") {
          this.lastUpdateId = parsed.lastUpdateId;
        }
        return;
      } catch (error) {
        const recovered = recoverLastUpdateId(trimmed);
        if (recovered !== null) {
          this.lastUpdateId = recovered;
          logger.warn(
            { statePath: this.statePath, lastUpdateId: recovered },
            "Telegram connector state was invalid JSON; recovered lastUpdateId"
          );
          await this.persistState();
          return;
        }
        await this.quarantineStateFile();
        logger.warn({ error, statePath: this.statePath }, "Telegram connector state load failed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn({ error, statePath: this.statePath }, "Telegram connector state load failed");
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
      const tmpPath = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmpPath, payload, "utf8");
      await fs.rename(tmpPath, this.statePath);
    } catch (error) {
      logger.warn({ error, statePath: this.statePath }, "Telegram connector state persist failed");
    }
  }

  private async quarantineStateFile(): Promise<void> {
    if (!this.statePath) {
      return;
    }
    try {
      const dir = path.dirname(this.statePath);
      const name = path.basename(this.statePath);
      const target = path.join(dir, `${name}.corrupt-${Date.now()}`);
      await fs.rename(this.statePath, target);
      logger.warn(
        { statePath: this.statePath, quarantinePath: target },
        "Telegram state file quarantined"
      );
    } catch (error) {
      logger.warn({ error, statePath: this.statePath }, "Failed to quarantine telegram state file");
    }
  }

  private async startPolling(): Promise<void> {
    logger.debug(`startPolling() called pollingEnabled=${this.pollingEnabled} isPolling=${this.bot.isPolling()}`);
    if (!this.pollingEnabled) {
      logger.debug("Polling disabled, returning");
      return;
    }

    if (this.startingPolling) {
      logger.debug("Polling start already in progress, returning");
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

    this.startingPolling = true;
    try {
      logger.debug("Starting Telegram polling");
      await this.bot.startPolling({
        restart: true,
        polling: pollingOptions
      });
      if (this.shuttingDown || !this.pollingEnabled) {
        logger.debug("Polling disabled after start, stopping");
        await this.stopPolling("disabled");
        return;
      }
      logger.debug("Telegram polling started successfully");
    } catch (error) {
      this.handlePollingError(error);
    } finally {
      this.startingPolling = false;
    }
  }

  private handlePollingError(error: unknown): void {
    if (isTelegramConflictError(error) && !this.clearedWebhook) {
      logger.warn({ error }, "Telegram polling conflict; clearing webhook");
      void this.ensureWebhookCleared();
      return;
    }

    logger.warn({ error }, "Telegram polling error; relying on library restart");
  }

  private isAllowedUid(uid: string | number | null | undefined): boolean {
    if (uid === null || uid === undefined) {
      return false;
    }
    return this.allowedUids.has(String(uid));
  }

  private isAllowedTarget(targetId: string, action: string): boolean {
    if (this.isAllowedUid(targetId)) {
      return true;
    }
    logger.warn({ targetId, action }, "Blocked telegram action for unapproved uid");
    return false;
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

  private async updatePermissionMessage(
    query: TelegramBot.CallbackQuery,
    request: PermissionRequest,
    status: PermissionStatus
  ): Promise<void> {
    const { text, parseMode } = formatPermissionMessage(request, status);
    const message = query.message;
    const inlineMessageId = query.inline_message_id;
    if (!message && !inlineMessageId) {
      return;
    }
    try {
      if (message?.chat?.id && message.message_id) {
        await this.bot.editMessageText(text, {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: parseMode,
          reply_markup: { inline_keyboard: [] }
        });
        return;
      }
      if (inlineMessageId) {
        await this.bot.editMessageText(text, {
          inline_message_id: inlineMessageId,
          parse_mode: parseMode,
          reply_markup: { inline_keyboard: [] }
        });
      }
    } catch (error) {
      logger.warn({ error }, "Failed to update Telegram permission message");
    }
  }
}

function recoverLastUpdateId(content: string): number | null {
  const match = /"lastUpdateId"\s*:\s*(\d+)/.exec(content);
  if (match && match[1]) {
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

type PermissionStatus = "pending" | "approved" | "denied";

function formatPermissionMessage(
  request: PermissionRequest,
  status: PermissionStatus
): { text: string; parseMode: TelegramBot.ParseMode } {
  const access = describePermissionKind(request.access);
  const escapedAccess = escapeHtml(access);
  const escapedReason = escapeHtml(request.reason);
  const escapedPath =
    request.access.kind === "network" ? null : escapeHtml(request.access.path);
  const heading =
    status === "approved"
      ? "✅ <b>Permission granted</b>"
      : status === "denied"
        ? "❌ <b>Permission denied</b>"
        : "🔐 <b>Permission request</b>";
  const footer =
    status === "pending"
      ? "Approve to continue or deny to refuse."
      : "Decision recorded.";
  const requesterLine =
    request.requester.kind === "background"
      ? `<b>Requester</b>: ${escapeHtml(request.requester.label)} (background agent)`
      : null;
  const lines = [
    heading,
    "",
    `<b>Access</b>: ${escapedAccess}`,
    escapedPath ? `<b>Path</b>: <code>${escapedPath}</code>` : null,
    requesterLine,
    `<b>Reason</b>: ${escapedReason}`,
    "",
    footer
  ];
  return {
    text: lines.filter((line): line is string => Boolean(line)).join("\n"),
    parseMode: "HTML"
  };
}

function describePermissionKind(access: PermissionRequest["access"]): string {
  if (access.kind === "read") {
    return "Read files";
  }
  if (access.kind === "write") {
    return "Write/edit files";
  }
  return "Network access";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isTelegramParseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as {
    code?: string;
    message?: string;
    response?: { statusCode?: number; body?: { description?: string; error_code?: number } };
  };

  if (maybe.code !== "ETELEGRAM") {
    return false;
  }

  const description = maybe.response?.body?.description ?? maybe.message ?? "";
  if (typeof description !== "string") {
    return false;
  }

  const normalized = description.toLowerCase();
  return normalized.includes("can't parse entities") || normalized.includes("cant parse entities");
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
