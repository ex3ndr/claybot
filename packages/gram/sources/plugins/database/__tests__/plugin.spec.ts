import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import type { ToolCall } from "@mariozechner/pi-ai";

import { AuthStore } from "../../../auth/store.js";
import { FileStore } from "../../../files/store.js";
import { ConnectorRegistry, ImageGenerationRegistry, InferenceRegistry, ToolResolver } from "../../../engine/modules.js";
import { PluginRegistry } from "../../../engine/plugins/registry.js";
import { Session } from "../../../engine/sessions/session.js";
import type { SessionPermissions } from "../../../engine/permissions.js";
import { getLogger } from "../../../log.js";
import { plugin } from "../plugin.js";

describe("database plugin", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "gram-db-plugin-"));
  });

  it("creates db files, runs SQL, and updates db.md", async () => {
    const sqliteAvailable = await canImportSqlite();
    if (!sqliteAvailable) {
      return;
    }

    const auth = new AuthStore(path.join(baseDir, "auth.json"));
    const fileStore = new FileStore({ basePath: path.join(baseDir, "files") });
    const connectorRegistry = new ConnectorRegistry({ onMessage: async () => undefined });
    const inferenceRegistry = new InferenceRegistry();
    const imageRegistry = new ImageGenerationRegistry();
    const toolResolver = new ToolResolver();
    const pluginRegistry = new PluginRegistry(
      connectorRegistry,
      inferenceRegistry,
      imageRegistry,
      toolResolver
    );

    const instanceId = "database-1";
    const registrar = pluginRegistry.createRegistrar(instanceId);
    const now = new Date();
    const session = new Session(
      "session-1",
      {
        id: "session-1",
        createdAt: now,
        updatedAt: now,
        state: {}
      },
      createId()
    );
    const permissions: SessionPermissions = {
      workingDir: baseDir,
      writeDirs: [],
      readDirs: [],
      web: false
    };

    const api = {
      instance: { instanceId, pluginId: "database" },
      settings: {},
      engineSettings: {},
      logger: getLogger("test.database"),
      auth,
      dataDir: baseDir,
      registrar,
      fileStore,
      mode: "runtime" as const,
      events: { emit: () => undefined }
    };

    const instance = await plugin.create(api);
    await instance.load?.();

    const dbPath = path.join(baseDir, "db.sqlite");
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

    const result = await toolResolver.execute(toolCall, {
      connectorRegistry,
      fileStore,
      auth,
      logger: getLogger("test.database.tool"),
      assistant: null,
      permissions,
      session,
      source: "test",
      messageContext: { channelId: "channel-1", userId: "user-1" }
    });

    expect(result.toolMessage.isError).toBe(false);

    const doc = await fs.readFile(docPath, "utf8");
    expect(doc).toContain("### users");
    expect(doc).toContain("id: INTEGER");
    expect(doc).toContain("name: TEXT");
    expect(doc).toContain("Create users table");

    const prompt = await instance.systemPrompt?.();
    expect(prompt).toContain("Database plugin is active.");
    expect(prompt).toContain(doc.trim());

    await instance.unload?.();
  });
});

async function canImportSqlite(): Promise<boolean> {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}
