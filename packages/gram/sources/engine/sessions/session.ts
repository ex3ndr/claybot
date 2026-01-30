import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import type { SessionContext, SessionMessage } from "./types.js";

export class Session<State = Record<string, unknown>> {
  readonly id: string;
  readonly storageId: string;
  readonly context: SessionContext<State>;
  private queue: SessionMessage[] = [];
  private processing = false;

  constructor(id: string, context: SessionContext<State>, storageId: string) {
    this.id = id;
    this.storageId = storageId;
    this.context = context;
  }

  enqueue(
    message: ConnectorMessage,
    context: MessageContext,
    receivedAt: Date,
    messageId: string
  ): SessionMessage {
    const entry: SessionMessage = {
      id: messageId,
      message,
      context,
      receivedAt
    };

    this.queue.push(entry);
    this.context.updatedAt = receivedAt;
    return entry;
  }

  dequeue(): SessionMessage | undefined {
    return this.queue.shift();
  }

  peek(): SessionMessage | undefined {
    return this.queue[0];
  }

  listPending(): SessionMessage[] {
    return [...this.queue];
  }

  get size(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  setProcessing(state: boolean): void {
    this.processing = state;
  }
}
