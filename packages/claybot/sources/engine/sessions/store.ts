import { promises as fs } from "node:fs";
import path from "node:path";

import { createId } from "@paralleldrive/cuid2";
import type { Context } from "@mariozechner/pi-ai";

import type { MessageContext } from "@/types";
import type { FileReference } from "@/types";
import type { Session } from "./session.js";
import type { SessionMessage, SessionSummary } from "./types.js";
import { normalizeSessionDescriptor, type SessionDescriptor } from "./descriptor.js";
import { resolveClaybotPath } from "../../paths.js";
import { serializeContextMessages } from "./context-log.js";

export type SessionLogEntry<State = Record<string, unknown>> =
  | {
      type: "session_created";
      sessionId: string;
      storageId: string;
      source: string;
      context: MessageContext;
      session?: SessionDescriptor;
      createdAt: string;
    }
  | {
      type: "model_context";
      sessionId: string;
      storageId: string;
      source: string;
      messageId?: string;
      iteration?: number;
      messages: Context["messages"];
      createdAt: string;
    }
  | {
      type: "incoming";
      sessionId: string;
      storageId: string;
      source: string;
      messageId: string;
      context: MessageContext;
      text: string | null;
      files?: FileReference[];
      receivedAt: string;
    }
  | {
      type: "outgoing";
      sessionId: string;
      storageId: string;
      source: string;
      origin?: "model" | "system";
      messageId: string;
      context: MessageContext;
      text: string | null;
      files?: FileReference[];
      sentAt: string;
    }
  | {
      type: "session_reset";
      sessionId: string;
      storageId: string;
      source: string;
      messageId?: string;
      ok: boolean;
      createdAt: string;
    }
  | {
      type: "session_compaction";
      sessionId: string;
      storageId: string;
      source: string;
      messageId?: string;
      ok: boolean;
      summary?: string;
      error?: string;
      createdAt: string;
    }
  | {
      type: "state";
      sessionId: string;
      storageId: string;
      updatedAt: string;
      state: State;
    };

export type RestoredSession<State> = {
  sessionId: string;
  storageId: string;
  source: string;
  context: MessageContext;
  state: State;
  createdAt?: Date;
  updatedAt?: Date;
  lastEntryType?: "incoming" | "outgoing";
  descriptor?: SessionDescriptor;
};

export type SessionStoreOptions = {
  basePath?: string;
};

const DEFAULT_BASE_PATH = resolveClaybotPath("sessions");

export class SessionStore<State = Record<string, unknown>> {
  private basePath: string;

  constructor(options: SessionStoreOptions = {}) {
    this.basePath = options.basePath ?? DEFAULT_BASE_PATH;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  createStorageId(): string {
    return createId();
  }

  async recordSessionCreated(
    session: Session<State>,
    source: string,
    context: MessageContext,
    descriptor?: SessionDescriptor
  ): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "session_created",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      context,
      session: descriptor,
      createdAt: session.context.createdAt.toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordIncoming(
    session: Session<State>,
    message: SessionMessage,
    source: string
  ): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "incoming",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      messageId: message.id,
      context: message.context,
      text: message.message.text ?? null,
      files: message.message.files,
      receivedAt: message.receivedAt.toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordModelContext(
    session: Session<State>,
    source: string,
    context: Context,
    options: { messageId?: string; iteration?: number } = {}
  ): Promise<void> {
    const messages = serializeContextMessages(context.messages);
    const entry: SessionLogEntry<State> = {
      type: "model_context",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      messageId: options.messageId,
      iteration: options.iteration,
      messages,
      createdAt: new Date().toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordOutgoing(
    session: Session<State>,
    messageId: string,
    source: string,
    context: MessageContext,
    text: string | null,
    files?: FileReference[],
    origin?: "model" | "system"
  ): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "outgoing",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      origin,
      messageId,
      context,
      text,
      files,
      sentAt: new Date().toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordSessionReset(
    session: Session<State>,
    source: string,
    options: { messageId?: string; ok: boolean }
  ): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "session_reset",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      messageId: options.messageId,
      ok: options.ok,
      createdAt: new Date().toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordSessionCompaction(
    session: Session<State>,
    source: string,
    options: { messageId?: string; ok: boolean; summary?: string; error?: string }
  ): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "session_compaction",
      sessionId: session.id,
      storageId: session.storageId,
      source,
      messageId: options.messageId,
      ok: options.ok,
      summary: options.summary,
      error: options.error,
      createdAt: new Date().toISOString()
    };
    await this.appendEntry(session.storageId, entry);
  }

  async recordState(session: Session<State>): Promise<void> {
    const entry: SessionLogEntry<State> = {
      type: "state",
      sessionId: session.id,
      storageId: session.storageId,
      updatedAt: session.context.updatedAt.toISOString(),
      state: session.context.state
    };
    await this.appendEntry(session.storageId, entry);
  }

  async loadSessions(): Promise<RestoredSession<State>[]> {
    try {
      await this.ensureDir();
    } catch {
      return [];
    }

    let files: string[] = [];
    try {
      files = await fs.readdir(this.basePath);
    } catch {
      return [];
    }

    const restored: RestoredSession<State>[] = [];

    for (const file of files) {
      const storageId = path.parse(file).name || file;
      const fullPath = path.join(this.basePath, file);
      let raw = "";
      try {
        raw = await fs.readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = raw.split("\n").filter(Boolean);
      if (lines.length === 0) {
        continue;
      }

      let sessionId: string | null = null;
      let source: string | null = null;
      let context: MessageContext | null = null;
      let state: State | null = null;
      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;
      let lastEntryType: "incoming" | "outgoing" | undefined;
      let descriptor: SessionDescriptor | undefined;

      for (const line of lines) {
        let parsed: SessionLogEntry<State> | null = null;
        try {
          parsed = JSON.parse(line) as SessionLogEntry<State>;
        } catch {
          continue;
        }

        if (!parsed || typeof parsed !== "object") {
          continue;
        }

        if (!("sessionId" in parsed) || typeof parsed.sessionId !== "string") {
          continue;
        }

        sessionId = parsed.sessionId;

        if (parsed.type === "session_created") {
          source = parsed.source;
          context = parsed.context;
          createdAt = new Date(parsed.createdAt);
          descriptor = normalizeSessionDescriptor(parsed.session);
        }

        if (parsed.type === "incoming") {
          source = parsed.source;
          context = parsed.context;
          lastEntryType = "incoming";
          updatedAt = new Date(parsed.receivedAt);
        }

        if (parsed.type === "outgoing") {
          source = parsed.source;
          context = parsed.context;
          lastEntryType = "outgoing";
          updatedAt = new Date(parsed.sentAt);
        }

        if (parsed.type === "model_context") {
          updatedAt = new Date(parsed.createdAt);
        }

        if (parsed.type === "session_reset" || parsed.type === "session_compaction") {
          updatedAt = new Date(parsed.createdAt);
        }

        if (parsed.type === "state") {
          state = parsed.state;
          updatedAt = new Date(parsed.updatedAt);
          // State entry means processing completed successfully, clear pending status
          lastEntryType = undefined;
        }
      }

      if (!sessionId || !source || !context) {
        continue;
      }

      if (!state) {
        state = {} as State;
      }

      restored.push({
        sessionId,
        storageId,
        source,
        context,
        state,
        createdAt,
        updatedAt,
        lastEntryType,
        descriptor
      });
    }

    return restored;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const restored = await this.loadSessions();
    return Promise.all(
      restored.map(async (session) => {
        const entries = await this.readSessionEntries(session.storageId);
        const lastEntry = entries
          .filter((entry) => entry.type === "incoming" || entry.type === "outgoing")
          .slice(-1)[0];
        const lastMessage =
          lastEntry && "text" in lastEntry ? lastEntry.text : undefined;
        const lastFiles =
          lastEntry && "files" in lastEntry ? lastEntry.files : undefined;
        return {
          sessionId: session.sessionId,
          storageId: session.storageId,
          source: session.source,
          context: session.context,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastMessage,
          lastFiles
        };
      })
    );
  }

  async readSessionEntries(storageId: string): Promise<SessionLogEntry<State>[]> {
    const filePath = path.join(this.basePath, `${storageId}.jsonl`);
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as SessionLogEntry<State>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SessionLogEntry<State> => Boolean(entry));
  }

  private async appendEntry(
    storageId: string,
    entry: SessionLogEntry<State>
  ): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.basePath, `${storageId}.jsonl`);
    const line = `${JSON.stringify(entry)}\n`;
    await fs.appendFile(filePath, line, "utf8");
  }
}
