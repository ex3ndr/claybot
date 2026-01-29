import { randomUUID } from "node:crypto";

import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import { Session } from "./session.js";
import type { SessionMessage } from "./types.js";

export type SessionHandler<State = Record<string, unknown>> = (
  session: Session<State>,
  message: SessionMessage
) => void | Promise<void>;

export type SessionManagerOptions<State = Record<string, unknown>> = {
  now?: () => Date;
  createState?: () => State;
  idFactory?: () => string;
  sessionIdFor?: (source: string, context: MessageContext) => string;
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
  private sessionIdFor: (source: string, context: MessageContext) => string;
  private onError?: SessionManagerOptions<State>["onError"];

  constructor(options: SessionManagerOptions<State> = {}) {
    this.now = options.now ?? (() => new Date());
    this.createState =
      options.createState ?? (() => ({} as Record<string, unknown> as State));
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.sessionIdFor =
      options.sessionIdFor ??
      ((source, context) => {
        if (context.sessionId) {
          return context.sessionId;
        }
        return `${source}:${context.channelId}`;
      });
    this.onError = options.onError;
  }

  getSession(source: string, context: MessageContext): Session<State> {
    const id = this.sessionIdFor(source, context);
    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }

    const now = this.now();
    const session = new Session<State>(id, {
      id,
      createdAt: now,
      updatedAt: now,
      state: this.createState()
    });

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

    if (session.isProcessing()) {
      return entry;
    }

    session.setProcessing(true);

    try {
      while (session.peek()) {
        const current = session.peek()!;
        try {
          await handler(session, current);
        } catch (error) {
          if (this.onError) {
            await this.onError(error, session, current);
          }
        } finally {
          session.dequeue();
        }
      }
    } finally {
      session.setProcessing(false);
    }

    return entry;
  }
}
