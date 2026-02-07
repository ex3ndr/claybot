import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createId } from "@paralleldrive/cuid2";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { Logger } from "pino";

import type { SessionPermissions, SandboxPackageManager } from "@/types";
import { resolveWorkspacePath } from "../../engine/permissions.js";
import { sandboxAllowedDomainsResolve } from "../../sandbox/sandboxAllowedDomainsResolve.js";
import { sandboxAllowedDomainsValidate } from "../../sandbox/sandboxAllowedDomainsValidate.js";
import { sandboxCanWrite } from "../../sandbox/sandboxCanWrite.js";
import { sandboxFilesystemPolicyBuild } from "../../sandbox/sandboxFilesystemPolicyBuild.js";
import { envNormalize } from "../../util/envNormalize.js";
import { AsyncLock } from "../../util/lock.js";
import { sandboxHomeRedefine } from "../../sandbox/sandboxHomeRedefine.js";
import { atomicWrite } from "../../util/atomicWrite.js";

const RECORD_VERSION = 2;
const MONITOR_INTERVAL_MS = 2_000;
const PROCESS_STOP_TIMEOUT_MS = 8_000;
const PROCESS_STOP_POLL_MS = 200;
const MAX_LOG_BYTES = 200_000;
const RESTART_BACKOFF_BASE_MS = 2_000;
const RESTART_BACKOFF_MAX_MS = 60_000;
const RESTART_STABLE_UPTIME_MS = 30_000;

const nodeRequire = createRequire(import.meta.url);
const sandboxCliPath = nodeRequire.resolve("@anthropic-ai/sandbox-runtime/dist/cli.js");

const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"] as const;

export type ProcessSignal = (typeof SIGNALS)[number];

export type ProcessCreateInput = {
  command: string;
  name?: string;
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  home?: string;
  packageManagers?: SandboxPackageManager[];
  allowedDomains?: string[];
  keepAlive?: boolean;
};

export type ProcessInfo = {
  id: string;
  name: string;
  command: string;
  cwd: string;
  home: string | null;
  pid: number | null;
  keepAlive: boolean;
  desiredState: "running" | "stopped";
  status: "running" | "stopped" | "exited";
  restartCount: number;
  createdAt: number;
  updatedAt: number;
  lastStartedAt: number | null;
  lastExitedAt: number | null;
  logPath: string;
};

type ProcessRecord = {
  version: number;
  id: string;
  name: string;
  command: string;
  cwd: string;
  home: string | null;
  env: Record<string, string>;
  packageManagers: SandboxPackageManager[];
  allowedDomains: string[];
  permissions: SessionPermissions;
  keepAlive: boolean;
  desiredState: "running" | "stopped";
  status: "running" | "stopped" | "exited";
  pid: number | null;
  restartCount: number;
  restartFailureCount: number;
  nextRestartAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastStartedAt: number | null;
  lastExitedAt: number | null;
  settingsPath: string;
  logPath: string;
};

/**
 * Manages durable sandboxed background processes persisted on disk.
 * Expects: all state writes happen through this facade to keep pid/status files in sync.
 */
export class Processes {
  private readonly baseDir: string;
  private readonly recordsDir: string;
  private readonly lock = new AsyncLock();
  private readonly logger: Logger;
  private readonly records = new Map<string, ProcessRecord>();
  private readonly children = new Map<string, ChildProcess>();
  private monitorHandle: NodeJS.Timeout | null = null;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = path.resolve(baseDir);
    this.recordsDir = path.join(this.baseDir, "processes");
    this.logger = logger;
  }

  async load(): Promise<void> {
    await fs.mkdir(this.recordsDir, { recursive: true });
    await this.lock.inLock(async () => {
      this.records.clear();
      const entries = await fs.readdir(this.recordsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const recordPath = this.recordPath(entry.name);
        const record = await readRecord(recordPath);
        if (!record) {
          continue;
        }
        this.records.set(record.id, record);
      }
      await this.refreshRecordStatusLocked();
    });
    this.startMonitor();
  }

  unload(): void {
    if (!this.monitorHandle) {
      return;
    }
    // Interval cleanup is required to avoid keeping timers alive after plugin unload.
    clearInterval(this.monitorHandle);
    this.monitorHandle = null;
  }

  async create(
    input: ProcessCreateInput,
    permissions: SessionPermissions
  ): Promise<ProcessInfo> {
    return this.lock.inLock(async () => {
      const now = Date.now();
      const workingDir = permissions.workingDir;
      if (!workingDir) {
        throw new Error("Workspace is not configured.");
      }

      const command = input.command.trim();
      if (!command) {
        throw new Error("Command is required.");
      }

      if (input.cwd && !path.isAbsolute(input.cwd)) {
        throw new Error("Path must be absolute.");
      }
      if (input.home && !path.isAbsolute(input.home)) {
        throw new Error("Path must be absolute.");
      }

      const cwd = input.cwd
        ? resolveWorkspacePath(workingDir, input.cwd)
        : workingDir;
      const home = input.home
        ? await sandboxCanWrite(permissions, input.home)
        : null;

      const allowedDomains = sandboxAllowedDomainsResolve(
        input.allowedDomains,
        input.packageManagers
      );
      const domainIssues = sandboxAllowedDomainsValidate(
        allowedDomains,
        permissions.network
      );
      if (domainIssues.length > 0) {
        throw new Error(domainIssues.join(" "));
      }

      const envInput = envNormalize(input.env) ?? {};
      const id = createId();
      const recordDir = this.processDir(id);
      const settingsPath = path.join(recordDir, "sandbox.json");
      const logPath = path.join(recordDir, "process.log");
      await fs.mkdir(recordDir, { recursive: true });

      const record: ProcessRecord = {
        version: RECORD_VERSION,
        id,
        name: (input.name?.trim() || id).slice(0, 80),
        command,
        cwd,
        home,
        env: envInput,
        packageManagers: [...(input.packageManagers ?? [])],
        allowedDomains,
        permissions: clonePermissions(permissions),
        keepAlive: input.keepAlive ?? false,
        desiredState: "running",
        status: "stopped",
        pid: null,
        restartCount: 0,
        restartFailureCount: 0,
        nextRestartAt: null,
        createdAt: now,
        updatedAt: now,
        lastStartedAt: null,
        lastExitedAt: null,
        settingsPath,
        logPath
      };

      await this.startRecordLocked(record, { incrementRestart: false });
      this.records.set(record.id, record);
      await this.writeRecordLocked(record);
      return toProcessInfo(record);
    });
  }

  async list(): Promise<ProcessInfo[]> {
    return this.lock.inLock(async () => {
      await this.refreshRecordStatusLocked();
      return Array.from(this.records.values())
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => toProcessInfo(record));
    });
  }

  async stop(processId: string, signal: ProcessSignal = "SIGTERM"): Promise<ProcessInfo> {
    return this.lock.inLock(async () => {
      const record = this.records.get(processId);
      if (!record) {
        throw new Error(`Unknown process id: ${processId}`);
      }
      record.desiredState = "stopped";
      await this.stopRecordLocked(record, signal);
      await this.writeRecordLocked(record);
      return toProcessInfo(record);
    });
  }

  async stopAll(signal: ProcessSignal = "SIGTERM"): Promise<ProcessInfo[]> {
    return this.lock.inLock(async () => {
      const results: ProcessInfo[] = [];
      for (const record of this.records.values()) {
        record.desiredState = "stopped";
        await this.stopRecordLocked(record, signal);
        await this.writeRecordLocked(record);
        results.push(toProcessInfo(record));
      }
      return results;
    });
  }

  async logs(processId: string, bytes: number = 20_000): Promise<{ path: string; text: string }> {
    return this.lock.inLock(async () => {
      const record = this.records.get(processId);
      if (!record) {
        throw new Error(`Unknown process id: ${processId}`);
      }
      const safeBytes = Math.max(1, Math.min(bytes, MAX_LOG_BYTES));
      let content = "";
      try {
        const raw = await fs.readFile(record.logPath, "utf8");
        if (Buffer.byteLength(raw, "utf8") <= safeBytes) {
          content = raw;
        } else {
          content = tailUtf8(raw, safeBytes);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return {
        path: record.logPath,
        text: content
      };
    });
  }

  private startMonitor(): void {
    if (this.monitorHandle) {
      return;
    }
    this.monitorHandle = setInterval(() => {
      void this.lock.inLock(async () => {
        await this.refreshRecordStatusLocked();
      }).catch((error) => {
        this.logger.warn({ error }, "Process monitor tick failed");
      });
    }, MONITOR_INTERVAL_MS);
    this.monitorHandle.unref();
  }

  private async refreshRecordStatusLocked(): Promise<void> {
    for (const record of this.records.values()) {
      const running = record.pid !== null && isProcessRunning(record.pid);
      if (running) {
        const now = Date.now();
        if (record.desiredState === "stopped") {
          await this.stopRecordLocked(record, "SIGTERM");
          await this.writeRecordLocked(record);
          continue;
        }

        if (
          record.restartFailureCount > 0 &&
          record.lastStartedAt !== null &&
          now - record.lastStartedAt >= RESTART_STABLE_UPTIME_MS
        ) {
          record.restartFailureCount = 0;
          record.nextRestartAt = null;
          record.updatedAt = now;
          await this.writeRecordLocked(record);
        }

        if (record.status !== "running") {
          record.status = "running";
          record.updatedAt = now;
          await this.writeRecordLocked(record);
        }
        continue;
      }

      if (record.pid !== null) {
        record.pid = null;
        record.lastExitedAt = Date.now();
      }

      if (record.desiredState === "running") {
        if (record.keepAlive) {
          await this.restartRecordWithBackoffLocked(record);
          continue;
        }
        if (record.status !== "exited") {
          record.status = "exited";
          record.updatedAt = Date.now();
          await this.writeRecordLocked(record);
        }
        continue;
      }

      if (record.status !== "stopped") {
        record.status = "stopped";
        record.restartFailureCount = 0;
        record.nextRestartAt = null;
        record.updatedAt = Date.now();
        await this.writeRecordLocked(record);
      }
    }
  }

  private async restartRecordWithBackoffLocked(record: ProcessRecord): Promise<void> {
    const now = Date.now();
    if (record.status !== "exited") {
      record.status = "exited";
      record.updatedAt = now;
      await this.writeRecordLocked(record);
    }

    if (record.nextRestartAt === null) {
      scheduleRestart(record, now);
      await this.writeRecordLocked(record);
      return;
    }
    if (now < record.nextRestartAt) {
      return;
    }

    try {
      await this.startRecordLocked(record, { incrementRestart: true });
      record.nextRestartAt = null;
      await this.writeRecordLocked(record);
    } catch (error) {
      this.logger.warn(
        { error, processId: record.id, restartFailureCount: record.restartFailureCount + 1 },
        "Process restart failed; backoff applied"
      );
      const failedAt = Date.now();
      record.pid = null;
      record.status = "exited";
      record.lastExitedAt = failedAt;
      scheduleRestart(record, failedAt);
      await this.writeRecordLocked(record);
    }
  }

  private async startRecordLocked(
    record: ProcessRecord,
    options: { incrementRestart: boolean }
  ): Promise<void> {
    const sandboxConfig = buildSandboxConfig(record.allowedDomains, record.permissions);
    await atomicWrite(record.settingsPath, JSON.stringify(sandboxConfig));
    const baseEnv = { ...process.env, ...record.env };
    const envResult = await sandboxHomeRedefine({ env: baseEnv, home: record.home ?? undefined });

    await fs.mkdir(path.dirname(record.logPath), { recursive: true });
    const logHandle = await fs.open(record.logPath, "a");
    const spawnResult = await spawnProcess({
      command: process.execPath,
      args: [sandboxCliPath, "--settings", record.settingsPath, "-c", record.command],
      cwd: record.cwd,
      env: envResult.env,
      logFd: logHandle.fd
    }).finally(async () => {
      await logHandle.close();
    });

    const child = spawnResult.child;
    const pid = child.pid;
    if (!pid) {
      throw new Error("Failed to capture process pid.");
    }

    child.unref();
    this.children.set(record.id, child);
    this.attachChildListeners(record.id, child);

    const now = Date.now();
    record.pid = pid;
    record.status = "running";
    record.lastStartedAt = now;
    record.updatedAt = now;
    if (options.incrementRestart) {
      record.restartCount += 1;
    }

    this.logger.info(
      {
        processId: record.id,
        pid: record.pid,
        keepAlive: record.keepAlive,
        cwd: record.cwd
      },
      "Process started"
    );
  }

  private attachChildListeners(processId: string, child: ChildProcess): void {
    child.on("exit", () => {
      void this.lock.inLock(async () => {
        const record = this.records.get(processId);
        if (!record) {
          return;
        }
        if (record.pid !== child.pid) {
          return;
        }
        this.children.delete(processId);
        record.pid = null;
        record.lastExitedAt = Date.now();
        if (record.desiredState === "stopped") {
          record.status = "stopped";
        } else {
          record.status = "exited";
        }
        record.updatedAt = Date.now();
        await this.writeRecordLocked(record);
      }).catch((error) => {
        this.logger.warn({ error, processId }, "Process exit handler failed");
      });
    });
  }

  private async stopRecordLocked(record: ProcessRecord, signal: ProcessSignal): Promise<void> {
    const pid = record.pid;
    if (pid !== null) {
      killProcessTree(pid, signal);
      await waitForStop(pid, PROCESS_STOP_TIMEOUT_MS);
    }

    const now = Date.now();
    record.pid = null;
    record.status = "stopped";
    record.nextRestartAt = null;
    record.restartFailureCount = 0;
    record.lastExitedAt = now;
    record.updatedAt = now;
    this.children.delete(record.id);

    this.logger.info({ processId: record.id, signal }, "Process stopped");
  }

  private async writeRecordLocked(record: ProcessRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.recordPath(record.id)), { recursive: true });
    const serialized = JSON.stringify(record, null, 2);
    await atomicWrite(this.recordPath(record.id), serialized);
  }

  private processDir(processId: string): string {
    return path.join(this.recordsDir, processId);
  }

  private recordPath(processId: string): string {
    return path.join(this.processDir(processId), "record.json");
  }
}

function buildSandboxConfig(
  allowedDomains: string[],
  permissions: SessionPermissions
): SandboxRuntimeConfig {
  return {
    filesystem: sandboxFilesystemPolicyBuild({ permissions }),
    network: {
      allowedDomains,
      deniedDomains: []
    }
  };
}

function toProcessInfo(record: ProcessRecord): ProcessInfo {
  return {
    id: record.id,
    name: record.name,
    command: record.command,
    cwd: record.cwd,
    home: record.home,
    pid: record.pid,
    keepAlive: record.keepAlive,
    desiredState: record.desiredState,
    status: record.status,
    restartCount: record.restartCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastStartedAt: record.lastStartedAt,
    lastExitedAt: record.lastExitedAt,
    logPath: record.logPath
  };
}

async function readRecord(recordPath: string): Promise<ProcessRecord | null> {
  try {
    const raw = await fs.readFile(recordPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProcessRecord>;
    if (parsed.version !== RECORD_VERSION) {
      return null;
    }
    if (
      !parsed.id ||
      !parsed.command ||
      !parsed.cwd ||
      !parsed.settingsPath ||
      !parsed.logPath ||
      !parsed.name
    ) {
      return null;
    }
    const permissions = parsePermissions(parsed.permissions);
    if (!permissions) {
      return null;
    }
    const keepAlive = parsed.keepAlive === true;
    const desiredState = parsed.desiredState === "stopped" ? "stopped" : "running";
    const status =
      parsed.status === "running" || parsed.status === "stopped" || parsed.status === "exited"
        ? parsed.status
        : "stopped";

    const packageManagers = Array.isArray(parsed.packageManagers)
      ? parsed.packageManagers.filter(isPackageManager)
      : [];
    const allowedDomains = Array.isArray(parsed.allowedDomains)
      ? parsed.allowedDomains.filter((entry): entry is string => typeof entry === "string")
      : [];
    const env =
      parsed.env && typeof parsed.env === "object"
        ? Object.fromEntries(
            Object.entries(parsed.env)
              .filter(([key, value]) => key.trim().length > 0 && typeof value === "string")
              .map(([key, value]) => [key.trim(), value])
          )
        : {};

    return {
      version: RECORD_VERSION,
      id: parsed.id,
      name: parsed.name,
      command: parsed.command,
      cwd: parsed.cwd,
      home: typeof parsed.home === "string" ? parsed.home : null,
      env,
      packageManagers,
      allowedDomains,
      permissions,
      keepAlive,
      desiredState,
      status,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      restartCount: typeof parsed.restartCount === "number" ? parsed.restartCount : 0,
      restartFailureCount:
        typeof parsed.restartFailureCount === "number" ? parsed.restartFailureCount : 0,
      nextRestartAt: typeof parsed.nextRestartAt === "number" ? parsed.nextRestartAt : null,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      lastStartedAt: typeof parsed.lastStartedAt === "number" ? parsed.lastStartedAt : null,
      lastExitedAt: typeof parsed.lastExitedAt === "number" ? parsed.lastExitedAt : null,
      settingsPath: parsed.settingsPath,
      logPath: parsed.logPath
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parsePermissions(value: unknown): SessionPermissions | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<SessionPermissions>;
  if (
    typeof candidate.workingDir !== "string" ||
    !Array.isArray(candidate.writeDirs) ||
    !Array.isArray(candidate.readDirs) ||
    typeof candidate.network !== "boolean"
  ) {
    return null;
  }
  const writeDirs = candidate.writeDirs.filter(
    (entry): entry is string => typeof entry === "string"
  );
  const readDirs = candidate.readDirs.filter(
    (entry): entry is string => typeof entry === "string"
  );
  return {
    workingDir: candidate.workingDir,
    writeDirs,
    readDirs,
    network: candidate.network
  };
}

function clonePermissions(permissions: SessionPermissions): SessionPermissions {
  return {
    workingDir: permissions.workingDir,
    writeDirs: [...permissions.writeDirs],
    readDirs: [...permissions.readDirs],
    network: permissions.network
  };
}

function isPackageManager(value: unknown): value is SandboxPackageManager {
  return (
    value === "dart" ||
    value === "dotnet" ||
    value === "go" ||
    value === "java" ||
    value === "node" ||
    value === "php" ||
    value === "python" ||
    value === "ruby" ||
    value === "rust"
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number, signal: ProcessSignal): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") {
      throw error;
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

async function waitForStop(pid: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(PROCESS_STOP_POLL_MS);
  }
  if (isProcessRunning(pid)) {
    killProcessTree(pid, "SIGKILL");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function spawnProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFd: number;
}): Promise<{ child: ChildProcess }> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", options.logFd, options.logFd]
  });

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      reject(error);
    });
    child.once("spawn", () => {
      resolve({ child });
    });
  });
}

function tailUtf8(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return input;
  }
  const sliced = buffer.subarray(buffer.byteLength - maxBytes);
  return sliced.toString("utf8");
}

function scheduleRestart(record: ProcessRecord, now: number): void {
  const uptimeMs = resolveUptimeMs(record, now);
  if (uptimeMs >= RESTART_STABLE_UPTIME_MS) {
    record.restartFailureCount = 0;
  }
  record.restartFailureCount += 1;
  const delayMs = restartBackoffMs(record.restartFailureCount);
  record.nextRestartAt = now + delayMs;
  record.updatedAt = now;
}

function resolveUptimeMs(record: ProcessRecord, now: number): number {
  const startedAt = record.lastStartedAt;
  if (startedAt === null) {
    return 0;
  }
  const exitedAt = record.lastExitedAt ?? now;
  if (exitedAt < startedAt) {
    return 0;
  }
  return exitedAt - startedAt;
}

function restartBackoffMs(restartFailureCount: number): number {
  const exponent = Math.max(0, restartFailureCount - 1);
  const delay = RESTART_BACKOFF_BASE_MS * 2 ** exponent;
  return Math.min(delay, RESTART_BACKOFF_MAX_MS);
}
