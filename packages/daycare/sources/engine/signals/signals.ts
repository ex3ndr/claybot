import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { Signal, SignalGenerateInput, SignalSource } from "./signalTypes.js";

const logger = getLogger("signal.facade");

export type SignalsOptions = {
  eventBus: EngineEventBus;
};

export class Signals {
  private readonly eventBus: EngineEventBus;

  constructor(options: SignalsOptions) {
    this.eventBus = options.eventBus;
  }

  /**
   * Generates a signal event and publishes it to the engine event bus.
   * Expects: input.type is non-empty after trim.
   */
  generate(input: SignalGenerateInput): Signal {
    const type = input.type.trim();
    if (!type) {
      throw new Error("Signal type is required");
    }

    const source = signalSourceNormalize(input.source);

    const signal: Signal = {
      id: createId(),
      type,
      source,
      data: input.data,
      createdAt: Date.now()
    };

    this.eventBus.emit("signal.generated", signal);
    logger.info(
      {
        signalId: signal.id,
        type: signal.type,
        sourceType: signal.source.type,
        sourceId: "id" in signal.source ? signal.source.id ?? null : null
      },
      "Signal generated"
    );

    return signal;
  }
}

function signalSourceNormalize(source?: SignalSource): SignalSource {
  if (!source) {
    return { type: "system" };
  }
  if (source.type === "system") {
    return { type: "system" };
  }
  if (source.type === "agent") {
    const id = source.id.trim();
    if (!id) {
      throw new Error("Agent signal source id is required");
    }
    return { type: "agent", id };
  }
  if (source.type === "webhook") {
    return {
      type: "webhook",
      id: typeof source.id === "string" && source.id.trim().length > 0
        ? source.id.trim()
        : undefined
    };
  }
  if (source.type === "process") {
    return {
      type: "process",
      id: typeof source.id === "string" && source.id.trim().length > 0
        ? source.id.trim()
        : undefined
    };
  }
  throw new Error(`Unsupported signal source type: ${(source as { type?: unknown }).type}`);
}
