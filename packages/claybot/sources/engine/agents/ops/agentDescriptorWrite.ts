import { promises as fs } from "node:fs";
import path from "node:path";

import type { Config } from "@/types";
import type { AgentDescriptor } from "./agentDescriptorTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

/**
 * Writes an agent descriptor to disk with an atomic rename.
 * Expects: descriptor has been validated.
 */
export async function agentDescriptorWrite(
  config: Config,
  agentId: string,
  descriptor: AgentDescriptor
): Promise<void> {
  const basePath = agentPathBuild(config, agentId);
  await fs.mkdir(basePath, { recursive: true });
  const filePath = path.join(basePath, "descriptor.json");
  const payload = `${JSON.stringify(descriptor, null, 2)}\n`;
  await writeFileAtomic(filePath, payload);
}

async function writeFileAtomic(filePath: string, payload: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, payload, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}
