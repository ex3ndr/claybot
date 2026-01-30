import path from "node:path";

import { getLogger } from "../log.js";
import { readSettingsFile } from "../settings.js";
import { awaitShutdown, onShutdown } from "../util/shutdown.js";
import { startEngineServer } from "../engine/ipc/server.js";
import { EngineRuntime } from "../engine/runtime.js";
import { EngineEventBus } from "../engine/ipc/events.js";

const logger = getLogger("command.start");

export type StartOptions = {
  settings: string;
};

export async function startCommand(options: StartOptions): Promise<void> {
  const settingsPath = path.resolve(options.settings);
  const settings = await readSettingsFile(settingsPath);
  logger.info({ settings: settingsPath }, "Starting grambot");

  const dataDir = path.resolve(settings.engine?.dataDir ?? ".scout");
  const authPath = path.join(dataDir, "auth.json");
  const eventBus = new EngineEventBus();

  const runtime = new EngineRuntime({
    settings,
    dataDir,
    authPath,
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
