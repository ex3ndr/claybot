import type { ExecGateDefinition } from "@/types";
import { envNormalize } from "../../util/envNormalize.js";

/**
 * Normalizes an exec gate definition from untyped input.
 * Returns undefined when the value is missing or lacks a command.
 */
export function execGateNormalize(value: unknown): ExecGateDefinition | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    command?: unknown;
    cwd?: unknown;
    timeoutMs?: unknown;
    env?: unknown;
    permissions?: unknown;
    allowedDomains?: unknown;
  };
  if (typeof candidate.command !== "string") {
    return undefined;
  }
  const command = candidate.command.trim();
  if (!command) {
    return undefined;
  }

  const next: ExecGateDefinition = { command };

  if (typeof candidate.cwd === "string") {
    const cwd = candidate.cwd.trim();
    if (cwd) {
      next.cwd = cwd;
    }
  }

  if (typeof candidate.timeoutMs === "number" && Number.isFinite(candidate.timeoutMs)) {
    next.timeoutMs = candidate.timeoutMs;
  }

  const env = envNormalize(candidate.env);
  if (env) {
    next.env = env;
  }

  const permissions = normalizeStringArray(candidate.permissions);
  if (permissions.length > 0) {
    next.permissions = permissions;
  }

  const allowedDomains = normalizeStringArray(candidate.allowedDomains);
  if (allowedDomains.length > 0) {
    next.allowedDomains = allowedDomains;
  }

  return next;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(entries));
}
