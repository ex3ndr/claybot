import { createId } from "@paralleldrive/cuid2";

import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import { Session } from "./session.js";
import type { SessionMessage } from "./types.js";

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
    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }

    const now = this.now();
    const storageId = this.storageIdFactory();
    const session = new Session<State>(id, {
      id,
      createdAt: now,
      updatedAt: now,
      state: this.createState()
    }, storageId);

    this.sessions.set(id, session);
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
    const existing = this.sessions.get(id);
    if (existing) {
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
    return session;
  }

  async handleMessage(
    source: string,
    message: ConnectorMessage,
    context: MessageContext,
    handler: SessionHandler<State>
  ): Promise<SessionMessage> {
    const session = this.getSession(source, context);
    const entry = session.enqueue(message, context, this.now(), this.idFactory());

    if (this.onSessionUpdated) {
      void this.onSessionUpdated(session, entry, source);
    }

    if (session.isProcessing()) {
      return entry;
    }

    session.setProcessing(true);

    try {
      while (session.peek()) {
        const current = session.peek()!;
        try {
          if (this.onMessageStart) {
            await this.onMessageStart(session, current, source);
          }
          await handler(session, current);
        } catch (error) {
          if (this.onError) {
            await this.onError(error, session, current);
          }
        } finally {
          if (this.onMessageEnd) {
            await this.onMessageEnd(session, current, source);
          }
          session.dequeue();
        }
      }
    } finally {
      session.setProcessing(false);
    }

    return entry;
  }
}
