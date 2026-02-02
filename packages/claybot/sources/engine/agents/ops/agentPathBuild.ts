import path from "node:path";

import type { Config } from "@/types";

/**
 * Builds the filesystem path for an agent folder.
 * Expects: config.agentsDir is absolute.
 */
export function agentPathBuild(config: Config, agentId: string): string {
  return path.join(config.agentsDir, agentId);
}
