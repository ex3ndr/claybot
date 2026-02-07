import { promises as fs } from "node:fs";

import type { Config } from "@/types";
import type { BackgroundAgentState } from "./agentTypes.js";
import type { AgentDescriptor } from "./agentDescriptorTypes.js";
import { agentDescriptorRead } from "./agentDescriptorRead.js";
import { agentStateRead } from "./agentStateRead.js";

/**
 * Lists persisted background agents with coarse status (no in-memory queue data).
 * Expects: agentsDir may be missing when no agents have been created yet.
 */
export async function agentBackgroundList(config: Config): Promise<BackgroundAgentState[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fs.readdir(config.agentsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results: BackgroundAgentState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const agentId = entry.name;
    let state: Awaited<ReturnType<typeof agentStateRead>> = null;
    let descriptor: AgentDescriptor | null = null;
    try {
      descriptor = await agentDescriptorRead(config, agentId);
      state = await agentStateRead(config, agentId);
    } catch {
      continue;
    }
    if (!state || !descriptor) {
      continue;
    }
    if (descriptor.type === "user") {
      continue;
    }
    const name =
      descriptor.type === "subagent"
        ? descriptor.name ?? "subagent"
        : descriptor.type === "permanent"
          ? descriptor.name ?? "permanent"
          : descriptor.type === "cron"
            ? descriptor.name ?? "cron task"
            : descriptor.tag;
    const parentAgentId =
      descriptor.type === "subagent" ? descriptor.parentAgentId ?? null : null;
    results.push({
      agentId,
      name,
      parentAgentId,
      lifecycle: state.state,
      status: "idle",
      pending: 0,
      updatedAt: state.updatedAt
    });
  }
  return results;
}
