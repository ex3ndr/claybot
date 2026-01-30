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
import { MemoryEngine } from "./memory/engine.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginEventEngine } from "./plugins/event-engine.js";
import { PluginEventQueue } from "./plugins/events.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import type { SettingsConfig } from "../settings.js";
import { listInferenceProviders } from "../settings.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import type { SessionMessage } from "./sessions/types.js";
import { AuthStore } from "../auth/store.js";
import { buildCronTool } from "./tools/cron.js";
import { buildMemoryTool } from "./tools/memory.js";
import { buildImageGenerationTool } from "./tools/image-generation.js";
import { buildReactionTool } from "./tools/reaction.js";
import { CronScheduler } from "../modules/runtime/cron.js";
import { EngineEventBus } from "./ipc/events.js";

const logger = getLogger("engine.runtime");
const MAX_TOOL_ITERATIONS = 5;

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
  private sessionStore: SessionStore<SessionState>;
  private sessionManager: SessionManager<SessionState>;
  private memoryEngine: MemoryEngine | null;
  private cron: CronScheduler | null = null;
  private inferenceRouter: InferenceRouter;
  private eventBus: EngineEventBus;

  constructor(options: EngineOptions) {
    this.settings = options.settings;
    this.dataDir = options.dataDir;
    this.eventBus = options.eventBus;
    this.authStore = new AuthStore(options.authPath);
    this.fileStore = new FileStore({ basePath: `${this.dataDir}/files` });

    this.pluginEventQueue = new PluginEventQueue();
    this.pluginEventEngine = new PluginEventEngine(this.pluginEventQueue);

    this.connectorRegistry = new ConnectorRegistry({
      onMessage: (source, message, context) => {
        this.pluginEventQueue.emit(
          { pluginId: source, instanceId: source },
          { type: "connector.message", payload: { source, message, context } }
        );
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
      eventQueue: this.pluginEventQueue
    });

    this.sessionStore = new SessionStore<SessionState>({
      basePath: `${this.dataDir}/sessions`
    });

    this.memoryEngine =
      this.settings.memory?.enabled === false
        ? null
        : new MemoryEngine({
            basePath: `${this.dataDir}/memory`,
            maxEntries: this.settings.memory?.maxEntries,
            sessionStore: this.sessionStore as SessionStore
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
        void this.memoryEngine?.record({
          sessionId: session.id,
          source,
          role: "user",
          text: entry.message.text,
          files: entry.message.files
        });
        this.eventBus.emit("session.updated", {
          sessionId: session.id,
          source,
          messageId: entry.id
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
      const payload = event.payload as {
        source: string;
        message: ConnectorMessage;
        context: MessageContext;
      };
      if (!payload) {
        return;
      }
      await this.sessionManager.handleMessage(
        payload.source,
        payload.message,
        payload.context,
        (session, entry) => this.handleSessionMessage(entry, session, payload.source)
      );
    });

    this.inferenceRouter = new InferenceRouter({
      providers: listInferenceProviders(this.settings),
      registry: this.inferenceRegistry,
      auth: this.authStore
    });
  }

  async start(): Promise<void> {
    await this.pluginManager.loadEnabled(this.settings);
    this.pluginEventEngine.start();

    this.cron = new CronScheduler({
      tasks: this.settings.cron?.tasks ?? [],
      onMessage: (message, context) => {
        void this.sessionManager.handleMessage("cron", message, context, (session, entry) =>
          this.handleSessionMessage(entry, session, "cron")
        );
      },
      actions: {
        "send-message": async (task, context) => {
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
            await connector.sendMessage(context.channelId, { text });
          } catch (error) {
            logger.warn({ task: task.id, error }, "Cron message send failed");
          }
        }
      },
      onError: (error, task) => {
        logger.warn({ task: task.id, error }, "Cron task failed");
      }
    });

    this.toolResolver.register(
      "core",
      buildCronTool(this.cron, (task) => {
        this.eventBus.emit("cron.task.added", { task });
      })
    );
    this.toolResolver.register("core", buildMemoryTool(this.memoryEngine));
    this.toolResolver.register("core", buildImageGenerationTool(this.imageRegistry));
    this.toolResolver.register("core", buildReactionTool());

    await this.restoreSessions();

    this.cron.start();
    this.eventBus.emit("cron.started", { tasks: this.cron.listTasks() });
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
      connectors: this.connectorRegistry.listStatus(),
      inferenceProviders: this.inferenceRegistry.list().map((provider) => ({
        id: provider.id,
        label: provider.label
      })),
      imageProviders: this.imageRegistry.list().map((provider) => ({
        id: provider.id,
        label: provider.label
      })),
      tools: this.toolResolver.listTools().map((tool) => tool.name)
    };
  }

  getCronTasks() {
    return this.cron?.listTasks() ?? [];
  }

  getSessionStore(): SessionStore<SessionState> {
    return this.sessionStore;
  }

  getMemoryEngine(): MemoryEngine | null {
    return this.memoryEngine;
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


  async updateSettings(settings: SettingsConfig): Promise<void> {
    this.settings = settings;
    await this.pluginManager.syncWithSettings(settings);
    this.inferenceRouter.updateProviders(listInferenceProviders(settings));
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
        await connector.sendMessage(entry.context.channelId, { text: message });
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
    if (!entry.message.text && (!entry.message.files || entry.message.files.length === 0)) {
      return;
    }

    const connector = this.connectorRegistry.get(source);
    if (!connector) {
      return;
    }

    const sessionContext = session.context.state.context;
    const context: Context = {
      ...sessionContext,
      tools: this.toolResolver.listTools()
    };

    const userMessage = await buildUserMessage(entry);
    context.messages.push(userMessage);

    let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
    let toolLoopExceeded = false;
    const generatedFiles: FileReference[] = [];
    const stopTyping = connector.startTyping?.(entry.context.channelId);

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        response = await this.inferenceRouter.complete(context, session.id, {
          onAttempt: (providerId, modelId) => {
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId },
              "Inference started"
            );
          },
          onFallback: (providerId, error) => {
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference fallback"
            );
          },
          onSuccess: (providerId, modelId, message) => {
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId, stopReason: message.stopReason, usage: message.usage },
              "Inference completed"
            );
          },
          onFailure: (providerId, error) => {
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference failed"
            );
          }
        });

        context.messages.push(response.message);

        const toolCalls = extractToolCalls(response.message);
        if (toolCalls.length === 0) {
          break;
        }

        for (const toolCall of toolCalls) {
          const toolResult = await this.toolResolver.execute(toolCall, {
            connectorRegistry: this.connectorRegistry,
            fileStore: this.fileStore,
            memory: this.memoryEngine,
            auth: this.authStore,
            logger,
            assistant: this.settings.assistant ?? null,
            session,
            source,
            messageContext: entry.context
          });
          context.messages.push(toolResult.toolMessage);
          if (toolResult.files?.length) {
            generatedFiles.push(...toolResult.files);
          }
        }

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          toolLoopExceeded = true;
        }
      }
    } catch (error) {
      logger.warn({ connector: source, error }, "Inference failed");
      const message =
        error instanceof Error && error.message === "No inference provider available"
          ? "No inference provider available."
          : "Inference failed.";
      await connector.sendMessage(entry.context.channelId, { text: message });
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
      await recordSessionState(this.sessionStore, session, source);
      return;
    } finally {
      stopTyping?.();
    }

    if (!response) {
      await recordSessionState(this.sessionStore, session, source);
      return;
    }

    const responseText = extractAssistantText(response.message);
    if (!responseText && generatedFiles.length === 0) {
      if (toolLoopExceeded) {
        const message = "Tool execution limit reached.";
        try {
          await connector.sendMessage(entry.context.channelId, { text: message });
          await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send tool error");
        }
      }
      await recordSessionState(this.sessionStore, session, source);
      return;
    }

    const outgoingText = responseText ?? (generatedFiles.length > 0 ? "Generated files." : null);
    try {
      await connector.sendMessage(entry.context.channelId, {
        text: outgoingText,
        files: generatedFiles.length > 0 ? generatedFiles : undefined
      });
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, outgoingText, generatedFiles);
      await this.memoryEngine?.record({
        sessionId: session.id,
        source,
        role: "assistant",
        text: outgoingText,
        files: generatedFiles
      });
    } catch (error) {
      logger.warn({ connector: source, error }, "Failed to send response");
    } finally {
      await recordSessionState(this.sessionStore, session, source);
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
