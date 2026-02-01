import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../log.js";
import { DEFAULT_SETTINGS_PATH, readSettingsFile } from "../settings.js";
import { awaitShutdown, onShutdown } from "../util/shutdown.js";
import { startEngineServer } from "../engine/ipc/server.js";
import { Engine } from "../engine/engine.js";
import { EngineEventBus } from "../engine/ipc/events.js";
import { promptConfirm } from "./prompts.js";
import { resolveEngineSocketPath } from "../engine/ipc/socket.js";
import { requestSocket } from "../engine/ipc/client.js";
import { DEFAULT_CLAYBOT_DIR } from "../paths.js";

const logger = getLogger("command.start");

export type StartOptions = {
  settings?: string;
  force?: boolean;
  verbose?: boolean;
};

export async function startCommand(options: StartOptions): Promise<void> {
  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);
  logger.info({ settings: settingsPath }, "Starting ClayBot");

  const dataDir = path.resolve(settings.engine?.dataDir ?? DEFAULT_CLAYBOT_DIR);
  const authPath = path.join(dataDir, "auth.json");
  const eventBus = new EngineEventBus();
  const socketPath = resolveEngineSocketPath(settings.engine?.socketPath);
  const configDir = path.dirname(settingsPath);
  const pidPath = path.join(configDir, "engine.pid");

  await ensureConfigDir(configDir);

  const socketResponsive = await isEngineRunning(socketPath);
  const existingPid = await readPidFile(pidPath);
  const pidRunning = existingPid ? isProcessRunning(existingPid) : false;
  const running = socketResponsive || pidRunning;
  if (running) {
    if (!socketResponsive && pidRunning) {
      logger.warn({ pid: existingPid }, "Engine process detected but socket unresponsive.");
    }
    const shouldRestart = options.force === true
      ? true
      : await promptConfirm({
          message: "Engine already running. Stop it and restart?",
          default: false
        });
    if (shouldRestart !== true) {
      logger.info("Engine already running; leaving it in place.");
      return;
    }

    const requested = await requestEngineShutdown(socketPath);
    if (!requested) {
      logger.warn("Failed to request engine shutdown. Aborting start.");
      return;
    }

    const stopped = await waitForEngineShutdown(socketPath, existingPid, 2000);
    if (!stopped) {
      logger.warn("Engine did not shut down in time. Aborting start.");
      return;
    }
    await removeStaleFile(socketPath);
    await removeStaleFile(pidPath);
  } else {
    await removeStaleFile(socketPath);
    await removeStaleFile(pidPath);
  }

  const runtime = new Engine({
    settings,
    dataDir,
    authPath,
    eventBus,
    configDir,
    verbose: options.verbose ?? false
  });

  await runtime.start();

  let engineServer:
    | Awaited<ReturnType<typeof startEngineServer>>
    | null = null;
  try {
    engineServer = await startEngineServer({
      settingsPath,
      runtime,
      eventBus,
      socketPath: settings.engine?.socketPath
    });
  } catch (error) {
    logger.warn({ error }, "Engine server failed to start");
  }

  if (engineServer) {
    await writePidFile(pidPath);
    onShutdown("engine-pid", () => removeStaleFile(pidPath));
  }

  onShutdown("engine-runtime", () => {
    void runtime.shutdown();
  });

  if (engineServer) {
    onShutdown("engine-server", () => {
      void engineServer?.close().catch((error) => {
        logger.warn({ error }, "Engine server shutdown failed");
      });
    });
  }

  logger.info("Ready. Listening for messages.");
  const signal = await awaitShutdown();
  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}

async function ensureConfigDir(configDir: string): Promise<void> {
  if (!configDir || configDir === ".") {
    return;
  }
  await fs.mkdir(configDir, { recursive: true });
}

async function isEngineRunning(socketPath: string): Promise<boolean> {
  try {
    const response = await requestSocket({
      socketPath,
      path: "/v1/engine/status",
      method: "GET"
    });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

async function requestEngineShutdown(socketPath: string): Promise<boolean> {
  try {
    const response = await requestSocket({
      socketPath,
      path: "/v1/engine/shutdown",
      method: "POST"
    });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

async function waitForEngineShutdown(
  socketPath: string,
  pid: number | null,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await isEngineRunning(socketPath);
    const pidRunning = pid ? isProcessRunning(pid) : false;
    if (!running && !pidRunning) {
      return true;
    }
    await delay(100);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function writePidFile(pidPath: string): Promise<void> {
  await fs.writeFile(pidPath, `${process.pid}\n`, { mode: 0o600 });
}

async function removeStaleFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(pidPath, "utf8");
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    return true;
  }
}
