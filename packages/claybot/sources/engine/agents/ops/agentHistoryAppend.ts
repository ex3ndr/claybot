import { promises as fs } from "node:fs";
import path from "node:path";

import type { Config } from "@/types";
import type { AgentHistoryRecord } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

/**
 * Appends a history record to the agent history log.
 * Expects: record is JSON-serializable.
 */
export async function agentHistoryAppend(
  config: Config,
  agentId: string,
  record: AgentHistoryRecord
): Promise<void> {
  const basePath = agentPathBuild(config, agentId);
  await fs.mkdir(basePath, { recursive: true });
  const filePath = path.join(basePath, "history.jsonl");
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(filePath, line, "utf8");
}
