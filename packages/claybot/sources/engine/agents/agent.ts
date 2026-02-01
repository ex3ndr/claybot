import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { MessageContext } from "../connectors/types.js";
import { Session } from "../sessions/session.js";
import { sessionStateNormalize } from "../sessions/sessionStateNormalize.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { AgentDescriptor, AgentEngine, AgentInboundMessage, AgentReceiveResult } from "./agentTypes.js";
import { cuid2Is } from "../../utils/cuid2Is.js";

const logger = getLogger("engine.agent");

export class Agent {
  readonly session: Session<SessionState>;
  readonly descriptor: SessionDescriptor;
  private sessionStore: ReturnType<AgentEngine["getSessionStore"]>;

  private constructor(session: Session<SessionState>, descriptor: SessionDescriptor, engine: AgentEngine) {
    this.session = session;
    this.descriptor = descriptor;
    this.sessionStore = engine.getSessionStore();
  }

  /**
   * Loads an agent from the session log.
   * Expects: id is a cuid2 session id, and the stored descriptor equals the requested descriptor.
   */
  static async load(descriptor: AgentDescriptor, id: string, engine: AgentEngine): Promise<Agent> {
    if (!cuid2Is(id)) {
      throw new Error("Agent session id must be a cuid2 value.");
    }
    const store = engine.getSessionStore();
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

    const state = sessionStateNormalize(restored.state, engine.getDefaultPermissions());
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

    return new Agent(session, restored.descriptor, engine);
  }

  /**
   * Creates a new agent session and records a session_created entry.
   * Expects: id is a cuid2 session id, descriptor is the session type object to persist.
   */
  static async create(descriptor: AgentDescriptor, id: string, engine: AgentEngine): Promise<Agent> {
    if (!cuid2Is(id)) {
      throw new Error("Agent session id must be a cuid2 value.");
    }
    const store = engine.getSessionStore();
    const storageId = store.createStorageId();
    const now = new Date();
    const state: SessionState = {
      context: { messages: [] },
      providerId: undefined,
      permissions: engine.getDefaultPermissions(),
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

    return new Agent(session, descriptor, engine);
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
