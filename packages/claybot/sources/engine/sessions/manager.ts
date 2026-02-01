import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { ConnectorMessage, MessageContext } from "@/types";
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
  messageTransform?: (
    message: ConnectorMessage,
    context: MessageContext,
    receivedAt: Date
  ) => ConnectorMessage;
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
  private messageTransform?: SessionManagerOptions<State>["messageTransform"];
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
    this.messageTransform = options.messageTransform;
  }

  getSession(source: string, context: MessageContext): Session<State> {
    const id = this.sessionIdFor(source, context);
    logger.debug(`getSession() called sessionId=${id} source=${source} channelId=${context.channelId}`);
    const existing = this.sessions.get(id);
    if (existing) {
      logger.debug(`Returning existing session sessionId=${id}`);
      return existing;
    }

    logger.debug(`Creating new session sessionId=${id}`);
    const now = this.now();
    const storageId = this.storageIdFactory();
    const session = new Session<State>(id, {
      id,
      createdAt: now,
      updatedAt: now,
      state: this.createState()
    }, storageId);

    this.sessions.set(id, session);
    logger.debug(`New session created sessionId=${id} storageId=${storageId} totalSessions=${this.sessions.size}`);
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
    logger.debug(`restoreSession() called sessionId=${id} storageId=${storageId}`);
    const existing = this.sessions.get(id);
    if (existing) {
      logger.debug(`Session already exists, returning existing sessionId=${id}`);
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
    logger.debug(`Session restored sessionId=${id} totalSessions=${this.sessions.size}`);
    return session;
  }

  getByStorageId(storageId: string): Session<State> | null {
    for (const session of this.sessions.values()) {
      if (session.storageId === storageId) {
        return session;
      }
    }
    return null;
  }

  getById(sessionId: string): Session<State> | null {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions(): Session<State>[] {
    return Array.from(this.sessions.values());
  }

  resetSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.resetContext(this.now());
    return true;
  }

  resetByStorageId(storageId: string): boolean {
    const session = this.getByStorageId(storageId);
    if (!session) {
      return false;
    }
    session.resetContext(this.now());
    return true;
  }

  async handleMessage(
    source: string,
    message: ConnectorMessage,
    context: MessageContext,
    handler: SessionHandler<State>
  ): Promise<SessionMessage> {
    logger.debug(`handleMessage() called source=${source} channelId=${context.channelId} hasText=${!!message.text} fileCount=${message.files?.length ?? 0}`);
    const session = this.getSession(source, context);
    const receivedAt = this.now();
    const normalizedMessage = this.messageTransform
      ? this.messageTransform(message, context, receivedAt)
      : message;
    const entry = session.enqueue(normalizedMessage, context, receivedAt, this.idFactory());
    logger.debug(`Message enqueued sessionId=${session.id} messageId=${entry.id} queueSize=${session.size}`);

    if (this.onSessionUpdated) {
      void this.onSessionUpdated(session, entry, source);
    }

    if (session.isProcessing()) {
      logger.debug(`Session already processing, message queued sessionId=${session.id} messageId=${entry.id}`);
      return entry;
    }

    logger.debug(`Starting session processing loop sessionId=${session.id}`);
    session.setProcessing(true);

    try {
      let processedCount = 0;
      while (session.peek()) {
        const current = session.peek()!;
        logger.debug(`Processing message from queue sessionId=${session.id} messageId=${current.id} processedCount=${processedCount} remaining=${session.size}`);
        try {
          if (this.onMessageStart) {
            await this.onMessageStart(session, current, source);
          }
          await handler(session, current);
          logger.debug(`Message handler completed sessionId=${session.id} messageId=${current.id}`);
        } catch (error) {
          logger.debug(`Message handler threw error sessionId=${session.id} messageId=${current.id} error=${String(error)}`);
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
      logger.debug(`Session processing loop complete sessionId=${session.id} processedCount=${processedCount}`);
    } finally {
      session.setProcessing(false);
      logger.debug(`Session processing stopped sessionId=${session.id}`);
    }

    return entry;
  }
}
