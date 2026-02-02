import { promises as fs } from "node:fs";
import path from "node:path";

import type { Config } from "@/types";
import type { AgentState } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";
import { atomicWrite } from "../../../util/atomicWrite.js";

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
  const payload = `${JSON.stringify(
    {
      permissions: state.permissions,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      sleeping: state.sleeping
    },
    null,
    2
  )}\n`;
  await atomicWrite(filePath, payload);
}
