import type { Context } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import { DEFAULT_SOUL_PATH, DEFAULT_USER_PATH } from "../../paths.js";
import { listActiveInferenceProviders } from "../../providers/catalog.js";
import { cuid2Is } from "../../utils/cuid2Is.js";
import { agentPromptFilesEnsure } from "./agentPromptFilesEnsure.js";
import { agentSystemPromptBuild } from "./agentSystemPromptBuild.js";
import type { MessageContext } from "../modules/connectors/types.js";
import { messageBuildUser } from "../messages/messageBuildUser.js";
import { permissionBuildCron } from "../permissions/permissionBuildCron.js";
import { permissionClone } from "../permissions/permissionClone.js";
import { permissionEnsureDefaultFile } from "../permissions/permissionEnsureDefaultFile.js";
import { permissionMergeDefault } from "../permissions/permissionMergeDefault.js";
import { skillListCore } from "../skills/skillListCore.js";
import { skillListRegistered } from "../skills/skillListRegistered.js";
import { skillPromptFormat } from "../skills/skillPromptFormat.js";
import { Session } from "../sessions/session.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import { sessionContextIsCron } from "../sessions/sessionContextIsCron.js";
import { sessionContextIsHeartbeat } from "../sessions/sessionContextIsHeartbeat.js";
import { sessionDescriptorBuild } from "../sessions/sessionDescriptorBuild.js";
import { sessionRecordOutgoing } from "../sessions/sessionRecordOutgoing.js";
import { sessionRecordState } from "../sessions/sessionRecordState.js";
import { sessionStateNormalize } from "../sessions/sessionStateNormalize.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionMessage } from "../sessions/types.js";
import { toolListContextBuild } from "../modules/tools/toolListContextBuild.js";
import type {
  AgentDescriptor,
  AgentInboundMessage,
  AgentReceiveResult,
  AgentSystemContext
} from "./agentTypes.js";
import { agentLoopRun } from "./agentLoopRun.js";

const logger = getLogger("engine.agent");

export class Agent {
  readonly session: Session<SessionState>;
  readonly descriptor: SessionDescriptor;
  private agentSystem: AgentSystemContext;
  private sessionStore: AgentSystemContext["sessionStore"];

  private constructor(
    session: Session<SessionState>,
    descriptor: SessionDescriptor,
    agentSystem: AgentSystemContext
  ) {
    this.session = session;
    this.descriptor = descriptor;
    this.agentSystem = agentSystem;
    this.sessionStore = agentSystem.sessionStore;
  }

  /**
   * Loads an agent from the session log.
   * Expects: id is a cuid2 session id, and the stored descriptor equals the requested descriptor.
   */
  static async load(
    descriptor: AgentDescriptor,
    id: string,
    agentSystem: AgentSystemContext
  ): Promise<Agent> {
    if (!cuid2Is(id)) {
      throw new Error("Agent session id must be a cuid2 value.");
    }
    const store = agentSystem.sessionStore;
    const restoredSessions = await store.loadSessions();
    const restored = restoredSessions.find((candidate) => candidate.sessionId === id);
    if (!restored) {
      throw new Error(`Agent session not found: ${id}`);
    }
    if (!restored.descriptor) {
      throw new Error(`Agent session missing descriptor: ${id}`);
    }
    if (!agentDescriptorEquals(descriptor, restored.descriptor)) {
      throw new Error(`Agent descriptor mismatch for session: ${id}`);
    }

    const state = sessionStateNormalize(
      restored.state,
      agentSystem.config.defaultPermissions
    );
    state.session = restored.descriptor;

    const now = new Date();
    const session = new Session<SessionState>(
      id,
      {
        id,
        createdAt: restored.createdAt ?? now,
        updatedAt: restored.updatedAt ?? now,
        state
      },
      restored.storageId
    );

    return new Agent(session, restored.descriptor, agentSystem);
  }

  /**
   * Creates a new agent session and records a session_created entry.
   * Expects: id is a cuid2 session id, descriptor is the session type object to persist.
   */
  static async create(
    descriptor: AgentDescriptor,
    id: string,
    agentSystem: AgentSystemContext
  ): Promise<Agent> {
    if (!cuid2Is(id)) {
      throw new Error("Agent session id must be a cuid2 value.");
    }
    const store = agentSystem.sessionStore;
    const storageId = store.createStorageId();
    const now = new Date();
    const state: SessionState = {
      context: { messages: [] },
      providerId: undefined,
      permissions: permissionClone(agentSystem.config.defaultPermissions),
      session: descriptor
    };
    const session = new Session<SessionState>(
      id,
      {
        id,
        createdAt: now,
        updatedAt: now,
        state
      },
      storageId
    );

    const context = agentContextBuild(descriptor, id);
    await store.recordSessionCreated(session, "agent", context, descriptor);
    await store.recordState(session);

    return new Agent(session, descriptor, agentSystem);
  }

  /**
   * Wraps an existing session for message handling.
   * Expects: session state will be updated with a descriptor if missing.
   */
  static fromMessage(
    session: Session<SessionState>,
    source: string,
    context: MessageContext,
    agentSystem: AgentSystemContext
  ): Agent {
    const descriptor =
      session.context.state.session ?? sessionDescriptorBuild(source, context, session.id);
    if (!session.context.state.session) {
      session.context.state.session = descriptor;
    }
    return new Agent(session, descriptor, agentSystem);
  }

  /**
   * Wraps an existing session that already has a descriptor.
   * Expects: session context includes a session descriptor.
   */
  static fromSession(session: Session<SessionState>, agentSystem: AgentSystemContext): Agent {
    const descriptor = session.context.state.session;
    if (!descriptor) {
      throw new Error(`Agent session missing descriptor: ${session.id}`);
    }
    return new Agent(session, descriptor, agentSystem);
  }

  /**
   * Enqueues a message for the agent session.
   * Expects: inbound context is valid; persistence is queued asynchronously.
   */
  receive(inbound: AgentInboundMessage): AgentReceiveResult {
    const receivedAt = new Date();
    const messageId = createId();
    const context = { ...inbound.context, sessionId: this.session.id };
    const entry = this.session.enqueue(inbound.message, context, receivedAt, messageId);
    const store = this.sessionStore;

    void (async () => {
      try {
        await store.recordIncoming(this.session, entry, inbound.source);
        await store.recordState(this.session);
      } catch (error) {
        logger.warn({ sessionId: this.session.id, error }, "Agent persistence failed");
      }
    })();

    return entry;
  }

  /**
   * Processes a queued session message by running the agent loop.
   * Expects: caller already enqueued the message into the session queue.
   */
  async handleMessage(entry: SessionMessage, source: string): Promise<void> {
    const session = this.session;
    const agentSystem = this.agentSystem;
    const connectorRegistry = agentSystem.connectorRegistry;
    const connector = connectorRegistry.get(source);

    const textLen = entry.message.text?.length ?? 0;
    const fileCount = entry.message.files?.length ?? 0;
    logger.debug(
      `handleMessage started sessionId=${session.id} messageId=${entry.id} source=${source} hasText=${!!entry.message.text} textLength=${textLen} fileCount=${fileCount}`
    );

    if (!entry.message.text && (!entry.message.files || entry.message.files.length === 0)) {
      logger.debug(
        `handleMessage skipping - no text or files sessionId=${session.id} messageId=${entry.id}`
      );
      return;
    }

    const isInternal =
      !connector &&
      (source === "system" || entry.context.agent?.kind === "background" || !!entry.context.cron);
    if (!connector && !isInternal) {
      logger.debug(
        `handleMessage skipping - connector not found sessionId=${session.id} source=${source}`
      );
      return;
    }
    logger.debug(
      `Connector ${connector ? "found" : "not required"} source=${source} internal=${isInternal}`
    );

    if (!session.context.state.session) {
      session.context.state.session = this.descriptor;
    }

    const defaultPermissions = agentSystem.config.defaultPermissions;
    if (entry.context.cron?.filesPath) {
      session.context.state.permissions = permissionBuildCron(
        defaultPermissions,
        entry.context.cron.filesPath
      );
    } else if (sessionContextIsHeartbeat(entry.context, session.context.state.session)) {
      session.context.state.permissions = permissionMergeDefault(
        session.context.state.permissions,
        defaultPermissions
      );
      permissionEnsureDefaultFile(session.context.state.permissions, defaultPermissions);
    }

    await agentPromptFilesEnsure();

    const sessionContext = session.context.state.context;
    const providers = listActiveInferenceProviders(agentSystem.config.settings);
    const providerId = this.resolveSessionProvider(session, entry.context, providers);
    logger.debug(
      `Building context sessionId=${session.id} existingMessageCount=${sessionContext.messages.length}`
    );

    const providerSettings = providerId
      ? providers.find((provider) => provider.id === providerId)
      : providers[0];
    const connectorCapabilities = connector?.capabilities ?? null;
    const fileSendModes = connectorCapabilities?.sendFiles?.modes ?? [];
    const channelType = entry.context.channelType;
    const channelIsPrivate = channelType ? channelType === "private" : null;
    const cronContext = entry.context.cron;
    const cronTaskIds = (await agentSystem.crons.listTasks()).map((task) => task.id);
    const pluginManager = agentSystem.pluginManager;
    const pluginPrompts = await pluginManager.getSystemPrompts();
    const pluginPrompt = pluginPrompts.length > 0 ? pluginPrompts.join("\n\n") : "";
    const coreSkills = await skillListCore();
    const pluginSkills = await skillListRegistered(pluginManager.listRegisteredSkills());
    const skills = [...coreSkills, ...pluginSkills];
    const skillsPrompt = skillPromptFormat(skills);
    const agentKind = session.context.state.agent?.kind ?? entry.context.agent?.kind;
    const allowCronTools = sessionContextIsCron(entry.context, session.context.state.session);
    const systemPrompt = await agentSystemPromptBuild({
      provider: providerSettings?.id,
      model: providerSettings?.model,
      workspace: session.context.state.permissions.workingDir,
      writeDirs: session.context.state.permissions.writeDirs,
      web: session.context.state.permissions.web,
      connector: source,
      canSendFiles: fileSendModes.length > 0,
      fileSendModes: fileSendModes.length > 0 ? fileSendModes.join(", ") : "",
      messageFormatPrompt: connectorCapabilities?.messageFormatPrompt ?? "",
      channelId: entry.context.channelId,
      channelType,
      channelIsPrivate,
      userId: entry.context.userId,
      userFirstName: entry.context.userFirstName,
      userLastName: entry.context.userLastName,
      username: entry.context.username,
      cronTaskId: cronContext?.taskId,
      cronTaskName: cronContext?.taskName,
      cronMemoryPath: cronContext?.memoryPath,
      cronFilesPath: cronContext?.filesPath,
      cronTaskIds: cronTaskIds.length > 0 ? cronTaskIds.join(", ") : "",
      soulPath: DEFAULT_SOUL_PATH,
      userPath: DEFAULT_USER_PATH,
      pluginPrompt,
      skillsPrompt,
      agentKind,
      parentSessionId:
        session.context.state.agent?.parentSessionId ?? entry.context.agent?.parentSessionId,
      configDir: agentSystem.config.configDir
    });
    const context: Context = {
      ...sessionContext,
      tools: this.listContextTools(source, {
        agentKind,
        allowCronTools
      }),
      systemPrompt
    };
    logger.debug(
      `Context built toolCount=${context.tools?.length ?? 0} systemPrompt=${context.systemPrompt ? "set" : "none"}`
    );

    logger.debug("Building user message from entry");
    const userMessage = await messageBuildUser(entry);
    context.messages.push(userMessage);
    logger.debug(`User message added to context totalMessages=${context.messages.length}`);

    const providersForSession = providerId
      ? providers.filter((provider) => provider.id === providerId)
      : [];
    logger.debug(
      `Session provider resolved sessionId=${session.id} providerId=${providerId ?? "none"} providerCount=${providersForSession.length}`
    );

    await agentLoopRun({
      entry,
      session,
      source,
      context,
      connector,
      connectorRegistry,
      inferenceRouter: agentSystem.inferenceRouter,
      toolResolver: agentSystem.toolResolver,
      fileStore: agentSystem.fileStore,
      authStore: agentSystem.authStore,
      sessionStore: this.sessionStore,
      eventBus: agentSystem.eventBus,
      assistant: agentSystem.config.settings.assistant ?? null,
      agentRuntime: agentSystem.agentRuntime,
      providersForSession,
      verbose: agentSystem.config.verbose,
      logger,
      notifySubagentFailure: (reason, error) => this.notifySubagentFailure(reason, error)
    });
  }

  /**
   * Notifies a parent session when a subagent session fails.
   * Expects: agentRuntime can send messages to other sessions.
   */
  async notifySubagentFailure(reason: string, error?: unknown): Promise<void> {
    const descriptor = this.session.context.state.session;
    if (descriptor?.type !== "subagent") {
      return;
    }
    const parentSessionId =
      descriptor.parentSessionId ?? this.session.context.state.agent?.parentSessionId;
    if (!parentSessionId) {
      logger.warn({ sessionId: this.session.id }, "Subagent missing parent session");
      return;
    }
    const name = descriptor.name ?? this.session.context.state.agent?.name ?? "subagent";
    const errorText = error instanceof Error ? error.message : error ? String(error) : "";
    const detail = errorText ? `${reason} (${errorText})` : reason;
    try {
      await this.agentSystem.agentRuntime.sendSessionMessage({
        sessionId: parentSessionId,
        text: `Subagent ${name} (${this.session.id}) failed: ${detail}.`,
        origin: "background"
      });
    } catch (sendError) {
      logger.warn(
        { sessionId: this.session.id, parentSessionId, error: sendError },
        "Subagent failure notification failed"
      );
    }
  }

  private listContextTools(
    source?: string,
    options?: { agentKind?: "background" | "foreground"; allowCronTools?: boolean }
  ) {
    return toolListContextBuild({
      tools: this.agentSystem.toolResolver.listTools(),
      source,
      agentKind: options?.agentKind,
      allowCronTools: options?.allowCronTools,
      connectorRegistry: this.agentSystem.connectorRegistry,
      imageRegistry: this.agentSystem.imageRegistry
    });
  }

  private resolveSessionProvider(
    session: Session<SessionState>,
    context: MessageContext,
    providers: ReturnType<typeof listActiveInferenceProviders>
  ): string | undefined {
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
}

function agentDescriptorEquals(
  expected: SessionDescriptor,
  actual: SessionDescriptor
): boolean {
  if (expected.type !== actual.type) {
    return false;
  }
  switch (expected.type) {
    case "user":
      return (
        actual.type === "user" &&
        actual.connector === expected.connector &&
        actual.channelId === expected.channelId &&
        actual.userId === expected.userId
      );
    case "cron":
      return actual.type === "cron" && actual.id === expected.id;
    case "heartbeat":
      return actual.type === "heartbeat";
    case "subagent":
      return (
        actual.type === "subagent" &&
        actual.id === expected.id &&
        actual.parentSessionId === expected.parentSessionId &&
        actual.name === expected.name
      );
    default:
      return false;
  }
}

function agentContextBuild(descriptor: SessionDescriptor, sessionId: string): MessageContext {
  switch (descriptor.type) {
    case "user":
      return {
        channelId: descriptor.channelId,
        userId: descriptor.userId,
        sessionId
      };
    case "cron":
      return {
        channelId: descriptor.id,
        userId: "cron",
        sessionId
      };
    case "heartbeat":
      return {
        channelId: sessionId,
        userId: "heartbeat",
        sessionId,
        heartbeat: {}
      };
    case "subagent":
      return {
        channelId: sessionId,
        userId: "system",
        sessionId,
        agent: {
          kind: "background",
          parentSessionId: descriptor.parentSessionId,
          name: descriptor.name
        }
      };
    default:
      return {
        channelId: sessionId,
        userId: "system",
        sessionId
      };
  }
}
