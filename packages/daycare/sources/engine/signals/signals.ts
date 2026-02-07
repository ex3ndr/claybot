import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { Signal, SignalGenerateInput, SignalSource } from "./signalTypes.js";

const logger = getLogger("signal.facade");
const SOURCE_SET = new Set<SignalSource>(["webhook", "agent", "process"]);

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

    const source = input.source ?? "process";
    if (!SOURCE_SET.has(source)) {
      throw new Error(`Unsupported signal source: ${source}`);
    }

    const signal: Signal = {
      id: createId(),
      type,
      source,
      data: input.data,
      agentId: input.agentId,
      createdAt: Date.now()
    };

    this.eventBus.emit("signal.generated", signal);
    logger.info(
      {
        signalId: signal.id,
        type: signal.type,
        source: signal.source,
        agentId: signal.agentId ?? null
      },
      "Signal generated"
    );

    return signal;
  }
}
