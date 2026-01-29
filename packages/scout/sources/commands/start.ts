import { promises as fs } from "node:fs";
import path from "node:path";
import { getLogger } from "../logging/index.js";

import type { CronTaskConfig } from "../modules/runtime/cron.js";
import { CronScheduler } from "../modules/runtime/cron.js";
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
  const telegramFallback = await readJsonFile<TelegramConfig>(
    path.resolve(DEFAULT_TELEGRAM_CONFIG_PATH)
  );

  const connectors: { name: string; connector: Connector }[] = [];

  const telegramConfig =
    config.connectors?.telegram ?? telegramFallback ?? null;
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

  if (telegramConfig?.token) {
    logger.info("load: telegram");
    connectors.push({
      name: "telegram",
      connector: new TelegramConnector(telegramConfig)
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
    !cronConfig
  ) {
    logger.warn({ config: configPath }, "No connectors or cron configured");
    return;
  }

  const sessions = new SessionManager({
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
        handleSessionMessage(connector, entry, session, name)
      );
    });
  }

  let cron: CronScheduler | null = null;

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
        handleSessionMessage(null, entry, session, "cron")
      );
    },
    onError: (error, task) => {
      logger.warn({ task: task.id, error }, "Cron task failed");
    }
  });

  if (pm2Processes.length > 0) {
    logger.info("load: pm2");
    const pm2Runtime = new Pm2Runtime({
      connectTimeoutMs: !Array.isArray(pm2Config)
        ? pm2Config?.connectTimeoutMs
        : undefined,
      disconnectOnExit: !Array.isArray(pm2Config)
        ? pm2Config?.disconnectOnExit
        : undefined
    });

    try {
      await pm2Runtime.startProcesses(pm2Processes);
    } catch (error) {
      logger.warn({ error }, "Failed to start pm2 processes");
    }
  }

  logger.info(
    { connectors: connectors.map((entry) => entry.name) },
    "Bot started"
  );
  cron?.start();
  logger.info("Ready. Listening for messages.");
}

async function handleSessionMessage(
  connector: Connector | null,
  entry: SessionMessage,
  _session: { id: string },
  name: string
): Promise<void> {
  if (!entry.message.text) {
    return;
  }

  if (!connector) {
    return;
  }

  try {
    await connector.sendMessage(entry.context.channelId, {
      text: entry.message.text
    });
  } catch (error) {
    logger.warn({ connector: name, error }, "Failed to echo message");
  }
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
