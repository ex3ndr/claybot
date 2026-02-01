import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getLogger } from "../../log.js";
import { Session } from "./session.js";
import { SessionStore } from "./store.js";
import { sessionRecordState } from "./sessionRecordState.js";
import type { SessionState } from "./sessionStateTypes.js";

const logger = getLogger("test.session-record-state");

describe("sessionRecordState", () => {
  it("writes a state entry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "claybot-session-"));
    try {
      const store = new SessionStore<SessionState>({ basePath: dir });
      const session = new Session<SessionState>(
        "b".repeat(24),
        {
          id: "b".repeat(24),
          createdAt: new Date(),
          updatedAt: new Date(),
          state: {
            context: { messages: [] },
            permissions: {
              workingDir: "/tmp",
              writeDirs: [],
              readDirs: [],
              web: false
            }
          }
        },
        store.createStorageId()
      );

      await sessionRecordState({
        sessionStore: store,
        session,
        source: "test",
        logger
      });

      const filePath = path.join(dir, `${session.storageId}.jsonl`);
      const raw = await readFile(filePath, "utf8");
      expect(raw).toContain("\"type\":\"state\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
