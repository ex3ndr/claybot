import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";

import { agentHistoryAppend } from "./agentHistoryAppend.js";
import { agentHistoryLoad } from "./agentHistoryLoad.js";
import { configResolve } from "../../../config/configResolve.js";
import type { AgentHistoryRecord } from "@/types";

const buildRecord = (record: AgentHistoryRecord) => record;

describe("agentHistoryLoad", () => {
  it("returns records after the most recent start/reset marker", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "claybot-agent-history-"));
    const agentId = createId();
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );

      await agentHistoryAppend(config, agentId, buildRecord({ type: "start", at: 1 }));
      await agentHistoryAppend(
        config,
        agentId,
        buildRecord({ type: "user_message", at: 2, text: "hi", files: [] })
      );
      await agentHistoryAppend(config, agentId, buildRecord({ type: "reset", at: 3 }));
      await agentHistoryAppend(
        config,
        agentId,
        buildRecord({ type: "user_message", at: 4, text: "fresh", files: [] })
      );

      const records = await agentHistoryLoad(config, agentId);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ type: "user_message", at: 4, text: "fresh", files: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
