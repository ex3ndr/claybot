import { createId } from "@paralleldrive/cuid2";
import type { Context, ToolCall } from "@mariozechner/pi-ai";
import { promises as fs } from "node:fs";

import { getLogger } from "../log.js";
import {
  ConnectorRegistry,
  ImageGenerationRegistry,
  InferenceRegistry,
  ToolResolver
} from "./modules.js";
import type { ConnectorMessage, MessageContext } from "./connectors/types.js";
import { FileStore } from "../files/store.js";
import type { FileReference } from "../files/types.js";
import { InferenceRouter } from "./inference/router.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginEventEngine } from "./plugins/event-engine.js";
import { PluginEventQueue } from "./plugins/events.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import type { SettingsConfig } from "../settings.js";
import { listActiveInferenceProviders } from "../providers/catalog.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import { Session } from "./sessions/session.js";
import type { SessionMessage } from "./sessions/types.js";
import { AuthStore } from "../auth/store.js";
import { buildCronTool } from "./tools/cron.js";
import { buildImageGenerationTool } from "./tools/image-generation.js";
import { buildReactionTool } from "./tools/reaction.js";
import type { ToolExecutionResult } from "./tools/types.js";
import { CronScheduler } from "../modules/runtime/cron.js";
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";

const logger = getLogger("engine.runtime");
const MAX_TOOL_ITERATIONS = 5;

// Verbose logging helper for detailed tracing
function verbose(msg: string, data?: Record<string, unknown>): void {
  logger.debug(data ?? {}, `[VERBOSE] ${msg}`);
}

type SessionState = {
  context: Context;
};

export type EngineOptions = {
  settings: SettingsConfig;
  dataDir: string;
  authPath: string;
  eventBus: EngineEventBus;
};

export class Engine {
  private settings: SettingsConfig;
  private dataDir: string;
  private authStore: AuthStore;
  private fileStore: FileStore;
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolResolver: ToolResolver;
  private pluginRegistry: PluginRegistry;
  private pluginManager: PluginManager;
  private pluginEventQueue: PluginEventQueue;
  private pluginEventEngine: PluginEventEngine;
  private providerManager: ProviderManager;
  private sessionStore: SessionStore<SessionState>;
  private sessionManager: SessionManager<SessionState>;
  private cron: CronScheduler | null = null;
  private inferenceRouter: InferenceRouter;
  private eventBus: EngineEventBus;

  constructor(options: EngineOptions) {
    verbose("Engine constructor starting", { dataDir: options.dataDir });
    this.settings = options.settings;
    this.dataDir = options.dataDir;
    this.eventBus = options.eventBus;
    this.authStore = new AuthStore(options.authPath);
    this.fileStore = new FileStore({ basePath: `${this.dataDir}/files` });
    verbose("AuthStore and FileStore initialized", { authPath: options.authPath, filesPath: `${this.dataDir}/files` });

    this.pluginEventQueue = new PluginEventQueue();
    this.pluginEventEngine = new PluginEventEngine(this.pluginEventQueue);

    this.connectorRegistry = new ConnectorRegistry({
      onMessage: (source, message, context) => {
        verbose("ConnectorRegistry.onMessage received", {
          source,
          channelId: context.channelId,
          userId: context.userId,
          hasText: !!message.text,
          textLength: message.text?.length ?? 0,
          fileCount: message.files?.length ?? 0
        });
        this.pluginEventQueue.emit(
          { pluginId: source, instanceId: source },
          { type: "connector.message", payload: { source, message, context } }
        );
        verbose("ConnectorRegistry.onMessage emitted to plugin event queue", { source });
      },
      onFatal: (source, reason, error) => {
        logger.warn({ source, reason, error }, "Connector requested shutdown");
      }
    });

    this.inferenceRegistry = new InferenceRegistry();
    this.imageRegistry = new ImageGenerationRegistry();
    this.toolResolver = new ToolResolver();

    this.pluginRegistry = new PluginRegistry(
      this.connectorRegistry,
      this.inferenceRegistry,
      this.imageRegistry,
      this.toolResolver
    );

    this.pluginManager = new PluginManager({
      settings: this.settings,
      registry: this.pluginRegistry,
      auth: this.authStore,
      fileStore: this.fileStore,
      pluginCatalog: buildPluginCatalog(),
      dataDir: this.dataDir,
      eventQueue: this.pluginEventQueue,
      engineEvents: this.eventBus
    });

    this.providerManager = new ProviderManager({
      settings: this.settings,
      auth: this.authStore,
      fileStore: this.fileStore,
      inferenceRegistry: this.inferenceRegistry,
      imageRegistry: this.imageRegistry
    });

    this.sessionStore = new SessionStore<SessionState>({
      basePath: `${this.dataDir}/sessions`
    });

    this.sessionManager = new SessionManager<SessionState>({
      createState: () => ({ context: { messages: [] } }),
      storageIdFactory: () => this.sessionStore.createStorageId(),
      onSessionCreated: (session, source, context) => {
        logger.info(
          {
            sessionId: session.id,
            source,
            channelId: context.channelId,
            userId: context.userId
          },
          "Session created"
        );
        void this.sessionStore
          .recordSessionCreated(session, source, context)
          .catch((error) => {
            logger.warn({ sessionId: session.id, source, error }, "Session persistence failed");
          });
        this.eventBus.emit("session.created", {
          sessionId: session.id,
          source,
          context
        });
      },
      onSessionUpdated: (session, entry, source) => {
        logger.info(
          {
            sessionId: session.id,
            source,
            messageId: entry.id,
            pending: session.size
          },
          "Session updated"
        );
        void this.sessionStore.recordIncoming(session, entry, source).catch((error) => {
          logger.warn(
            { sessionId: session.id, source, messageId: entry.id, error },
            "Session persistence failed"
          );
        });
        this.eventBus.emit("session.updated", {
          sessionId: session.id,
          source,
          messageId: entry.id,
          entry: {
            id: entry.id,
            message: entry.message,
            context: entry.context,
            receivedAt: entry.receivedAt
          }
        });
      },
      onMessageStart: (session, entry, source) => {
        logger.info({ sessionId: session.id, source, messageId: entry.id }, "Session processing started");
      },
      onMessageEnd: (session, entry, source) => {
        logger.info({ sessionId: session.id, source, messageId: entry.id }, "Session processing completed");
      },
      onError: (error, session, entry) => {
        logger.warn({ sessionId: session.id, messageId: entry.id, error }, "Session handler failed");
      }
    });

    this.pluginEventEngine.register("connector.message", async (event) => {
      verbose("PluginEventEngine handling connector.message event", { eventType: event.type });
      const payload = event.payload as {
        source: string;
        message: ConnectorMessage;
        context: MessageContext;
      };
      if (!payload) {
        verbose("connector.message event has no payload, skipping");
        return;
      }
      verbose("Dispatching to SessionManager.handleMessage", {
        source: payload.source,
        channelId: payload.context.channelId,
        userId: payload.context.userId
      });
      await this.sessionManager.handleMessage(
        payload.source,
        payload.message,
        payload.context,
        (session, entry) => this.handleSessionMessage(entry, session, payload.source)
      );
      verbose("SessionManager.handleMessage completed", { source: payload.source });
    });

    this.inferenceRouter = new InferenceRouter({
      providers: listActiveInferenceProviders(this.settings),
      registry: this.inferenceRegistry,
      auth: this.authStore
    });
  }

  async start(): Promise<void> {
    verbose("Engine.start() beginning");
    verbose("Syncing provider manager with settings");
    await this.providerManager.sync(this.settings);
    verbose("Provider manager sync complete");
    verbose("Loading enabled plugins");
    await this.pluginManager.loadEnabled(this.settings);
    verbose("Plugins loaded, starting plugin event engine");
    this.pluginEventEngine.start();
    verbose("Plugin event engine started");

    verbose("Initializing CronScheduler", { taskCount: this.settings.cron?.tasks?.length ?? 0 });
    this.cron = new CronScheduler({
      tasks: this.settings.cron?.tasks ?? [],
      onMessage: (message, context) => {
        verbose("CronScheduler.onMessage triggered", { channelId: context.channelId, sessionId: context.sessionId });
        void this.sessionManager.handleMessage("cron", message, context, (session, entry) =>
          this.handleSessionMessage(entry, session, "cron")
        );
      },
      actions: {
        "send-message": async (task, context) => {
          verbose("Cron send-message action executing", { taskId: task.id, source: task.source, channelId: context.channelId });
          const source = task.source ?? "telegram";
          const connector = this.connectorRegistry.get(source);
          if (!connector) {
            logger.warn({ task: task.id, source }, "Cron action skipped: connector not loaded");
            return;
          }
          const text =
            typeof task.message === "string" && task.message.length > 0 ? task.message : null;
          if (!text) {
            logger.warn({ task: task.id }, "Cron action skipped: missing message");
            return;
          }
          try {
            verbose("Cron sending message via connector", { taskId: task.id, source, channelId: context.channelId });
            await connector.sendMessage(context.channelId, { text });
            verbose("Cron message sent successfully", { taskId: task.id });
          } catch (error) {
            logger.warn({ task: task.id, error }, "Cron message send failed");
          }
        }
      },
      onError: (error, task) => {
        logger.warn({ task: task.id, error }, "Cron task failed");
      }
    });

    verbose("Registering core tools");
    this.toolResolver.register(
      "core",
      buildCronTool(this.cron, (task) => {
        verbose("Cron task added via tool", { taskId: task.id });
        this.eventBus.emit("cron.task.added", { task });
      })
    );
    this.toolResolver.register("core", buildImageGenerationTool(this.imageRegistry));
    this.toolResolver.register("core", buildReactionTool());
    verbose("Core tools registered: cron, image_generation, reaction");

    verbose("Restoring sessions from disk");
    await this.restoreSessions();
    verbose("Sessions restored");

    verbose("Starting cron scheduler");
    this.cron.start();
    this.eventBus.emit("cron.started", { tasks: this.cron.listTasks() });
    verbose("Engine.start() complete");
  }

  async shutdown(): Promise<void> {
    await this.connectorRegistry.unregisterAll("shutdown");
    if (this.cron) {
      this.cron.stop();
    }
    this.pluginEventEngine.stop();
    await this.pluginManager.unloadAll();
  }

  getStatus() {
    return {
      plugins: this.pluginManager.listLoaded(),
      providers: this.providerManager.listLoaded(),
      connectors: this.connectorRegistry.listStatus(),
      inferenceProviders: this.inferenceRegistry.list().map((provider) => ({
        id: provider.id,
        label: provider.label
      })),
      imageProviders: this.imageRegistry.list().map((provider) => ({
        id: provider.id,
        label: provider.label
      })),
      tools: this.listContextTools().map((tool) => tool.name)
    };
  }

  getCronTasks() {
    return this.cron?.listTasks() ?? [];
  }

  getSessionStore(): SessionStore<SessionState> {
    return this.sessionStore;
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getSettings(): SettingsConfig {
    return this.settings;
  }

  getAuthStore(): AuthStore {
    return this.authStore;
  }

  getFileStore(): FileStore {
    return this.fileStore;
  }

  getConnectorRegistry(): ConnectorRegistry {
    return this.connectorRegistry;
  }

  getInferenceRouter(): InferenceRouter {
    return this.inferenceRouter;
  }

  private listContextTools() {
    const tools = this.toolResolver.listTools();
    if (this.imageRegistry.list().length === 0) {
      return tools.filter((tool) => tool.name !== "generate_image");
    }
    return tools;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    messageContext?: MessageContext
  ): Promise<ToolExecutionResult> {
    const toolCall: ToolCall = {
      id: createId(),
      name,
      type: "toolCall",
      arguments: args
    };
    const now = new Date();
    const sessionId = messageContext?.sessionId ?? `system:${name}`;
    const session = new Session<SessionState>(
      sessionId,
      {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        state: { context: { messages: [] } }
      },
      createId()
    );
    const context: MessageContext =
      messageContext ?? {
        channelId: sessionId,
        userId: null,
        sessionId
      };

    return this.toolResolver.execute(toolCall, {
      connectorRegistry: this.connectorRegistry,
      fileStore: this.fileStore,
      auth: this.authStore,
      logger,
      assistant: this.settings.assistant ?? null,
      session,
      source: "system",
      messageContext: context
    });
  }


  async updateSettings(settings: SettingsConfig): Promise<void> {
    this.settings = settings;
    await this.providerManager.sync(settings);
    await this.pluginManager.syncWithSettings(settings);
    this.inferenceRouter.updateProviders(listActiveInferenceProviders(settings));
  }

  private async restoreSessions(): Promise<void> {
    const restoredSessions = await this.sessionStore.loadSessions();
    const pendingInternalErrors: Array<{
      sessionId: string;
      source: string;
      context: MessageContext;
    }> = [];

    for (const restored of restoredSessions) {
      const session = this.sessionManager.restoreSession(
        restored.sessionId,
        restored.storageId,
        normalizeSessionState(restored.state),
        restored.createdAt,
        restored.updatedAt
      );
      logger.info(
        { sessionId: session.id, source: restored.source },
        "Session restored"
      );
      if (restored.lastEntryType === "incoming") {
        pendingInternalErrors.push({
          sessionId: session.id,
          source: restored.source,
          context: restored.context
        });
      }
    }

    if (pendingInternalErrors.length > 0) {
      await this.sendPendingInternalErrors(pendingInternalErrors);
    }
  }

  private async sendPendingInternalErrors(
    pending: Array<{
      sessionId: string;
      source: string;
      context: MessageContext;
    }>
  ): Promise<void> {
    const message = "Internal error.";
    for (const entry of pending) {
      const connector = this.connectorRegistry.get(entry.source);
      if (!connector) {
        continue;
      }
      try {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
      } catch (error) {
        logger.warn({ sessionId: entry.sessionId, source: entry.source, error }, "Pending reply failed");
      }
    }
  }

  private async handleSessionMessage(
    entry: SessionMessage,
    session: import("./sessions/session.js").Session<SessionState>,
    source: string
  ): Promise<void> {
    verbose("handleSessionMessage started", {
      sessionId: session.id,
      messageId: entry.id,
      source,
      hasText: !!entry.message.text,
      textLength: entry.message.text?.length ?? 0,
      fileCount: entry.message.files?.length ?? 0
    });

    if (!entry.message.text && (!entry.message.files || entry.message.files.length === 0)) {
      verbose("handleSessionMessage skipping - no text or files", { sessionId: session.id, messageId: entry.id });
      return;
    }

    const connector = this.connectorRegistry.get(source);
    if (!connector) {
      verbose("handleSessionMessage skipping - connector not found", { sessionId: session.id, source });
      return;
    }
    verbose("Connector found", { source });

    const sessionContext = session.context.state.context;
    verbose("Building context", {
      sessionId: session.id,
      existingMessageCount: sessionContext.messages.length
    });
    const context: Context = {
      ...sessionContext,
      tools: this.listContextTools()
    };
    verbose("Context built", { toolCount: context.tools?.length ?? 0 });

    verbose("Building user message from entry");
    const userMessage = await buildUserMessage(entry);
    context.messages.push(userMessage);
    verbose("User message added to context", { totalMessages: context.messages.length });

    let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
    let toolLoopExceeded = false;
    const generatedFiles: FileReference[] = [];
    verbose("Starting typing indicator", { channelId: entry.context.channelId });
    const stopTyping = connector.startTyping?.(entry.context.channelId);

    try {
      verbose("Starting inference loop", { maxIterations: MAX_TOOL_ITERATIONS });
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        verbose("Inference loop iteration", { iteration, sessionId: session.id, messageCount: context.messages.length });
        response = await this.inferenceRouter.complete(context, session.id, {
          onAttempt: (providerId, modelId) => {
            verbose("Inference attempt starting", { providerId, modelId, sessionId: session.id });
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId },
              "Inference started"
            );
          },
          onFallback: (providerId, error) => {
            verbose("Inference falling back to next provider", { providerId, error: String(error) });
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference fallback"
            );
          },
          onSuccess: (providerId, modelId, message) => {
            verbose("Inference succeeded", {
              providerId,
              modelId,
              stopReason: message.stopReason,
              inputTokens: message.usage?.input,
              outputTokens: message.usage?.output
            });
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId, stopReason: message.stopReason, usage: message.usage },
              "Inference completed"
            );
          },
          onFailure: (providerId, error) => {
            verbose("Inference failed completely", { providerId, error: String(error) });
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference failed"
            );
          }
        });

        verbose("Inference response received", {
          providerId: response.providerId,
          modelId: response.modelId,
          stopReason: response.message.stopReason
        });
        context.messages.push(response.message);

        const toolCalls = extractToolCalls(response.message);
        verbose("Extracted tool calls from response", { toolCallCount: toolCalls.length });
        if (toolCalls.length === 0) {
          verbose("No tool calls, breaking inference loop", { iteration });
          break;
        }

        for (const toolCall of toolCalls) {
          verbose("Executing tool call", {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            args: JSON.stringify(toolCall.arguments).slice(0, 200)
          });
          const toolResult = await this.toolResolver.execute(toolCall, {
            connectorRegistry: this.connectorRegistry,
            fileStore: this.fileStore,
            auth: this.authStore,
            logger,
            assistant: this.settings.assistant ?? null,
            session,
            source,
            messageContext: entry.context
          });
          verbose("Tool execution completed", {
            toolName: toolCall.name,
            isError: toolResult.toolMessage.isError,
            fileCount: toolResult.files?.length ?? 0
          });
          context.messages.push(toolResult.toolMessage);
          if (toolResult.files?.length) {
            generatedFiles.push(...toolResult.files);
            verbose("Tool generated files", { count: toolResult.files.length });
          }
        }

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          verbose("Tool loop limit reached", { iteration });
          toolLoopExceeded = true;
        }
      }
      verbose("Inference loop completed");
    } catch (error) {
      verbose("Inference loop caught error", { error: String(error) });
      logger.warn({ connector: source, error }, "Inference failed");
      const message =
        error instanceof Error && error.message === "No inference provider available"
          ? "No inference provider available."
          : "Inference failed.";
      verbose("Sending error message to user", { message });
      await connector.sendMessage(entry.context.channelId, {
        text: message,
        replyToMessageId: entry.context.messageId
      });
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
      await recordSessionState(this.sessionStore, session, source);
      verbose("handleSessionMessage completed with error");
      return;
    } finally {
      verbose("Stopping typing indicator");
      stopTyping?.();
    }

    if (!response) {
      verbose("No response received, recording session state only");
      await recordSessionState(this.sessionStore, session, source);
      return;
    }

    const responseText = extractAssistantText(response.message);
    verbose("Extracted assistant text", {
      hasText: !!responseText,
      textLength: responseText?.length ?? 0,
      generatedFileCount: generatedFiles.length
    });

    if (!responseText && generatedFiles.length === 0) {
      if (toolLoopExceeded) {
        const message = "Tool execution limit reached.";
        verbose("Tool loop exceeded, sending error message");
        try {
          await connector.sendMessage(entry.context.channelId, {
            text: message,
            replyToMessageId: entry.context.messageId
          });
          await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send tool error");
        }
      }
      await recordSessionState(this.sessionStore, session, source);
      verbose("handleSessionMessage completed with no response text");
      return;
    }

    const outgoingText = responseText ?? (generatedFiles.length > 0 ? "Generated files." : null);
    verbose("Sending response to user", {
      textLength: outgoingText?.length ?? 0,
      fileCount: generatedFiles.length,
      channelId: entry.context.channelId
    });
    try {
      await connector.sendMessage(entry.context.channelId, {
        text: outgoingText,
        files: generatedFiles.length > 0 ? generatedFiles : undefined,
        replyToMessageId: entry.context.messageId
      });
      verbose("Response sent successfully");
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, outgoingText, generatedFiles);
      this.eventBus.emit("session.outgoing", {
        sessionId: session.id,
        source,
        message: {
          text: outgoingText,
          files: generatedFiles.length > 0 ? generatedFiles : undefined
        },
        context: entry.context
      });
      verbose("Session outgoing event emitted");
    } catch (error) {
      verbose("Failed to send response", { error: String(error) });
      logger.warn({ connector: source, error }, "Failed to send response");
    } finally {
      await recordSessionState(this.sessionStore, session, source);
      verbose("handleSessionMessage completed successfully");
    }
  }
}

async function buildUserMessage(
  entry: SessionMessage
): Promise<Context["messages"][number]> {
  const text = entry.message.text ?? "";
  const files = entry.message.files ?? [];
  if (files.length === 0) {
    return {
      role: "user",
      content: text,
      timestamp: Date.now()
    };
  }

  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const file of files) {
    if (file.mimeType.startsWith("image/")) {
      const data = await fs.readFile(file.path);
      content.push({
        type: "image",
        data: data.toString("base64"),
        mimeType: file.mimeType
      });
    } else {
      content.push({
        type: "text",
        text: `File received: ${file.name} (${file.mimeType}, ${file.size} bytes)`
      });
    }
  }

  return {
    role: "user",
    content,
    timestamp: Date.now()
  };
}

async function recordOutgoingEntry(
  sessionStore: SessionStore<SessionState>,
  session: import("./sessions/session.js").Session<SessionState>,
  source: string,
  context: MessageContext,
  text: string | null,
  files?: FileReference[]
): Promise<void> {
  const messageId = createId();
  try {
    await sessionStore.recordOutgoing(session, messageId, source, context, text, files);
  } catch (error) {
    logger.warn({ sessionId: session.id, source, messageId, error }, "Session persistence failed");
  }
}

async function recordSessionState(
  sessionStore: SessionStore<SessionState>,
  session: import("./sessions/session.js").Session<SessionState>,
  source: string
): Promise<void> {
  try {
    await sessionStore.recordState(session);
  } catch (error) {
    logger.warn({ sessionId: session.id, source, error }, "Session persistence failed");
  }
}

function extractAssistantText(message: Context["messages"][number]): string | null {
  if (message.role !== "assistant") {
    return null;
  }
  const parts = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return parts.join("\n");
}

function extractToolCalls(message: Context["messages"][number]): ToolCall[] {
  if (message.role !== "assistant") {
    return [];
  }
  return message.content.filter(
    (block): block is ToolCall => block.type === "toolCall"
  );
}

function normalizeSessionState(state: unknown): SessionState {
  if (state && typeof state === "object") {
    const candidate = state as { context?: Context };
    if (candidate.context && Array.isArray(candidate.context.messages)) {
      return { context: candidate.context };
    }
  }
  return { context: { messages: [] } };
}
