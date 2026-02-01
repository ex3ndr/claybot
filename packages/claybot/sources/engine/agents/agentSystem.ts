import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { AgentRuntime, Config, ConnectorMessage, MessageContext } from "@/types";
import { listActiveInferenceProviders } from "../../providers/catalog.js";
import { cuid2Is } from "../../utils/cuid2Is.js";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import { messageBuildSystemText } from "../messages/messageBuildSystemText.js";
import { messageFormatIncoming } from "../messages/messageFormatIncoming.js";
import { messageIsSystemText } from "../messages/messageIsSystemText.js";
import { permissionBuildCron } from "../permissions/permissionBuildCron.js";
import { permissionClone } from "../permissions/permissionClone.js";
import { permissionEnsureDefaultFile } from "../permissions/permissionEnsureDefaultFile.js";
import { permissionMergeDefault } from "../permissions/permissionMergeDefault.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import { SessionManager } from "../sessions/manager.js";
import { SessionStore } from "../sessions/store.js";
import type { SessionMessage } from "@/types";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import {
  normalizeSessionDescriptor,
  sessionDescriptorMatchesStrategy,
  type SessionDescriptor,
  type SessionFetchStrategy
} from "../sessions/descriptor.js";
import { sessionContextIsHeartbeat } from "../sessions/sessionContextIsHeartbeat.js";
import { sessionDescriptorBuild } from "../sessions/sessionDescriptorBuild.js";
import { sessionKeyBuild } from "../sessions/sessionKeyBuild.js";
import { sessionKeyResolve } from "../sessions/sessionKeyResolve.js";
import { sessionRoutingSanitize } from "../sessions/sessionRoutingSanitize.js";
import { sessionStateNormalize } from "../sessions/sessionStateNormalize.js";
import { sessionTimestampGet } from "../sessions/sessionTimestampGet.js";
import type { Session } from "../sessions/session.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { Crons } from "../cron/crons.js";
import { Agent } from "./agent.js";
import type { AgentSystemContext, BackgroundAgentState } from "./agentTypes.js";

const logger = getLogger("engine.agent-system");

export type AgentSystemOptions = {
  config: Config;
  eventBus: EngineEventBus;
  connectorRegistry: ConnectorRegistry;
  imageRegistry: ImageGenerationRegistry;
  toolResolver: ToolResolver;
  pluginManager: PluginManager;
  inferenceRouter: InferenceRouter;
  fileStore: FileStore;
  authStore: AuthStore;
  crons: Crons;
  agentRuntime: AgentRuntime;
};

type ScheduledMessage = {
  source: string;
  message: ConnectorMessage;
  context: MessageContext;
};

type PendingInternalError = {
  sessionId: string;
  source: string;
  context: MessageContext;
};

export class AgentSystem implements AgentSystemContext {
  config: Config;
  readonly eventBus: EngineEventBus;
  readonly connectorRegistry: ConnectorRegistry;
  readonly imageRegistry: ImageGenerationRegistry;
  readonly toolResolver: ToolResolver;
  readonly pluginManager: PluginManager;
  readonly inferenceRouter: InferenceRouter;
  readonly fileStore: FileStore;
  readonly authStore: AuthStore;
  readonly sessionStore: SessionStore<SessionState>;
  readonly crons: Crons;
  readonly agentRuntime: AgentRuntime;
  private sessionManager: SessionManager<SessionState>;
  private sessionKeyMap = new Map<string, string>();
  private stage: "idle" | "loaded" | "scheduling" | "running" = "idle";
  private queuedMessages: ScheduledMessage[] = [];
  private pendingInternalErrors: PendingInternalError[] = [];
  private pendingSubagentFailures: string[] = [];
  private drainingQueue = false;

  constructor(options: AgentSystemOptions) {
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.connectorRegistry = options.connectorRegistry;
    this.imageRegistry = options.imageRegistry;
    this.toolResolver = options.toolResolver;
    this.pluginManager = options.pluginManager;
    this.inferenceRouter = options.inferenceRouter;
    this.fileStore = options.fileStore;
    this.authStore = options.authStore;
    this.crons = options.crons;
    this.agentRuntime = options.agentRuntime;
    this.sessionStore = new SessionStore<SessionState>({
      basePath: `${this.config.dataDir}/sessions`
    });
    this.sessionManager = new SessionManager<SessionState>({
      createState: () => ({
        context: { messages: [] },
        providerId: undefined,
        permissions: permissionClone(this.config.defaultPermissions),
        session: undefined
      }),
      sessionIdFor: (source, context) => {
        const key = sessionKeyResolve(source, context, logger);
        const cronTaskUid = cuid2Is(context.cron?.taskUid ?? null)
          ? context.cron!.taskUid
          : null;
        // Session ids are always cuid2; ignore non-cuid2 ids from connectors.
        const explicitId = cuid2Is(context.sessionId ?? null)
          ? context.sessionId!
          : cronTaskUid;
        if (explicitId) {
          if (key) {
            this.sessionKeyMap.set(key, explicitId);
          }
          return explicitId;
        }
        if (key) {
          return this.getOrCreateSessionId(key);
        }
        if (source && source !== "system" && source !== "cron" && source !== "background") {
          throw new Error("userId is required to map sessions for connectors.");
        }
        return createId();
      },
      storageIdFactory: () => this.sessionStore.createStorageId(),
      messageTransform: (message, context, receivedAt) => {
        return messageFormatIncoming(message, context, receivedAt);
      },
      onSessionCreated: (session, source, context) => {
        this.captureRouting(session, source, context);
        this.captureAgent(session, context);
        const providerId = this.resolveProviderId(context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
        session.context.state.session = sessionDescriptorBuild(source, context, session.id);
        if (context.cron?.filesPath) {
          session.context.state.permissions = permissionBuildCron(
            this.config.defaultPermissions,
            context.cron.filesPath
          );
        } else if (sessionContextIsHeartbeat(context, session.context.state.session)) {
          session.context.state.permissions = permissionMergeDefault(
            session.context.state.permissions,
            this.config.defaultPermissions
          );
          permissionEnsureDefaultFile(
            session.context.state.permissions,
            this.config.defaultPermissions
          );
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
          .recordSessionCreated(session, source, context, session.context.state.session)
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
        this.captureRouting(session, source, entry.context);
        this.captureAgent(session, entry.context);
        logger.info(
          {
            sessionId: session.id,
            source,
            messageId: entry.id,
            pending: session.size
          },
          "Session updated"
        );
        const rawText = entry.message.rawText ?? entry.message.text ?? "";
        if (!messageIsSystemText(rawText)) {
          void this.sessionStore.recordIncoming(session, entry, source).catch((error) => {
            logger.warn(
              { sessionId: session.id, source, messageId: entry.id, error },
              "Session persistence failed"
            );
          });
        }
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
  }

  async load(): Promise<void> {
    if (this.stage !== "idle") {
      return;
    }
    const restoredSessions = await this.sessionStore.loadSessions();

    for (const restored of restoredSessions) {
      const restoredSessionId = cuid2Is(restored.sessionId ?? null)
        ? restored.sessionId
        : createId();
      const session = this.sessionManager.restoreSession(
        restoredSessionId,
        restored.storageId,
        sessionStateNormalize(restored.state, this.config.defaultPermissions),
        restored.createdAt,
        restored.updatedAt
      );
      const restoredDescriptor = restored.descriptor
        ? normalizeSessionDescriptor(restored.descriptor)
        : undefined;
      if (restoredDescriptor) {
        session.context.state.session = restoredDescriptor;
      }
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
      const sessionKey = session.context.state.session
        ? sessionKeyBuild(session.context.state.session)
        : null;
      if (sessionKey) {
        this.sessionKeyMap.set(sessionKey, session.id);
      }
      if (restoredSessionId !== restored.sessionId) {
        void this.sessionStore.recordState(session).catch((error) => {
          logger.warn({ sessionId: session.id, error }, "Session id migration failed");
        });
      }
      if (restored.lastEntryType === "incoming") {
        if (session.context.state.session?.type === "subagent") {
          this.pendingSubagentFailures.push(session.id);
        } else {
          this.pendingInternalErrors.push({
            sessionId: session.id,
            source: restored.source,
            context: restored.context
          });
        }
      }
    }

    this.stage = "loaded";
  }

  enableScheduling(): void {
    if (this.stage === "idle") {
      throw new Error("AgentSystem must load before scheduling messages");
    }
    if (this.stage === "loaded") {
      this.stage = "scheduling";
    }
  }

  async start(): Promise<void> {
    if (this.stage === "running") {
      return;
    }
    if (this.stage === "idle") {
      throw new Error("AgentSystem must load before starting");
    }
    this.stage = "running";
    await this.notifyPendingSubagentFailures(this.pendingSubagentFailures);
    await this.sendPendingInternalErrors(this.pendingInternalErrors);
    this.pendingSubagentFailures = [];
    this.pendingInternalErrors = [];
    await this.drainQueue();
  }

  async scheduleMessage(
    source: string,
    message: ConnectorMessage,
    context: MessageContext
  ): Promise<void> {
    if (this.stage === "idle") {
      logger.warn(
        { source, channelId: context.channelId },
        "AgentSystem received message before load"
      );
    } else if (this.stage === "loaded") {
      logger.debug(
        { source, channelId: context.channelId },
        "AgentSystem queueing message before scheduling enabled"
      );
    }
    const messageContext = this.withProviderContext(context);
    this.queuedMessages.push({ source, message, context: messageContext });
    if (this.stage === "running") {
      await this.drainQueue();
    }
  }

  reload(config: Config): void {
    this.config = config;
  }

  getBackgroundAgents(): BackgroundAgentState[] {
    return this.sessionManager
      .listSessions()
      .filter((session) => session.context.state.agent?.kind === "background")
      .map((session) => {
        const pending = session.size;
        const processing = session.isProcessing();
        const status = processing ? "running" : pending > 0 ? "queued" : "idle";
        return {
          sessionId: session.id,
          storageId: session.storageId,
          name: session.context.state.agent?.name,
          parentSessionId: session.context.state.agent?.parentSessionId,
          status,
          pending,
          updatedAt: session.context.updatedAt?.toISOString()
        };
      });
  }

  getSessionById(sessionId: string) {
    return this.sessionManager.getById(sessionId);
  }

  getSessionByStorageId(storageId: string) {
    return this.sessionManager.getByStorageId(storageId);
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
      context: { channelId: session.id, userId: "system", sessionId: session.id }
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
      context: { channelId: session.id, userId: "system", sessionId }
    });
    return true;
  }

  resolveSessionIdForContext(source: string, context: MessageContext): string | null {
    let sessionId = cuid2Is(context.sessionId ?? null) ? context.sessionId! : null;
    if (!sessionId) {
      const key = sessionKeyResolve(source, context, logger);
      if (key) {
        sessionId = this.sessionKeyMap.get(key) ?? null;
      }
    }
    return sessionId;
  }

  async startBackgroundAgent(args: {
    prompt: string;
    sessionId?: string;
    name?: string;
    parentSessionId?: string;
    context?: Partial<MessageContext>;
  }): Promise<{ sessionId: string }> {
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new Error("Background agent prompt is required");
    }
    const sessionId = cuid2Is(args.sessionId ?? null) ? args.sessionId! : createId();
    const isSubagent = !args.context?.cron && !args.context?.heartbeat;
    const agentParent = args.parentSessionId ?? args.context?.agent?.parentSessionId;
    const agentName = args.name ?? args.context?.agent?.name ?? (isSubagent ? "subagent" : undefined);
    if (isSubagent && !agentParent) {
      throw new Error("Subagent parent session is required");
    }
    const agentContext = {
      kind: "background" as const,
      parentSessionId: agentParent,
      name: agentName
    };
    const messageContext: MessageContext = {
      channelId: sessionId,
      userId: "system",
      sessionId,
      agent: agentContext,
      ...(args.context ?? {})
    };
    messageContext.channelId = sessionId;
    messageContext.sessionId = sessionId;
    messageContext.agent = { ...agentContext, ...(args.context?.agent ?? {}) };
    const message: ConnectorMessage = { text: prompt };
    const startPromise = this.scheduleMessage("system", message, messageContext);
    startPromise.catch((error) => {
      logger.warn({ sessionId, error }, "Background agent start failed");
    });
    return { sessionId };
  }

  async sendSessionMessage(args: {
    sessionId?: string;
    text: string;
    origin?: "background" | "system";
  }): Promise<void> {
    const targetSessionId = args.sessionId ?? this.resolveSessionId("most-recent-foreground");
    if (!targetSessionId) {
      throw new Error("No recent foreground session found.");
    }
    const session = this.sessionManager.getById(targetSessionId);
    if (!session) {
      throw new Error(`Session not found: ${targetSessionId}`);
    }
    const routing = session.context.state.routing;
    if (!routing) {
      throw new Error(`Session routing unavailable: ${targetSessionId}`);
    }
    const source = routing.source;
    if (!this.connectorRegistry.get(source)) {
      throw new Error(`Connector unavailable for session: ${source}`);
    }
    const context = { ...routing.context, messageId: undefined, commands: undefined };
    const message: ConnectorMessage = {
      text: messageBuildSystemText(args.text, args.origin)
    };
    await this.scheduleMessage(source, message, context);
  }

  withProviderContext(context: MessageContext): MessageContext {
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
    const providers = listActiveInferenceProviders(this.config.settings);
    return providers[0]?.id;
  }

  private captureRouting(
    session: Session<SessionState>,
    source: string,
    context: MessageContext
  ): void {
    session.context.state.routing = {
      source,
      context: sessionRoutingSanitize(context)
    };
  }

  private captureAgent(
    session: Session<SessionState>,
    context: MessageContext
  ): void {
    if (context.agent?.kind === "background") {
      session.context.state.agent = {
        kind: "background",
        parentSessionId: context.agent.parentSessionId,
        name: context.agent.name
      };
    }
  }

  private async notifyPendingSubagentFailures(
    sessionIds: string[]
  ): Promise<void> {
    for (const sessionId of sessionIds) {
      const session = this.sessionManager.getById(sessionId);
      if (!session) {
        continue;
      }
      const agent = Agent.fromSession(session, this);
      await agent.notifySubagentFailure("Restored with pending work");
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
    session: Session<SessionState>,
    source: string
  ): Promise<void> {
    const agent = Agent.fromMessage(session, source, entry.context, this);
    await agent.handleMessage(entry, source);
  }

  private async drainQueue(): Promise<void> {
    if (this.drainingQueue || this.stage !== "running") {
      return;
    }
    this.drainingQueue = true;
    try {
      while (this.queuedMessages.length > 0) {
        const next = this.queuedMessages.shift();
        if (!next) {
          continue;
        }
        await this.sessionManager.handleMessage(
          next.source,
          next.message,
          next.context,
          (session, entry) => this.handleSessionMessage(entry, session, next.source)
        );
      }
    } finally {
      this.drainingQueue = false;
      if (this.queuedMessages.length > 0 && this.stage === "running") {
        await this.drainQueue();
      }
    }
  }

  resolveSessionId(strategy: SessionFetchStrategy): string | null {
    const sessions = this.sessionManager.listSessions();
    const candidates = sessions.filter((session) => {
      const sessionDescriptor = session.context.state.session;
      if (!sessionDescriptor) {
        return false;
      }
      return sessionDescriptorMatchesStrategy(sessionDescriptor, strategy);
    });
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => {
      const aTime = sessionTimestampGet(a.context.updatedAt ?? a.context.createdAt);
      const bTime = sessionTimestampGet(b.context.updatedAt ?? b.context.createdAt);
      return bTime - aTime;
    });
    return candidates[0]?.id ?? null;
  }

  getOrCreateSessionIdForDescriptor(descriptor: SessionDescriptor): string {
    const key = sessionKeyBuild(descriptor);
    return key ? this.getOrCreateSessionId(key) : createId();
  }

  private getOrCreateSessionId(key: string): string {
    const existing = this.sessionKeyMap.get(key);
    if (existing) {
      return existing;
    }
    const id = createId();
    this.sessionKeyMap.set(key, id);
    return id;
  }
}
