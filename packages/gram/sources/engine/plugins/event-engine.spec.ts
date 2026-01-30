import { describe, it, expect } from "vitest";

import { PluginEventEngine } from "./event-engine.js";
import { PluginEventQueue } from "./events.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("PluginEventEngine", () => {
  it("drains queued events on start and handles new events", async () => {
    const queue = new PluginEventQueue();
    const engine = new PluginEventEngine(queue);
    const seen: string[] = [];

    engine.register("test", (event) => {
      seen.push(event.id);
    });

    queue.emit({ pluginId: "demo", instanceId: "one" }, { type: "test" });
    engine.start();
    await tick();
    expect(seen).toHaveLength(1);

    queue.emit({ pluginId: "demo", instanceId: "one" }, { type: "test" });
    await tick();
    expect(seen).toHaveLength(2);
  });
});
