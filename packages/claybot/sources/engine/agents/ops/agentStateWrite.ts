import { promises as fs } from "node:fs";
import path from "node:path";

import type { Config } from "@/types";
import type { AgentState } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

/**
 * Writes agent state to disk with an atomic rename.
 * Expects: agent state uses unix timestamps.
 */
export async function agentStateWrite(
  config: Config,
  agentId: string,
  state: AgentState
): Promise<void> {
  const basePath = agentPathBuild(config, agentId);
  await fs.mkdir(basePath, { recursive: true });
  const filePath = path.join(basePath, "state.json");
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  await writeFileAtomic(filePath, payload);
}

async function writeFileAtomic(filePath: string, payload: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, payload, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}
