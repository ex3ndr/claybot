import path from "node:path";
import { exec as execCallback, type ExecException } from "node:child_process";
import { promisify } from "node:util";

import type { ExecGateDefinition, SessionPermissions } from "@/types";
import { wrapWithSandbox } from "../../sandbox/runtime.js";
import { permissionClone } from "../permissions/permissionClone.js";
import { pathResolveSecure } from "../permissions/pathResolveSecure.js";

const exec = promisify(execCallback);

const MAX_EXEC_BUFFER = 1_000_000;
const DEFAULT_EXEC_TIMEOUT = 30_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 300_000;

export type ExecGateCheckInput = {
  gate: ExecGateDefinition;
  permissions: SessionPermissions;
  workingDir: string;
};

export type ExecGateCheckResult = {
  shouldRun: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

/**
 * Runs an exec gate command and reports whether the task should continue.
 * Expects: gate.command is non-empty; workingDir is absolute.
 */
export async function execGateCheck(
  input: ExecGateCheckInput
): Promise<ExecGateCheckResult> {
  const command = input.gate.command.trim();
  if (!command) {
    return {
      shouldRun: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: new Error("Gate command is required.")
    };
  }

  const permissions = permissionClone(input.permissions);
  permissions.workingDir = path.resolve(input.workingDir);

  const allowedDomains = normalizeAllowedDomains(input.gate.allowedDomains);
  const domainIssues = validateAllowedDomains(allowedDomains, permissions.web);
  if (domainIssues.length > 0) {
    return gateError(domainIssues.join(" "));
  }

  const cwd = input.gate.cwd
    ? path.resolve(permissions.workingDir, input.gate.cwd)
    : permissions.workingDir;
  let resolvedCwd: string;
  try {
    resolvedCwd = await resolveGateCwd(permissions, cwd);
  } catch (error) {
    return gateError(error instanceof Error ? error.message : "Invalid gate cwd.");
  }

  const env = input.gate.env ? { ...process.env, ...input.gate.env } : process.env;
  const timeoutMs = clampTimeout(input.gate.timeoutMs ?? DEFAULT_EXEC_TIMEOUT);
  const sandboxConfig = buildSandboxConfig(permissions, allowedDomains);
  const sandboxedCommand = await wrapWithSandbox(command, sandboxConfig);

  try {
    const result = await exec(sandboxedCommand, {
      cwd: resolvedCwd,
      env,
      timeout: timeoutMs,
      maxBuffer: MAX_EXEC_BUFFER,
      encoding: "utf8"
    });
    return {
      shouldRun: true,
      exitCode: 0,
      stdout: toText(result.stdout),
      stderr: toText(result.stderr)
    };
  } catch (error) {
    const execError = error as ExecException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string | null;
      signal?: NodeJS.Signals | null;
    };
    const stdout = toText(execError.stdout);
    const stderr = toText(execError.stderr);
    if (typeof execError.code === "number") {
      return {
        shouldRun: false,
        exitCode: execError.code,
        stdout,
        stderr
      };
    }
    return {
      shouldRun: false,
      exitCode: null,
      stdout,
      stderr,
      error: execError instanceof Error ? execError : new Error("Gate command failed.")
    };
  }
}

function gateError(message: string): ExecGateCheckResult {
  return {
    shouldRun: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    error: new Error(message)
  };
}

function normalizeAllowedDomains(entries?: string[]): string[] {
  if (!entries) {
    return [];
  }
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error("allowedDomains entries cannot be blank.");
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      next.push(trimmed);
    }
  }
  return next;
}

function validateAllowedDomains(allowedDomains: string[], webAllowed: boolean): string[] {
  const issues: string[] = [];
  if (allowedDomains.includes("*")) {
    issues.push("Wildcard \"*\" is not allowed in allowedDomains.");
  }
  if (allowedDomains.length > 0 && !webAllowed) {
    issues.push("Web permission is required to set allowedDomains.");
  }
  return issues;
}

function buildSandboxConfig(permissions: SessionPermissions, allowedDomains: string[]) {
  const allowWrite = Array.from(
    new Set([permissions.workingDir, ...permissions.writeDirs])
  );
  return {
    filesystem: {
      denyRead: [],
      allowWrite,
      denyWrite: []
    },
    network: {
      allowedDomains,
      deniedDomains: []
    }
  };
}

async function resolveGateCwd(
  permissions: SessionPermissions,
  cwd: string
): Promise<string> {
  const allowedDirs = Array.from(
    new Set([permissions.workingDir, ...permissions.readDirs, ...permissions.writeDirs])
  );
  const resolved = await pathResolveSecure(allowedDirs, cwd);
  return resolved.realPath;
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EXEC_TIMEOUT;
  }
  return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function toText(value?: string | Buffer): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toString("utf8");
}
