import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Config } from "@/types";
import type { AgentState } from "./agentTypes.js";
import { agentPathBuild } from "./agentPathBuild.js";

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
  const state = agentStateSchema.parse(parsed);
  return {
    context: { messages: [] },
    permissions: state.permissions,
    agent: state.agent,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  };
}
