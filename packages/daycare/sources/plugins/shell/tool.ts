import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExecException } from "node:child_process";

import type { ToolDefinition, ToolExecutionResult } from "@/types";
import type { SessionPermissions } from "@/types";
import { resolveWorkspacePath } from "../../engine/permissions.js";
import { sandboxAllowedDomainsResolve } from "../../sandbox/sandboxAllowedDomainsResolve.js";
import { sandboxAllowedDomainsValidate } from "../../sandbox/sandboxAllowedDomainsValidate.js";
import { sandboxCanRead } from "../../sandbox/sandboxCanRead.js";
import { sandboxCanWrite } from "../../sandbox/sandboxCanWrite.js";
import { runInSandbox } from "../../sandbox/runtime.js";
import { sandboxFilesystemPolicyBuild } from "../../sandbox/sandboxFilesystemPolicyBuild.js";
import { envNormalize } from "../../util/envNormalize.js";
import { permissionTagsApply } from "../../engine/permissions/permissionTagsApply.js";
import { permissionTagsNormalize } from "../../engine/permissions/permissionTagsNormalize.js";
import { permissionTagsValidate } from "../../engine/permissions/permissionTagsValidate.js";
import {
  isWithinSecure,
  openSecure
} from "../../engine/permissions/pathResolveSecure.js";

const MAX_READ_BYTES = 200_000;
const MAX_EXEC_BUFFER = 1_000_000;
const DEFAULT_EXEC_TIMEOUT = 30_000;

const editItemSchema = Type.Object(
  {
    search: Type.String({ minLength: 1 }),
    replace: Type.String(),
    replaceAll: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const readSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const writeSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    content: Type.String(),
    append: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const editSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    edits: Type.Array(editItemSchema, { minItems: 1 })
  },
  { additionalProperties: false }
);

type ReadArgs = Static<typeof readSchema>;
type WriteArgs = Static<typeof writeSchema>;
type EditArgs = Static<typeof editSchema>;
type EditSpec = Static<typeof editItemSchema>;

const envSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

const execSchema = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 300_000 })),
    env: Type.Optional(envSchema),
    home: Type.Optional(Type.String({ minLength: 1 })),
    permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    packageManagers: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("dart"),
          Type.Literal("dotnet"),
          Type.Literal("go"),
          Type.Literal("java"),
          Type.Literal("node"),
          Type.Literal("php"),
          Type.Literal("python"),
          Type.Literal("ruby"),
          Type.Literal("rust")
        ]),
        { minItems: 1 }
      )
    ),
    allowedDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
    )
  },
  { additionalProperties: false }
);

type ExecArgs = Static<typeof execSchema>;

export function buildWorkspaceReadTool(): ToolDefinition {
  return {
    tool: {
      name: "read",
      description:
        "Read a UTF-8 text file by absolute path. If read directories are configured, the path must be within the allowed read set; otherwise any absolute path is allowed. Large files are truncated.",
      parameters: readSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as ReadArgs;
      const workingDir = toolContext.permissions.workingDir;
      if (!workingDir) {
        throw new Error("Workspace is not configured.");
      }
      ensureAbsolutePath(payload.path);
      const resolved = await resolveReadPathSecure(toolContext.permissions, payload.path);
      return handleReadSecure(resolved, workingDir, toolCall);
    }
  };
}

export function buildWorkspaceWriteTool(): ToolDefinition {
  return {
    tool: {
      name: "write",
      description:
        "Write UTF-8 text to a file within the agent workspace or an allowed write directory. Creates parent directories as needed. If append is true, appends to the file. Paths must be absolute and within the allowed write set.",
      parameters: writeSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as WriteArgs;
      const workingDir = toolContext.permissions.workingDir;
      if (!workingDir) {
        throw new Error("Workspace is not configured.");
      }
      ensureAbsolutePath(payload.path);
      const resolved = await resolveWritePathSecure(toolContext.permissions, payload.path);
      return handleWriteSecure(
        resolved,
        payload.content,
        payload.append ?? false,
        workingDir,
        toolCall
      );
    }
  };
}

export function buildWorkspaceEditTool(): ToolDefinition {
  return {
    tool: {
      name: "edit",
      description:
        "Apply one or more find/replace edits to a file in the agent workspace or an allowed write directory. Edits are applied sequentially and must match at least once. Paths must be absolute and within the allowed write set.",
      parameters: editSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as EditArgs;
      const workingDir = toolContext.permissions.workingDir;
      if (!workingDir) {
        throw new Error("Workspace is not configured.");
      }
      ensureAbsolutePath(payload.path);
      const resolved = await resolveWritePathSecure(toolContext.permissions, payload.path);
      return handleEditSecure(resolved, payload.edits, workingDir, toolCall);
    }
  };
}

export function buildExecTool(): ToolDefinition {
  return {
    tool: {
      name: "exec",
      description:
        "Execute a shell command inside the agent workspace (or a subdirectory). The cwd, if provided, must be an absolute path that resolves inside the workspace. By default exec runs with no network and no write grants. Reads are always allowed (except protected deny-list paths). Use explicit permission tags to re-enable caller-held network or writable path access; @read tags are ignored. Writes are sandboxed to the allowed write directories. Optional home (absolute path within allowed write directories) remaps HOME and related env vars for sandboxed execution. Optional packageManagers language presets auto-allow ecosystem hosts (dart/dotnet/go/java/node/php/python/ruby/rust). Optional allowedDomains enables outbound access to specific domains (supports subdomain wildcards like *.example.com, no global wildcard). Returns stdout/stderr and failure details.",
      parameters: execSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as ExecArgs;
      const workingDir = toolContext.permissions.workingDir;
      if (!workingDir) {
        throw new Error("Workspace is not configured.");
      }
      const permissions = await resolveExecPermissions(
        toolContext.permissions,
        payload.permissions
      );
      if (payload.cwd) {
        ensureAbsolutePath(payload.cwd);
      }
      if (payload.home) {
        ensureAbsolutePath(payload.home);
      }
      const cwd = payload.cwd
        ? resolveWorkspacePath(workingDir, payload.cwd)
        : workingDir;
      const home = payload.home
        ? await resolveWritePathSecure(permissions, payload.home)
        : undefined;
      const allowedDomains = sandboxAllowedDomainsResolve(
        payload.allowedDomains,
        payload.packageManagers
      );
      const domainIssues = sandboxAllowedDomainsValidate(
        allowedDomains,
        permissions.network
      );
      if (domainIssues.length > 0) {
        throw new Error(domainIssues.join(" "));
      }
      const envOverrides = envNormalize(payload.env);
      const env = envOverrides ? { ...process.env, ...envOverrides } : process.env;
      const timeout = payload.timeoutMs ?? DEFAULT_EXEC_TIMEOUT;
      const sandboxConfig = buildSandboxConfig(permissions, allowedDomains);

      try {
        const result = await runInSandbox(payload.command, sandboxConfig, {
          cwd,
          env,
          home,
          timeoutMs: timeout,
          maxBufferBytes: MAX_EXEC_BUFFER
        });
        const stdout = toText(result.stdout);
        const stderr = toText(result.stderr);

        const text = formatExecOutput(stdout, stderr, false);
        const toolMessage = buildToolMessage(toolCall, text, false, {
          cwd: path.relative(workingDir, cwd) || "."
        });
        return { toolMessage, files: [] };
      } catch (error) {
        const execError = error as ExecException & {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          code?: number | string | null;
          signal?: NodeJS.Signals | null;
        };
        const stdout = toText(execError.stdout);
        const stderr = toText(execError.stderr);
        const text = formatExecOutput(stdout, stderr, true);
        const toolMessage = buildToolMessage(toolCall, text, true, {
          cwd: path.relative(workingDir, cwd) || ".",
          exitCode: execError.code ?? null,
          signal: execError.signal ?? null
        });
        return { toolMessage, files: [] };
      }
    }
  };
}

/**
 * Secure read handler that uses lstat + openSecure to prevent TOCTOU attacks.
 * The path has already been securely resolved (symlinks followed, containment verified).
 */
async function handleReadSecure(
  resolvedPath: string,
  workingDir: string,
  toolCall: { id: string; name: string }
): Promise<ToolExecutionResult> {
  // Use lstat to check file type without following symlinks
  const stats = await fs.lstat(resolvedPath);
  if (stats.isSymbolicLink()) {
    throw new Error("Cannot read symbolic link directly.");
  }
  if (!stats.isFile()) {
    throw new Error("Path is not a file.");
  }

  let content = "";
  let truncated = false;

  // Use openSecure to prevent TOCTOU race between stat and read
  const handle = await openSecure(resolvedPath, "r");
  try {
    const handleStats = await handle.stat();
    if (handleStats.size > MAX_READ_BYTES) {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      await handle.read(buffer, 0, MAX_READ_BYTES, 0);
      content = buffer.toString("utf8");
      truncated = true;
    } else {
      content = await handle.readFile("utf8");
    }
  } finally {
    await handle.close();
  }

  const displayPath = formatDisplayPath(workingDir, resolvedPath);
  const suffix = truncated
    ? `\n[truncated to ${MAX_READ_BYTES} bytes from ${stats.size}]`
    : "";
  const text = `File: ${displayPath}\n${content}${suffix}`;

  const toolMessage = buildToolMessage(toolCall, text, false, {
    action: "read",
    path: displayPath,
    bytes: stats.size,
    truncated
  });

  return { toolMessage, files: [] };
}

/**
 * Secure write handler that prevents TOCTOU attacks.
 * The path has already been securely resolved (symlinks followed, containment verified).
 */
async function handleWriteSecure(
  resolvedPath: string,
  content: string,
  append: boolean,
  workingDir: string,
  toolCall: { id: string; name: string }
): Promise<ToolExecutionResult> {
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  // Check if target is a symlink before writing
  try {
    const stats = await fs.lstat(resolvedPath);
    if (stats.isSymbolicLink()) {
      throw new Error("Cannot write to symbolic link.");
    }
  } catch (error) {
    // File doesn't exist yet - OK for write operations
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  // Use atomic file operations via file handle
  const flags = append ? "a" : "w";
  const handle = await fs.open(resolvedPath, flags);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }

  const bytes = Buffer.byteLength(content, "utf8");
  const displayPath = formatDisplayPath(workingDir, resolvedPath);
  const text = `${append ? "Appended" : "Wrote"} ${bytes} bytes to ${displayPath}.`;
  const toolMessage = buildToolMessage(toolCall, text, false, {
    action: "write",
    path: displayPath,
    bytes,
    append
  });
  return { toolMessage, files: [] };
}

/**
 * Secure edit handler that prevents TOCTOU attacks.
 * Uses file handle to ensure atomic read-modify-write operations.
 */
async function handleEditSecure(
  resolvedPath: string,
  edits: EditSpec[],
  workingDir: string,
  toolCall: { id: string; name: string }
): Promise<ToolExecutionResult> {
  // Check if target is a symlink
  const stats = await fs.lstat(resolvedPath);
  if (stats.isSymbolicLink()) {
    throw new Error("Cannot edit symbolic link.");
  }

  // Open with r+ for read-modify-write atomicity
  const handle = await fs.open(resolvedPath, "r+");
  try {
    const original = await handle.readFile("utf8");
    let updated = original;
    const counts: number[] = [];

    for (const edit of edits) {
      const { next, count } = applyEdit(updated, edit);
      if (count === 0) {
        const preview = edit.search.length > 80 ? `${edit.search.slice(0, 77)}...` : edit.search;
        throw new Error(`Edit not applied: "${preview}" not found.`);
      }
      counts.push(count);
      updated = next;
    }

    // Truncate and write from beginning
    await handle.truncate(0);
    await handle.write(updated, 0, "utf8");

    const displayPath = formatDisplayPath(workingDir, resolvedPath);
    const summary = counts
      .map((count, index) => `edit ${index + 1}: ${count} replacement${count === 1 ? "" : "s"}`)
      .join(", ");
    const text = `Updated ${displayPath} (${summary}).`;
    const toolMessage = buildToolMessage(toolCall, text, false, {
      action: "edit",
      path: displayPath,
      edits: counts
    });
    return { toolMessage, files: [] };
  } finally {
    await handle.close();
  }
}

function applyEdit(input: string, edit: EditSpec): { next: string; count: number } {
  if (edit.replaceAll) {
    const parts = input.split(edit.search);
    const count = parts.length - 1;
    return {
      next: parts.join(edit.replace),
      count
    };
  }
  const index = input.indexOf(edit.search);
  if (index === -1) {
    return { next: input, count: 0 };
  }
  const next =
    input.slice(0, index) + edit.replace + input.slice(index + edit.search.length);
  return { next, count: 1 };
}

function buildToolMessage(
  toolCall: { id: string; name: string },
  text: string,
  isError: boolean,
  details?: Record<string, unknown>
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details,
    isError,
    timestamp: Date.now()
  };
}

function toText(value: string | Buffer | undefined): string {
  if (!value) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

function formatExecOutput(stdout: string, stderr: string, failed: boolean): string {
  const parts: string[] = [];
  if (stdout.trim().length > 0) {
    parts.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim().length > 0) {
    parts.push(`stderr:\n${stderr.trimEnd()}`);
  }
  if (parts.length === 0) {
    return failed ? "Command failed with no output." : "Command completed with no output.";
  }
  return parts.join("\n\n");
}

function ensureAbsolutePath(target: string): void {
  if (!path.isAbsolute(target)) {
    throw new Error("Path must be absolute.");
  }
}

async function resolveWritePathSecure(
  permissions: SessionPermissions,
  target: string
): Promise<string> {
  return sandboxCanWrite(permissions, target);
}

async function resolveReadPathSecure(
  permissions: SessionPermissions,
  target: string
): Promise<string> {
  return sandboxCanRead(permissions, target);
}

function formatDisplayPath(workingDir: string, target: string): string {
  if (isWithinSecure(workingDir, target)) {
    return path.relative(workingDir, target) || ".";
  }
  return target;
}

function buildSandboxConfig(permissions: SessionPermissions, allowedDomains: string[]) {
  const filesystem = sandboxFilesystemPolicyBuild({ permissions });
  return {
    filesystem,
    network: {
      allowedDomains,
      deniedDomains: []
    }
  };
}

async function resolveExecPermissions(
  currentPermissions: SessionPermissions,
  requestedTags: string[] | undefined
): Promise<SessionPermissions> {
  const execPermissions: SessionPermissions = {
    workingDir: currentPermissions.workingDir,
    writeDirs: [],
    readDirs: [],
    network: false
  };
  if (!requestedTags || requestedTags.length === 0) {
    return execPermissions;
  }
  const permissionTags = permissionTagsNormalize(requestedTags);
  const nonReadTags = permissionTags.filter((tag) => !tag.startsWith("@read:"));
  await permissionTagsValidate(currentPermissions, nonReadTags);
  permissionTagsApply(execPermissions, nonReadTags);
  execPermissions.readDirs = [];
  return execPermissions;
}
