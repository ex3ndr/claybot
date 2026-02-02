import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Config } from "@/types";
import type { AgentState } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

const contextSchema = z
  .object({
    messages: z.array(z.unknown())
  })
  .passthrough();

const permissionsSchema = z
  .object({
    workingDir: z.string().min(1),
    writeDirs: z.array(z.string()),
    readDirs: z.array(z.string()),
    web: z.boolean()
  })
  .strict();

const agentMetadataSchema = z
  .object({
    kind: z.literal("background"),
    parentAgentId: z.string().min(1).nullable(),
    name: z.string().min(1).nullable()
  })
  .strict();

const agentStateSchema = z
  .object({
    context: contextSchema,
    providerId: z.string().min(1).nullable(),
    permissions: permissionsSchema,
    agent: agentMetadataSchema.nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int()
  })
  .strip();

/**
 * Reads and validates agent state from disk.
 * Expects: state.json exists and contains JSON data.
 */
export async function agentStateRead(config: Config, agentId: string): Promise<AgentState | null> {
  const basePath = agentPathBuild(config, agentId);
  const filePath = path.join(basePath, "state.json");
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
  return agentStateSchema.parse(parsed) as AgentState;
}
