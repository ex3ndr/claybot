import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import { Session } from "./session.js";
import type { SessionMessage } from "./types.js";

const logger = getLogger("sessions.manager");

export type SessionHandler<State = Record<string, unknown>> = (
  session: Session<State>,
  message: SessionMessage
) => void | Promise<void>;

export type SessionCreatedHandler<State = Record<string, unknown>> = (
  session: Session<State>,
  source: string,
  context: MessageContext
) => void | Promise<void>;

export type SessionUpdatedHandler<State = Record<string, unknown>> = (
  session: Session<State>,
  message: SessionMessage,
  source: string
) => void | Promise<void>;

export type SessionMessageHandler<State = Record<string, unknown>> = (
  session: Session<State>,
  message: SessionMessage,
  source: string
) => void | Promise<void>;

export type SessionManagerOptions<State = Record<string, unknown>> = {
  now?: () => Date;
  createState?: () => State;
  idFactory?: () => string;
  storageIdFactory?: () => string;
  sessionIdFor?: (source: string, context: MessageContext) => string;
  onSessionCreated?: SessionCreatedHandler<State>;
  onSessionUpdated?: SessionUpdatedHandler<State>;
  onMessageStart?: SessionMessageHandler<State>;
  onMessageEnd?: SessionMessageHandler<State>;
  onError?: (
    error: unknown,
    session: Session<State>,
    message: SessionMessage
  ) => void | Promise<void>;
};

export class SessionManager<State = Record<string, unknown>> {
  private sessions = new Map<string, Session<State>>();
  private now: () => Date;
  private createState: () => State;
  private idFactory: () => string;
  private storageIdFactory: () => string;
  private sessionIdFor: (source: string, context: MessageContext) => string;
  private onSessionCreated?: SessionCreatedHandler<State>;
  private onSessionUpdated?: SessionUpdatedHandler<State>;
  private onMessageStart?: SessionMessageHandler<State>;
  private onMessageEnd?: SessionMessageHandler<State>;
  private onError?: SessionManagerOptions<State>["onError"];

  constructor(options: SessionManagerOptions<State> = {}) {
    this.now = options.now ?? (() => new Date());
    this.createState =
      options.createState ?? (() => ({} as Record<string, unknown> as State));
    this.idFactory = options.idFactory ?? (() => createId());
    this.storageIdFactory = options.storageIdFactory ?? (() => createId());
    this.sessionIdFor =
      options.sessionIdFor ??
      ((source, context) => {
        if (context.sessionId) {
          return context.sessionId;
        }
        return `${source}:${context.channelId}`;
      });
    this.onError = options.onError;
    this.onSessionCreated = options.onSessionCreated;
    this.onSessionUpdated = options.onSessionUpdated;
    this.onMessageStart = options.onMessageStart;
    this.onMessageEnd = options.onMessageEnd;
  }

  getSession(source: string, context: MessageContext): Session<State> {
    const id = this.sessionIdFor(source, context);
    logger.debug({ sessionId: id, source, channelId: context.channelId }, "[VERBOSE] getSession() called");
    const existing = this.sessions.get(id);
    if (existing) {
      logger.debug({ sessionId: id }, "[VERBOSE] Returning existing session");
      return existing;
    }

    logger.debug({ sessionId: id }, "[VERBOSE] Creating new session");
    const now = this.now();
    const storageId = this.storageIdFactory();
    const session = new Session<State>(id, {
      id,
      createdAt: now,
      updatedAt: now,
      state: this.createState()
    }, storageId);

    this.sessions.set(id, session);
    logger.debug({ sessionId: id, storageId, totalSessions: this.sessions.size }, "[VERBOSE] New session created");
    if (this.onSessionCreated) {
      void this.onSessionCreated(session, source, context);
    }
    return session;
  }

  restoreSession(
    id: string,
    storageId: string,
    contextState: State,
    createdAt?: Date,
    updatedAt?: Date
  ): Session<State> {
    logger.debug({ sessionId: id, storageId }, "[VERBOSE] restoreSession() called");
    const existing = this.sessions.get(id);
    if (existing) {
      logger.debug({ sessionId: id }, "[VERBOSE] Session already exists, returning existing");
      return existing;
    }

    const now = this.now();
    const session = new Session<State>(id, {
      id,
      createdAt: createdAt ?? now,
      updatedAt: updatedAt ?? now,
      state: contextState
    }, storageId);

    this.sessions.set(id, session);
    logger.debug({ sessionId: id, totalSessions: this.sessions.size }, "[VERBOSE] Session restored");
    return session;
  }

  async handleMessage(
    source: string,
    message: ConnectorMessage,
    context: MessageContext,
    handler: SessionHandler<State>
  ): Promise<SessionMessage> {
    logger.debug(
      { source, channelId: context.channelId, hasText: !!message.text, fileCount: message.files?.length ?? 0 },
      "[VERBOSE] handleMessage() called"
    );
    const session = this.getSession(source, context);
    const entry = session.enqueue(message, context, this.now(), this.idFactory());
    logger.debug({ sessionId: session.id, messageId: entry.id, queueSize: session.size }, "[VERBOSE] Message enqueued");

    if (this.onSessionUpdated) {
      void this.onSessionUpdated(session, entry, source);
    }

    if (session.isProcessing()) {
      logger.debug({ sessionId: session.id, messageId: entry.id }, "[VERBOSE] Session already processing, message queued");
      return entry;
    }

    logger.debug({ sessionId: session.id }, "[VERBOSE] Starting session processing loop");
    session.setProcessing(true);

    try {
      let processedCount = 0;
      while (session.peek()) {
        const current = session.peek()!;
        logger.debug(
          { sessionId: session.id, messageId: current.id, processedCount, remaining: session.size },
          "[VERBOSE] Processing message from queue"
        );
        try {
          if (this.onMessageStart) {
            await this.onMessageStart(session, current, source);
          }
          await handler(session, current);
          logger.debug({ sessionId: session.id, messageId: current.id }, "[VERBOSE] Message handler completed");
        } catch (error) {
          logger.debug({ sessionId: session.id, messageId: current.id, error: String(error) }, "[VERBOSE] Message handler threw error");
          if (this.onError) {
            await this.onError(error, session, current);
          }
        } finally {
          if (this.onMessageEnd) {
            await this.onMessageEnd(session, current, source);
          }
          session.dequeue();
          processedCount++;
        }
      }
      logger.debug({ sessionId: session.id, processedCount }, "[VERBOSE] Session processing loop complete");
    } finally {
      session.setProcessing(false);
      logger.debug({ sessionId: session.id }, "[VERBOSE] Session processing stopped");
    }

    return entry;
  }
}
