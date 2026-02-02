import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Config } from "@/types";
import type { AgentDescriptor } from "./agentDescriptorTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

const descriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user"),
      connector: z.string().min(1),
      userId: z.string().min(1),
      channelId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal("cron"),
      id: z.string().min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal("heartbeat")
    })
    .strict(),
  z
    .object({
      type: z.literal("subagent"),
      id: z.string().min(1),
      parentAgentId: z.string().min(1),
      name: z.string().min(1)
    })
    .strict()
]);

/**
 * Loads and validates an agent descriptor from disk.
 * Expects: descriptor.json exists and matches the descriptor schema.
 */
export async function agentDescriptorRead(
  config: Config,
  agentId: string
): Promise<AgentDescriptor | null> {
  const basePath = agentPathBuild(config, agentId);
  const filePath = path.join(basePath, "descriptor.json");
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  return descriptorSchema.parse(parsed) as AgentDescriptor;
}
