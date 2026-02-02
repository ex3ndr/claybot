import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import type { Config } from "@/types";
import type { AgentHistoryRecord } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

const fileReferenceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number(),
    path: z.string().min(1)
  })
  .strict();

const toolExecutionResultSchema = z
  .object({
    toolMessage: z.unknown(),
    files: z.array(fileReferenceSchema)
  })
  .strict();

const historyRecordSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      at: z.number().int()
    })
    .strict(),
  z
    .object({
      type: z.literal("reset"),
      at: z.number().int()
    })
    .strict(),
  z
    .object({
      type: z.literal("user_message"),
      at: z.number().int(),
      text: z.string(),
      files: z.array(fileReferenceSchema)
    })
    .strict(),
  z
    .object({
      type: z.literal("assistant_message"),
      at: z.number().int(),
      text: z.string(),
      files: z.array(fileReferenceSchema),
      toolCalls: z.array(z.unknown())
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      at: z.number().int(),
      toolCallId: z.string().min(1),
      output: toolExecutionResultSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("note"),
      at: z.number().int(),
      text: z.string()
    })
    .strict()
]);

/**
 * Loads history records after the most recent start/reset marker.
 * Expects: history.jsonl is newline-delimited JSON.
 */
export async function agentHistoryLoad(config: Config, agentId: string): Promise<AgentHistoryRecord[]> {
  const basePath = agentPathBuild(config, agentId);
  const filePath = path.join(basePath, "history.jsonl");
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records: AgentHistoryRecord[] = [];
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = historyRecordSchema.safeParse(parsed);
    if (result.success) {
      records.push(result.data as AgentHistoryRecord);
    }
  }

  if (records.length === 0) {
    return [];
  }
  const lastMarkerIndex = records.reduce((acc, record, index) => {
    if (record.type === "start" || record.type === "reset") {
      return index;
    }
    return acc;
  }, -1);
  if (lastMarkerIndex < 0) {
    return records;
  }
  return records.slice(lastMarkerIndex + 1);
}
