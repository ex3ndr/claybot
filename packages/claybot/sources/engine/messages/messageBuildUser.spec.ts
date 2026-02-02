import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { messageBuildUser } from "./messageBuildUser.js";

const baseContext = {
  channelId: "channel-1",
  userId: "user-1"
};

describe("messageBuildUser", () => {
  it("returns a user message with text when no files", async () => {
    const entry = {
      id: "msg-1",
      message: { text: "hello" },
      context: baseContext,
      receivedAt: Date.now()
    };

    const result = await messageBuildUser(entry);

    expect(result.role).toBe("user");
    expect(result.content).toBe("hello");
    expect(typeof result.timestamp).toBe("number");
  });

  it("embeds image files as base64 blocks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "claybot-msg-"));
    try {
      const filePath = path.join(dir, "image.png");
      const buffer = Buffer.from("hello");
      await writeFile(filePath, buffer);

      const entry = {
        id: "msg-2",
        message: {
          text: "",
          files: [
            {
              id: "file-1",
              name: "image.png",
              mimeType: "image/png",
              size: buffer.length,
              path: filePath
            }
          ]
        },
        context: baseContext,
        receivedAt: Date.now()
      };

      const result = await messageBuildUser(entry);
      const content = result.content as Array<{ type: string; data?: string }>;

      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("image");
      expect(content[0]?.data).toBe(buffer.toString("base64"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
