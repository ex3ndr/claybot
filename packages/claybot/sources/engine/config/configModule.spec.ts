import path from "node:path";
import { describe, expect, it } from "vitest";

import { configResolve } from "../../config/configResolve.js";
import { ConfigModule } from "./configModule.js";

describe("ConfigModule", () => {
  it("stores and updates current config", () => {
    const first = configResolve({ engine: { dataDir: "/tmp/a" } }, path.join("/tmp/a", "settings.json"));
    const second = configResolve({ engine: { dataDir: "/tmp/b" } }, path.join("/tmp/b", "settings.json"));
    const module = new ConfigModule(first);

    expect(module.configGet().dataDir).toBe(first.dataDir);
    module.configSet(second);
    expect(module.configGet().dataDir).toBe(second.dataDir);
  });
});
