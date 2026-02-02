import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import type { ToolCall } from "@mariozechner/pi-ai";

import { AuthStore } from "../../../auth/store.js";
import { FileStore } from "../../../files/store.js";
import { ModuleRegistry } from "../../../engine/modules/moduleRegistry.js";
import { PluginRegistry } from "../../../engine/plugins/registry.js";
import { Agent } from "../../../engine/agents/agent.js";
import { AgentInbox } from "../../../engine/agents/ops/agentInbox.js";
import { agentDescriptorBuild } from "../../../engine/agents/ops/agentDescriptorBuild.js";
import type { AgentState, SessionPermissions } from "@/types";
import { getLogger } from "../../../log.js";
import { plugin } from "../plugin.js";
import { configResolve } from "../../../config/configResolve.js";

describe("database plugin", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "claybot-db-plugin-"));
  });

  it("creates db files, runs SQL, and updates db.md", async () => {
    const config = configResolve({ engine: { dataDir: baseDir } }, path.join(baseDir, "settings.json"));
    const auth = new AuthStore(config);
    const fileStore = new FileStore(config);
    const modules = new ModuleRegistry({ onMessage: async () => undefined });
    const pluginRegistry = new PluginRegistry(modules);

    const instanceId = "database-1";
    const registrar = pluginRegistry.createRegistrar(instanceId);
    const now = new Date();
    const agentId = createId();
    const permissions: SessionPermissions = {
      workingDir: baseDir,
      writeDirs: [],
      readDirs: [],
      web: false
    };
    const messageContext = {};
    const descriptor = agentDescriptorBuild("system", messageContext, agentId);
    const state: AgentState = {
      context: { messages: [] },
      permissions,
      createdAt: now.getTime(),
      updatedAt: now.getTime()
    };
    const agent = Agent.restore(
      agentId,
      descriptor,
      state,
      new AgentInbox(agentId),
      {} as unknown as Parameters<typeof Agent.restore>[4]
    );
    const api = {
      instance: { instanceId, pluginId: "database" },
      settings: {},
      engineSettings: {},
      logger: getLogger("test.database"),
      auth,
      dataDir: baseDir,
      registrar,
      fileStore,
      inference: {
        complete: async () => {
          throw new Error("Inference not available in test.");
        }
      },
      mode: "runtime" as const,
      events: { emit: () => undefined }
    };

    const instance = await plugin.create(api);
    await instance.load?.();

    const dbPath = path.join(baseDir, "db.pglite");
    const docPath = path.join(baseDir, "db.md");
    await expect(fs.stat(dbPath)).resolves.toBeTruthy();
    await expect(fs.stat(docPath)).resolves.toBeTruthy();

    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "db_sql",
      arguments: {
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        description: "Create users table"
      }
    };

    const result = await modules.tools.execute(toolCall, {
      connectorRegistry: modules.connectors,
      fileStore,
      auth,
      logger: getLogger("test.database.tool"),
      assistant: null,
      permissions,
      agent,
      source: "test",
      messageContext,
      agentSystem: null as unknown as Parameters<typeof modules.tools.execute>[1]["agentSystem"],
      heartbeats: null as unknown as Parameters<typeof modules.tools.execute>[1]["heartbeats"]
    });

    expect(result.toolMessage.isError).toBe(false);

    const doc = await fs.readFile(docPath, "utf8");
    expect(doc).toContain("### users");
    expect(doc).toContain("id: integer");
    expect(doc).toContain("name: text");
    expect(doc).toContain("Create users table");

    const prompt =
      typeof instance.systemPrompt === "function"
        ? await instance.systemPrompt()
        : instance.systemPrompt ?? "";
    expect(prompt).toContain("Database plugin is active.");
    expect(prompt).toContain(doc.trim());

    await instance.unload?.();
  });
});
