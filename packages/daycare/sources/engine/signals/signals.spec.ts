import { describe, expect, it } from "vitest";

import type { Signal } from "@/types";
import { EngineEventBus } from "../ipc/events.js";
import { Signals } from "./signals.js";

describe("Signals", () => {
  it("emits signal.generated with typed payload", () => {
    const eventBus = new EngineEventBus();
    const signals = new Signals({ eventBus });
    const events: Array<{ type: string; payload: unknown }> = [];

    const unsubscribe = eventBus.onEvent((event) => {
      events.push({ type: event.type, payload: event.payload });
    });

    const signal = signals.generate({
      type: "build.completed",
      source: "process",
      data: { ok: true }
    });

    unsubscribe();

    expect(signal.id.length).toBeGreaterThan(0);
    expect(signal.createdAt).toBeGreaterThan(0);
    expect(signal.type).toBe("build.completed");
    expect(signal.source).toBe("process");
    expect(signal.data).toEqual({ ok: true });

    const generated = events.find((event) => event.type === "signal.generated");
    expect(generated).toBeDefined();
    expect(generated?.payload as Signal).toEqual(signal);
  });
});
