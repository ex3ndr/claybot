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
import { readSystemPrompt } from "../settings.js";
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
const DEFAULT_CODEX_SYSTEM_PROMPT = "You are a coding assistant.";

function resolveCodexSystemPrompt(
  context: Context,
  providerId?: string
): string | null {
  if (providerId !== "openai-codex") {
    return null;
  }
  const existing = context.systemPrompt;
  if (typeof existing === "string" && existing.trim()) {
    return existing;
  }
  context.systemPrompt = DEFAULT_CODEX_SYSTEM_PROMPT;
  return context.systemPrompt;
}

type SessionState = {
  context: Context;
  providerId?: string;
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
    logger.debug(`Engine constructor starting, dataDir=${options.dataDir}`);
    this.settings = options.settings;
    this.dataDir = options.dataDir;
    this.eventBus = options.eventBus;
    this.authStore = new AuthStore(options.authPath);
    this.fileStore = new FileStore({ basePath: `${this.dataDir}/files` });
    logger.debug(`AuthStore and FileStore initialized`);

    this.pluginEventQueue = new PluginEventQueue();
    this.pluginEventEngine = new PluginEventEngine(this.pluginEventQueue);

    this.connectorRegistry = new ConnectorRegistry({
      onMessage: (source, message, context) => {
        const providerId = this.resolveProviderId(context);
        const messageContext =
          providerId && context.providerId !== providerId
            ? { ...context, providerId }
            : context;
        logger.debug(`Connector message received: source=${source} channel=${messageContext.channelId} text=${message.text?.length ?? 0}chars files=${message.files?.length ?? 0}`);
        this.pluginEventQueue.emit(
          { pluginId: source, instanceId: source },
          { type: "connector.message", payload: { source, message, context: messageContext } }
        );
        logger.debug(`Connector message emitted to event queue: source=${source}`);
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
      createState: () => ({ context: { messages: [] }, providerId: undefined }),
      sessionIdFor: (_source, context) => {
        if (context.sessionId) {
          return context.sessionId;
        }
        const providerId = context.providerId ?? "default";
        const userKey = context.userId ?? context.channelId;
        return `${providerId}:${userKey}`;
      },
      storageIdFactory: () => this.sessionStore.createStorageId(),
      onSessionCreated: (session, source, context) => {
        const providerId = this.resolveProviderId(context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
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
      logger.debug(`Handling connector.message event`);
      const payload = event.payload as {
        source: string;
        message: ConnectorMessage;
        context: MessageContext;
      };
      if (!payload) {
        logger.debug(`connector.message event has no payload, skipping`);
        return;
      }
      const messageContext = this.withProviderContext(payload.context);
      logger.debug(`Dispatching to session manager: source=${payload.source} channel=${messageContext.channelId}`);
      await this.sessionManager.handleMessage(
        payload.source,
        payload.message,
        messageContext,
        (session, entry) => this.handleSessionMessage(entry, session, payload.source)
      );
      logger.debug(`Session manager completed: source=${payload.source}`);
    });

    this.inferenceRouter = new InferenceRouter({
      providers: listActiveInferenceProviders(this.settings),
      registry: this.inferenceRegistry,
      auth: this.authStore
    });
  }

  async start(): Promise<void> {
    logger.debug("Engine.start() beginning");
    logger.debug("Syncing provider manager with settings");
    await this.providerManager.sync(this.settings);
    logger.debug("Provider manager sync complete");
    logger.debug("Loading enabled plugins");
    await this.pluginManager.loadEnabled(this.settings);
    logger.debug("Plugins loaded, starting plugin event engine");
    this.pluginEventEngine.start();
    logger.debug("Plugin event engine started");

    const taskCount = this.settings.cron?.tasks?.length ?? 0;
    logger.debug(`Initializing CronScheduler taskCount=${taskCount}`);
    this.cron = new CronScheduler({
      tasks: this.settings.cron?.tasks ?? [],
      onMessage: (message, context) => {
        const messageContext = this.withProviderContext(context);
        logger.debug(`CronScheduler.onMessage triggered channelId=${messageContext.channelId} sessionId=${messageContext.sessionId}`);
        void this.sessionManager.handleMessage("cron", message, messageContext, (session, entry) =>
          this.handleSessionMessage(entry, session, "cron")
        );
      },
      actions: {
        "send-message": async (task, context) => {
          const source = task.source ?? "telegram";
          logger.debug(`Cron send-message action executing taskId=${task.id} source=${source} channelId=${context.channelId}`);
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
            logger.debug(`Cron sending message via connector taskId=${task.id} source=${source} channelId=${context.channelId}`);
            await connector.sendMessage(context.channelId, { text });
            logger.debug(`Cron message sent successfully taskId=${task.id}`);
          } catch (error) {
            logger.warn({ task: task.id, error }, "Cron message send failed");
          }
        }
      },
      onError: (error, task) => {
        logger.warn({ task: task.id, error }, "Cron task failed");
      }
    });

    logger.debug("Registering core tools");
    this.toolResolver.register(
      "core",
      buildCronTool(this.cron, (task) => {
        logger.debug(`Cron task added via tool taskId=${task.id}`);
        this.eventBus.emit("cron.task.added", { task });
      })
    );
    this.toolResolver.register("core", buildImageGenerationTool(this.imageRegistry));
    this.toolResolver.register("core", buildReactionTool());
    logger.debug("Core tools registered: cron, image_generation, reaction");

    logger.debug("Restoring sessions from disk");
    await this.restoreSessions();
    logger.debug("Sessions restored");

    logger.debug("Starting cron scheduler");
    this.cron.start();
    this.eventBus.emit("cron.started", { tasks: this.cron.listTasks() });
    logger.debug("Engine.start() complete");
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

  resetSessionByStorageId(storageId: string): boolean {
    const session = this.sessionManager.getByStorageId(storageId);
    if (!session) {
      return false;
    }
    session.resetContext(new Date());
    void this.sessionStore.recordState(session).catch((error) => {
      logger.warn({ sessionId: session.id, error }, "Session reset persistence failed");
    });
    this.eventBus.emit("session.reset", {
      sessionId: session.id,
      source: "system",
      context: { channelId: session.id, userId: null, sessionId: session.id }
    });
    return true;
  }

  resetSession(sessionId: string): boolean {
    const ok = this.sessionManager.resetSession(sessionId);
    if (!ok) {
      return false;
    }
    const session = this.sessionManager.getById(sessionId);
    if (!session) {
      return false;
    }
    void this.sessionStore.recordState(session).catch((error) => {
      logger.warn({ sessionId: session.id, error }, "Session reset persistence failed");
    });
    this.eventBus.emit("session.reset", {
      sessionId: session.id,
      source: "system",
      context: { channelId: session.id, userId: null, sessionId }
    });
    return true;
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

  private withProviderContext(context: MessageContext): MessageContext {
    const providerId = this.resolveProviderId(context);
    if (!providerId || context.providerId === providerId) {
      return context;
    }
    return { ...context, providerId };
  }

  private resolveProviderId(context: MessageContext): string | undefined {
    if (context.providerId) {
      return context.providerId;
    }
    const providers = listActiveInferenceProviders(this.settings);
    return providers[0]?.id;
  }

  private resolveSessionProvider(
    session: Session<SessionState>,
    context: MessageContext
  ): string | undefined {
    const providers = listActiveInferenceProviders(this.settings);
    const activeIds = new Set(providers.map((provider) => provider.id));

    let providerId = session.context.state.providerId ?? context.providerId;
    if (!providerId || !activeIds.has(providerId)) {
      const fallback =
        context.providerId && activeIds.has(context.providerId)
          ? context.providerId
          : providers[0]?.id;
      providerId = fallback;
    }

    if (providerId && session.context.state.providerId !== providerId) {
      session.context.state.providerId = providerId;
    }

    return providerId;
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
      if (!session.context.state.providerId) {
        const providerId = this.resolveProviderId(restored.context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
      }
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
    const textLen = entry.message.text?.length ?? 0;
    const fileCount = entry.message.files?.length ?? 0;
    logger.debug(`handleSessionMessage started sessionId=${session.id} messageId=${entry.id} source=${source} hasText=${!!entry.message.text} textLength=${textLen} fileCount=${fileCount}`);

    if (!entry.message.text && (!entry.message.files || entry.message.files.length === 0)) {
      logger.debug(`handleSessionMessage skipping - no text or files sessionId=${session.id} messageId=${entry.id}`);
      return;
    }

    const connector = this.connectorRegistry.get(source);
    if (!connector) {
      logger.debug(`handleSessionMessage skipping - connector not found sessionId=${session.id} source=${source}`);
      return;
    }
    logger.debug(`Connector found source=${source}`);

    const sessionContext = session.context.state.context;
    const providerId = this.resolveSessionProvider(session, entry.context);
    const codexPrompt = resolveCodexSystemPrompt(sessionContext, providerId);
    logger.debug(`Building context sessionId=${session.id} existingMessageCount=${sessionContext.messages.length}`);

    const systemPrompt = await readSystemPrompt();
    const context: Context = {
      ...sessionContext,
      tools: this.listContextTools(),
      systemPrompt
    };
    if (codexPrompt) {
      resolveCodexSystemPrompt(context, providerId);
    }
    logger.debug(
      `Context built toolCount=${context.tools?.length ?? 0} systemPrompt=${context.systemPrompt ? "set" : "none"}`
    );

    logger.debug("Building user message from entry");
    const userMessage = await buildUserMessage(entry);
    context.messages.push(userMessage);
    logger.debug(`User message added to context totalMessages=${context.messages.length}`);

    const providersForSession = providerId
      ? listActiveInferenceProviders(this.settings).filter((provider) => provider.id === providerId)
      : [];
    logger.debug(`Session provider resolved sessionId=${session.id} providerId=${providerId ?? "none"} providerCount=${providersForSession.length}`);

    let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
    let toolLoopExceeded = false;
    const generatedFiles: FileReference[] = [];
    logger.debug(`Starting typing indicator channelId=${entry.context.channelId}`);
    const stopTyping = connector.startTyping?.(entry.context.channelId);

    try {
      logger.debug(`Starting inference loop maxIterations=${MAX_TOOL_ITERATIONS}`);
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        logger.debug(`Inference loop iteration=${iteration} sessionId=${session.id} messageCount=${context.messages.length}`);
        response = await this.inferenceRouter.complete(context, session.id, {
          providersOverride: providersForSession,
          onAttempt: (providerId, modelId) => {
            logger.debug(`Inference attempt starting providerId=${providerId} modelId=${modelId} sessionId=${session.id}`);
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId },
              "Inference started"
            );
          },
          onFallback: (providerId, error) => {
            logger.debug(`Inference falling back to next provider providerId=${providerId} error=${String(error)}`);
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference fallback"
            );
          },
          onSuccess: (providerId, modelId, message) => {
            logger.debug(`Inference succeeded providerId=${providerId} modelId=${modelId} stopReason=${message.stopReason} inputTokens=${message.usage?.input} outputTokens=${message.usage?.output}`);
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId, stopReason: message.stopReason, usage: message.usage },
              "Inference completed"
            );
          },
          onFailure: (providerId, error) => {
            logger.debug(`Inference failed completely providerId=${providerId} error=${String(error)}`);
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference failed"
            );
          }
        });

        logger.debug(`Inference response received providerId=${response.providerId} modelId=${response.modelId} stopReason=${response.message.stopReason}`);
        context.messages.push(response.message);

        const toolCalls = extractToolCalls(response.message);
        logger.debug(`Extracted tool calls from response toolCallCount=${toolCalls.length}`);
        if (toolCalls.length === 0) {
          logger.debug(`No tool calls, breaking inference loop iteration=${iteration}`);
          break;
        }

        for (const toolCall of toolCalls) {
          const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 200);
          logger.debug(`Executing tool call toolName=${toolCall.name} toolCallId=${toolCall.id} args=${argsPreview}`);
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
          logger.debug(`Tool execution completed toolName=${toolCall.name} isError=${toolResult.toolMessage.isError} fileCount=${toolResult.files?.length ?? 0}`);
          context.messages.push(toolResult.toolMessage);
          if (toolResult.files?.length) {
            generatedFiles.push(...toolResult.files);
            logger.debug(`Tool generated files count=${toolResult.files.length}`);
          }
        }

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          logger.debug(`Tool loop limit reached iteration=${iteration}`);
          toolLoopExceeded = true;
        }
      }
      logger.debug("Inference loop completed");
    } catch (error) {
      logger.debug(`Inference loop caught error error=${String(error)}`);
      logger.warn({ connector: source, error }, "Inference failed");
      const message =
        error instanceof Error && error.message === "No inference provider available"
          ? "No inference provider available."
          : "Inference failed.";
      logger.debug(`Sending error message to user message=${message}`);
      await connector.sendMessage(entry.context.channelId, {
        text: message,
        replyToMessageId: entry.context.messageId
      });
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
      await recordSessionState(this.sessionStore, session, source);
      logger.debug("handleSessionMessage completed with error");
      return;
    } finally {
      logger.debug("Stopping typing indicator");
      stopTyping?.();
    }

    if (!response) {
      logger.debug("No response received, recording session state only");
      await recordSessionState(this.sessionStore, session, source);
      return;
    }

    if (response.message.stopReason === "error" || response.message.stopReason === "aborted") {
      const message = "Inference failed.";
      const errorDetail =
        response.message.errorMessage && response.message.errorMessage.length > 0
          ? response.message.errorMessage
          : "unknown";
      logger.warn(
        `Inference returned error response provider=${response.providerId} model=${response.modelId} stopReason=${response.message.stopReason} error=${errorDetail}`
      );
      try {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
        await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
        this.eventBus.emit("session.outgoing", {
          sessionId: session.id,
          source,
          message: { text: message },
          context: entry.context
        });
      } catch (error) {
        logger.warn({ connector: source, error }, "Failed to send error response");
      } finally {
        await recordSessionState(this.sessionStore, session, source);
        logger.debug("handleSessionMessage completed with error stop reason");
      }
      return;
    }

    const responseText = extractAssistantText(response.message);
    logger.debug(`Extracted assistant text hasText=${!!responseText} textLength=${responseText?.length ?? 0} generatedFileCount=${generatedFiles.length}`);

    if (!responseText && generatedFiles.length === 0) {
      if (toolLoopExceeded) {
        const message = "Tool execution limit reached.";
        logger.debug("Tool loop exceeded, sending error message");
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
      logger.debug("handleSessionMessage completed with no response text");
      return;
    }

    const outgoingText = responseText ?? (generatedFiles.length > 0 ? "Generated files." : null);
    logger.debug(`Sending response to user textLength=${outgoingText?.length ?? 0} fileCount=${generatedFiles.length} channelId=${entry.context.channelId}`);
    try {
      await connector.sendMessage(entry.context.channelId, {
        text: outgoingText,
        files: generatedFiles.length > 0 ? generatedFiles : undefined,
        replyToMessageId: entry.context.messageId
      });
      logger.debug("Response sent successfully");
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
      logger.debug("Session outgoing event emitted");
    } catch (error) {
      logger.debug(`Failed to send response error=${String(error)}`);
      logger.warn({ connector: source, error }, "Failed to send response");
    } finally {
      await recordSessionState(this.sessionStore, session, source);
      logger.debug("handleSessionMessage completed successfully");
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
    const candidate = state as { context?: Context; providerId?: string };
    if (candidate.context && Array.isArray(candidate.context.messages)) {
      return {
        context: candidate.context,
        providerId: typeof candidate.providerId === "string" ? candidate.providerId : undefined
      };
    }
  }
  return { context: { messages: [] }, providerId: undefined };
}
