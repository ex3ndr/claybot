import path from "node:path";

import { getLogger } from "../log.js";
import { readSettingsFile } from "../settings.js";
import { awaitShutdown, onShutdown } from "../util/shutdown.js";
import { startEngineServer } from "../engine/server.js";
import { EngineRuntime } from "../engine/runtime.js";
import { EngineEventBus } from "../engine/events.js";
import type {
  DockerContainerConfig,
  DockerRuntimeConfig
} from "../modules/runtime/containers.js";
import { DockerRuntime } from "../modules/runtime/containers.js";
import type { Pm2ProcessConfig } from "../modules/runtime/pm2.js";
import { Pm2Runtime } from "../modules/runtime/pm2.js";

const logger = getLogger("command.start");

export type StartOptions = {
  settings: string;
};

type Pm2Config = {
  processes?: Pm2ProcessConfig[];
  connectTimeoutMs?: number;
  disconnectOnExit?: boolean;
};

export async function startCommand(options: StartOptions): Promise<void> {
  const settingsPath = path.resolve(options.settings);
  const settings = await readSettingsFile(settingsPath);
  logger.info({ settings: settingsPath }, "Starting scout");

  const dataDir = path.resolve(settings.engine?.dataDir ?? ".scout");
  const secretsPath = path.join(dataDir, "secrets.json");
  const eventBus = new EngineEventBus();

  const runtime = new EngineRuntime({
    settings,
    dataDir,
    secretsPath,
    eventBus
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

  let pm2Runtime: Pm2Runtime | null = null;
  let dockerRuntime: DockerRuntime | null = null;

  const pm2Config = settings.runtime?.pm2 ?? null;
  const pm2Processes = Array.isArray(pm2Config)
    ? pm2Config
    : (pm2Config as Pm2Config | null)?.processes ?? [];
  const assistantPm2Enabled = (settings.assistant?.allowedPm2Processes ?? []).length > 0;
  if (pm2Processes.length > 0 || pm2Config || assistantPm2Enabled) {
    logger.info("load: pm2");
    pm2Runtime = new Pm2Runtime({
      connectTimeoutMs: !Array.isArray(pm2Config)
        ? (pm2Config as Pm2Config | null)?.connectTimeoutMs
        : undefined,
      disconnectOnExit: false
    });
    try {
      if (pm2Processes.length > 0) {
        await pm2Runtime.startProcesses(pm2Processes);
      }
    } catch (error) {
      logger.warn({ error }, "Failed to start pm2 processes");
    }
  }
  runtime.setPm2Runtime(pm2Runtime);

  const containersConfig = settings.runtime?.containers ?? null;
  const dockerContainers = Array.isArray(containersConfig)
    ? containersConfig
    : containersConfig && "containers" in containersConfig
      ? containersConfig.containers ?? []
      : [];
  const dockerConnection = Array.isArray(containersConfig)
    ? undefined
    : containersConfig && "connection" in containersConfig
      ? containersConfig.connection
      : undefined;
  const assistantDockerEnabled =
    (settings.assistant?.allowedDockerImages ?? []).length > 0 ||
    (settings.assistant?.allowedDockerContainers ?? []).length > 0;
  if (dockerContainers.length > 0 || containersConfig || assistantDockerEnabled) {
    logger.info("load: containers");
    dockerRuntime = new DockerRuntime({ connection: dockerConnection });
    try {
      await dockerRuntime.ensureConnected();
      if (dockerContainers.length > 0) {
        await dockerRuntime.applyContainers(dockerContainers);
      }
    } catch (error) {
      logger.warn({ error }, "Docker runtime failed");
    }
  }
  runtime.setDockerRuntime(dockerRuntime);

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

  if (pm2Runtime) {
    onShutdown("pm2", () => {
      void pm2Runtime?.disconnect().catch((error) => {
        logger.warn({ error }, "pm2 disconnect failed");
      });
    });
  }

  logger.info("Ready. Listening for messages.");
  const signal = await awaitShutdown();
  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}
