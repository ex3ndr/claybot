import { promises as fs } from "node:fs";

import type { Context } from "@mariozechner/pi-ai";

import type { AgentMessage } from "../agents/ops/agentTypes.js";

export async function messageBuildUser(
  entry: AgentMessage
): Promise<Context["messages"][number]> {
  const text = entry.message.text ?? "";
  const files = entry.message.files ?? [];
  if (files.length === 0) {
    return {
      role: "user",
      content: text,
      timestamp: entry.receivedAt
    };
  }

  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const file of files) {
    if (file.mimeType.startsWith("image/")) {
      const data = await fs.readFile(file.path);
      content.push({
        type: "image",
        data: data.toString("base64"),
        mimeType: file.mimeType
      });
    } else {
      content.push({
        type: "text",
        text: `File received: ${file.name} (${file.mimeType}, ${file.size} bytes)`
      });
    }
  }

  return {
    role: "user",
    content,
    timestamp: entry.receivedAt
  };
}
