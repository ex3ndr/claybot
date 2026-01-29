import { promises as fs } from "node:fs";
import path from "node:path";
import type { Context } from "@mariozechner/pi-ai";

import {
  DEFAULT_AUTH_PATH,
  getClaudeCodeToken,
  getCodexToken,
  getInferenceProviders,
  readAuthFile
} from "../auth.js";
import { getLogger } from "../log.js";
import { awaitShutdown, onShutdown, requestShutdown } from "../util/shutdown.js";

import type { CronTaskConfig } from "../modules/runtime/cron.js";
import { CronScheduler } from "../modules/runtime/cron.js";
import type {
  DockerContainerConfig,
  DockerRuntimeConfig
} from "../modules/runtime/containers.js";
import { DockerRuntime } from "../modules/runtime/containers.js";
import type {
  InferenceResult,
  InferenceRuntime
} from "../modules/runtime/inference.js";
import { runInferenceWithFallback } from "../modules/runtime/inference.js";
import type { Pm2ProcessConfig } from "../modules/runtime/pm2.js";
import { Pm2Runtime } from "../modules/runtime/pm2.js";
import { TelegramConnector } from "../connectors/telegram.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext
} from "../connectors/types.js";
import { SessionManager } from "../sessions/manager.js";
import type { SessionMessage } from "../sessions/types.js";

const logger = getLogger("command.start");

export type StartOptions = {
  config: string;
};

type TelegramConfig = {
  token: string;
  polling?: boolean;
  statePath?: string | null;
  retry?: {
    minDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: number;
  };
  enableGracefulShutdown?: boolean;
};

type ScoutConfig = {
  connectors?: {
    telegram?: TelegramConfig;
    cron?: CronConfig | CronTaskConfig[];
    chron?: CronConfig | CronTaskConfig[];
  };
  cron?: CronConfig | CronTaskConfig[];
  runtime?: RuntimeConfig;
};

const DEFAULT_TELEGRAM_CONFIG_PATH = ".scout/telegram.json";

type CronConfig = {
  tasks?: CronTaskConfig[];
};

type RuntimeConfig = {
  pm2?: Pm2Config | Pm2ProcessConfig[];
  containers?: DockerRuntimeConfig | DockerContainerConfig[];
};

type Pm2Config = {
  processes?: Pm2ProcessConfig[];
  connectTimeoutMs?: number;
  disconnectOnExit?: boolean;
};

export async function startCommand(options: StartOptions): Promise<void> {
  logger.info({ config: options.config }, "Starting scout");

  const configPath = path.resolve(options.config);
  const config = (await readJsonFile<ScoutConfig>(configPath)) ?? {};
  const auth = await readAuthFile(DEFAULT_AUTH_PATH);
  const telegramFallback = await readJsonFile<TelegramConfig>(
    path.resolve(DEFAULT_TELEGRAM_CONFIG_PATH)
  );

  const connectors: { name: string; connector: Connector }[] = [];

  const telegramConfig = config.connectors?.telegram ?? null;
  const legacyCronConfig =
    config.connectors?.chron ??
    config.connectors?.cron ??
    null;
  const cronConfig = config.cron ?? legacyCronConfig ?? null;
  const cronTasks = Array.isArray(cronConfig)
    ? cronConfig
    : cronConfig?.tasks ?? [];
  const pm2Config = config.runtime?.pm2 ?? null;
  const pm2Processes = Array.isArray(pm2Config)
    ? pm2Config
    : pm2Config?.processes ?? [];
  const containersConfig = config.runtime?.containers ?? null;
  const dockerContainers = Array.isArray(containersConfig)
    ? containersConfig
    : containersConfig?.containers ?? [];
  const dockerConnection = Array.isArray(containersConfig)
    ? undefined
    : containersConfig?.connection;
  const inferenceProviders = getInferenceProviders(auth);
  const inferenceRuntime: InferenceRuntime = {
    providers: inferenceProviders,
    codexToken: getCodexToken(auth),
    claudeCodeToken: getClaudeCodeToken(auth)
  };

  const telegramAuthToken = auth.telegram?.token ?? null;
  const telegramLegacyToken = telegramConfig?.token ?? telegramFallback?.token;
  const telegramToken = telegramAuthToken ?? telegramLegacyToken ?? null;

  if (telegramToken) {
    if (!telegramAuthToken && telegramLegacyToken) {
      logger.warn(
        "telegram auth should be stored in .scout/auth.json (auth.telegram.token)"
      );
    }
    logger.info("load: telegram");
    connectors.push({
      name: "telegram",
      connector: new TelegramConnector({
        ...(telegramConfig ?? {}),
        token: telegramToken,
        enableGracefulShutdown: false,
        onFatal: (reason, error) => {
          logger.warn(
            { reason, error },
            "Telegram connector requested shutdown"
          );
          void requestShutdown("fatal");
        }
      })
    });
  }

  logger.info(
    { connectors: connectors.map((entry) => entry.name) },
    "Connectors initialized"
  );

  if (
    connectors.length === 0 &&
    cronTasks.length === 0 &&
    pm2Processes.length === 0 &&
    dockerContainers.length === 0 &&
    !cronConfig
  ) {
    logger.warn(
      { config: configPath },
      "No connectors, cron, or runtime configured"
    );
    return;
  }

  const sessions = new SessionManager<{ context: Context }>({
    createState: () => ({ context: { messages: [] } }),
    onError: (error, session, entry) => {
      logger.warn(
        { sessionId: session.id, messageId: entry.id, error },
        "Session handler failed"
      );
    }
  });

  for (const { name, connector } of connectors) {
    connector.onMessage((message: ConnectorMessage, context: MessageContext) => {
      void sessions.handleMessage(name, message, context, (session, entry) =>
        handleSessionMessage(connector, entry, session, name, inferenceRuntime)
      );
    });
  }

  let cron: CronScheduler | null = null;
  let pm2Runtime: Pm2Runtime | null = null;
  let dockerRuntime: DockerRuntime | null = null;

  if (cronConfig) {
    if (config.connectors?.chron) {
      logger.warn(
        "config.connectors.chron is deprecated; use top-level cron instead"
      );
    }
    if (config.connectors?.cron) {
      logger.warn(
        "config.connectors.cron is deprecated; use top-level cron instead"
      );
    }
  }

  logger.info("load: cron");
  cron = new CronScheduler({
    tasks: cronTasks,
    onMessage: (message, context) => {
      void sessions.handleMessage("cron", message, context, (session, entry) =>
        handleSessionMessage(null, entry, session, "cron", inferenceRuntime)
      );
    },
    onError: (error, task) => {
      logger.warn({ task: task.id, error }, "Cron task failed");
    }
  });

  if (pm2Processes.length > 0) {
    logger.info("load: pm2");
    pm2Runtime = new Pm2Runtime({
      connectTimeoutMs: !Array.isArray(pm2Config)
        ? pm2Config?.connectTimeoutMs
        : undefined,
      disconnectOnExit: false
    });

    try {
      await pm2Runtime.startProcesses(pm2Processes);
    } catch (error) {
      logger.warn({ error }, "Failed to start pm2 processes");
    }
  }

  if (dockerContainers.length > 0) {
    logger.info("load: containers");
    dockerRuntime = new DockerRuntime({ connection: dockerConnection });
    try {
      await dockerRuntime.ensureConnected();
      await dockerRuntime.applyContainers(dockerContainers);
    } catch (error) {
      logger.warn({ error }, "Docker runtime failed");
    }
  }

  for (const { name, connector } of connectors) {
    if (typeof connector.shutdown !== "function") {
      continue;
    }
    onShutdown(`connector:${name}`, async () => {
      try {
        const maybe = connector.shutdown?.();
        if (maybe && typeof (maybe as Promise<void>).catch === "function") {
          void (maybe as Promise<void>).catch((error) => {
            logger.warn(
              { connector: name, error },
              "Connector shutdown failed"
            );
          });
        }
      } catch (error) {
        logger.warn({ connector: name, error }, "Connector shutdown failed");
      }
    });
  }

  if (cron) {
    onShutdown("cron", () => {
      cron?.stop();
    });
  }

  if (pm2Runtime) {
    onShutdown("pm2", () => {
      void pm2Runtime?.disconnect().catch((error) => {
        logger.warn({ error }, "pm2 disconnect failed");
      });
    });
  }

  logger.info(
    { connectors: connectors.map((entry) => entry.name) },
    "Bot started"
  );
  cron?.start();
  logger.info("Ready. Listening for messages.");

  const signal = await awaitShutdown();
  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}

async function handleSessionMessage(
  connector: Connector | null,
  entry: SessionMessage,
  session: { id: string; context: { state: { context: Context } } },
  name: string,
  inferenceRuntime: InferenceRuntime
): Promise<void> {
  if (!entry.message.text) {
    return;
  }

  if (!connector) {
    return;
  }

  if (inferenceRuntime.providers.length === 0) {
    await echoMessage(connector, entry, name);
    return;
  }

  const context = session.context.state.context;
  context.messages.push({
    role: "user",
    content: entry.message.text,
    timestamp: Date.now()
  });

  let response: InferenceResult;
  try {
    response = await runInferenceWithFallback(
      inferenceRuntime,
      context,
      session.id
    );
  } catch (error) {
    logger.warn({ connector: name, error }, "Inference failed");
    const message =
      error instanceof Error &&
      error.message === "No inference provider available"
        ? "No inference provider available."
        : "Inference failed.";
    await connector.sendMessage(entry.context.channelId, {
      text: message
    });
    return;
  }

  context.messages.push(response.message);

  const responseText = extractAssistantText(response.message);
  if (!responseText) {
    logger.warn({ provider: response.provider.id }, "Inference returned no text");
    return;
  }

  try {
    await connector.sendMessage(entry.context.channelId, {
      text: responseText
    });
  } catch (error) {
    logger.warn({ connector: name, error }, "Failed to echo message");
  }
}

async function echoMessage(
  connector: Connector,
  entry: SessionMessage,
  name: string
): Promise<void> {
  try {
    await connector.sendMessage(entry.context.channelId, {
      text: entry.message.text ?? ""
    });
  } catch (error) {
    logger.warn({ connector: name, error }, "Failed to echo message");
  }
}

function extractAssistantText(message: InferenceResult["message"]): string {
  const parts = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return parts.join("\n");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
