import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SessionPermissions } from "@/types";
import { getLogger } from "../../log.js";
import { Processes } from "./processes.js";

const TEST_TIMEOUT_MS = 30_000;

describe("Processes", () => {
  let baseDir: string;
  let workspaceDir: string;
  let permissions: SessionPermissions;
  let managers: Processes[];

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "daycare-processes-"));
    workspaceDir = path.join(baseDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    permissions = {
      workingDir: workspaceDir,
      writeDirs: [workspaceDir],
      readDirs: [workspaceDir],
      network: false
    };
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      try {
        await manager.stopAll();
      } catch {
        // best-effort cleanup
      }
      manager.unload();
    }
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it(
    "rehydrates running processes after manager reload",
    async () => {
      const first = await createManager(baseDir);
      const created = await first.create(
        {
          command: `node -e \"setInterval(() => {}, 1000)\"`,
          keepAlive: false,
          cwd: workspaceDir
        },
        permissions
      );

      expect(created.pid).not.toBeNull();
      first.unload();

      const second = await createManager(baseDir);
      const listed = await second.list();
      const restored = listed.find((entry) => entry.id === created.id);

      expect(restored).toBeTruthy();
      expect(restored?.status).toBe("running");
      expect(restored?.pid).toBe(created.pid);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "restarts keepAlive processes when they exit",
    async () => {
      const manager = await createManager(baseDir);
      const statePath = path.join(workspaceDir, "restart-state.txt");
      const command = [
        "node -e",
        "\"const fs=require('node:fs');",
        `const p='${escapeForNodeString(statePath)}';`,
        "let n=0;",
        "try{n=Number(fs.readFileSync(p,'utf8'))||0}catch{};",
        "fs.writeFileSync(p,String(n+1));",
        "if(n===0){process.exit(1);}",
        "setInterval(()=>{},1000);\""
      ].join(" ");

      const created = await manager.create(
        {
          command,
          keepAlive: true,
          cwd: workspaceDir
        },
        permissions
      );

      await sleep(5_000);
      const listed = await manager.list();
      const restarted = listed.find((entry) => entry.id === created.id);

      expect(restarted).toBeTruthy();
      expect(restarted?.status).toBe("running");
      expect(restarted?.restartCount).toBeGreaterThanOrEqual(1);
      expect(restarted?.pid).not.toBeNull();
    },
    TEST_TIMEOUT_MS
  );

  it(
    "writes logs and can tail them",
    async () => {
      const manager = await createManager(baseDir);
      const created = await manager.create(
        {
          command: `node -e \"console.log('hello-durable-log')\"`,
          keepAlive: false,
          cwd: workspaceDir
        },
        permissions
      );

      await sleep(1_500);
      const log = await manager.logs(created.id);
      expect(log.text).toContain("hello-durable-log");
    },
    TEST_TIMEOUT_MS
  );

  async function createManager(dir: string): Promise<Processes> {
    const manager = new Processes(dir, getLogger("test.processes"));
    managers.push(manager);
    await manager.load();
    return manager;
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeForNodeString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
