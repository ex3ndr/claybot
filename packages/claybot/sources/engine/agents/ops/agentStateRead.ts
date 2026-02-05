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

const tokenSizeSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative()
  })
  .strict();

const tokenSnapshotSizeSchema = tokenSizeSchema
  .extend({
    total: z.number().int().nonnegative()
  })
  .strict();

const tokensSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    size: tokenSnapshotSizeSchema
  })
  .strict()
  .nullable();

const statsSchema = z.record(z.record(tokenSizeSchema));

const agentStateSchema = z
  .object({
    permissions: permissionsSchema,
    tokens: tokensSchema,
    stats: statsSchema,
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    state: z.enum(["active", "sleeping"]).optional(),
    sleeping: z.boolean().optional()
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
  const persisted = agentStateSchema.parse(parsed);
  const lifecycle = persisted.state ?? (persisted.sleeping ? "sleeping" : "active");
  return {
    context: { messages: [] },
    permissions: persisted.permissions,
    tokens: persisted.tokens,
    stats: persisted.stats,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    state: lifecycle
  };
}
