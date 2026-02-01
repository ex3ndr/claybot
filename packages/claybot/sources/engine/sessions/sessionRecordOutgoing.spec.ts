import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getLogger } from "../../log.js";
import { Session } from "./session.js";
import { SessionStore } from "./store.js";
import { sessionRecordOutgoing } from "./sessionRecordOutgoing.js";
import type { SessionState } from "./sessionStateTypes.js";

const logger = getLogger("test.session-record-outgoing");

describe("sessionRecordOutgoing", () => {
  it("writes an outgoing entry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "claybot-session-"));
    try {
      const store = new SessionStore<SessionState>({ basePath: dir });
      const session = new Session<SessionState>(
        "a".repeat(24),
        {
          id: "a".repeat(24),
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

      await sessionRecordOutgoing({
        sessionStore: store,
        session,
        source: "test",
        context: { channelId: "channel", userId: "user" },
        text: "hello",
        logger
      });

      const filePath = path.join(dir, `${session.storageId}.jsonl`);
      const raw = await readFile(filePath, "utf8");
      expect(raw).toContain("\"type\":\"outgoing\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
