import { promises as fs } from "node:fs";
import path from "node:path";
import type { Context } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";

import {
  DEFAULT_AUTH_PATH,
  getClaudeCodeToken,
  getCodexToken,
  getInferenceProviders,
  readAuthFile
} from "../auth.js";
import { getLogger } from "../log.js";
import { awaitShutdown, onShutdown, requestShutdown } from "../util/shutdown.js";
import { startEngineServer } from "../engine/server.js";

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
import { ConnectorManager } from "../connectors/manager.js";
import type { Connector, MessageContext } from "../connectors/types.js";
import { SessionManager } from "../sessions/manager.js";
import { Session } from "../sessions/session.js";
import { SessionStore } from "../sessions/store.js";
import type { SessionMessage } from "../sessions/types.js";

const logger = getLogger("command.start");

export type StartOptions = {
  config: string;
};

type TelegramConfig = {
  token?: string;
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
  let auth = await readAuthFile(DEFAULT_AUTH_PATH);
  const telegramFallback = await readJsonFile<TelegramConfig>(
    path.resolve(DEFAULT_TELEGRAM_CONFIG_PATH)
  );

  const telegramConfig = config.connectors?.telegram ?? null;
  const { token: _configToken, ...telegramRuntimeConfig } =
    telegramConfig ?? {};
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
    claudeCodeToken: getClaudeCodeToken(auth),
    auth
  };
  let currentAuth = auth;
  const syncAuthState = (updatedAuth: typeof auth) => {
    currentAuth = updatedAuth;
    inferenceRuntime.auth = updatedAuth;
    inferenceRuntime.providers = getInferenceProviders(updatedAuth);
    inferenceRuntime.codexToken = getCodexToken(updatedAuth);
    inferenceRuntime.claudeCodeToken = getClaudeCodeToken(updatedAuth);
  };

  const telegramAuthToken = auth.telegram?.token ?? null;
  const telegramLegacyToken = telegramConfig?.token ?? telegramFallback?.token;
  const telegramToken = telegramAuthToken ?? telegramLegacyToken ?? null;

  if (
    !telegramToken &&
    cronTasks.length === 0 &&
    pm2Processes.length === 0 &&
    dockerContainers.length === 0 &&
    !cronConfig
  ) {
    logger.warn(
      { config: configPath },
      "No connectors, cron, or runtime configured"
    );
  }

  const sessionStore = new SessionStore<{ context: Context }>();
  const sessions = new SessionManager<{ context: Context }>({
    createState: () => ({ context: { messages: [] } }),
    storageIdFactory: () => sessionStore.createStorageId(),
    onSessionCreated: (session, source, context) => {
      logger.info(
        {
          sessionId: session.id,
          source,
          channelId: context.channelId,
          userId: context.userId
        },
        "Session created"
      );
      void sessionStore
        .recordSessionCreated(session, source, context)
        .catch((error) => {
          logger.warn(
            { sessionId: session.id, source, error },
            "Session persistence failed"
          );
        });
    },
    onSessionUpdated: (session, entry, source) => {
      logger.info(
        {
          sessionId: session.id,
          source,
          messageId: entry.id,
          pending: session.size
        },
        "Session updated"
      );
      void sessionStore.recordIncoming(session, entry, source).catch((error) => {
        logger.warn(
          { sessionId: session.id, source, messageId: entry.id, error },
          "Session persistence failed"
        );
      });
    },
    onMessageStart: (session, entry, source) => {
      logger.info(
        { sessionId: session.id, source, messageId: entry.id },
        "Session processing started"
      );
    },
    onMessageEnd: (session, entry, source) => {
      logger.info(
        { sessionId: session.id, source, messageId: entry.id },
        "Session processing completed"
      );
    },
    onError: (error, session, entry) => {
      logger.warn(
        { sessionId: session.id, messageId: entry.id, error },
        "Session handler failed"
      );
    }
  });

  const pendingInternalErrors: Array<{
    session: Session<{ context: Context }>;
    source: string;
    context: MessageContext;
  }> = [];

  const restoredSessions = await sessionStore.loadSessions();
  for (const restored of restoredSessions) {
    const session = sessions.restoreSession(
      restored.sessionId,
      restored.storageId,
      restored.state,
      restored.createdAt,
      restored.updatedAt
    );
    logger.info(
      { sessionId: session.id, source: restored.source },
      "Session restored"
    );

    if (restored.lastEntryType === "incoming") {
      pendingInternalErrors.push({
        session,
        source: restored.source,
        context: restored.context
      });
    }
  }

  const connectorManager = new ConnectorManager({
    telegramConfig: telegramRuntimeConfig,
    onMessage: (name, message, context) => {
      void sessions.handleMessage(name, message, context, (session, entry) =>
        handleSessionMessage(
          connectorManager,
          entry,
          session,
          name,
          inferenceRuntime,
          sessionStore
        )
      );
    },
    onFatal: (name, reason, error) => {
      logger.warn(
        { connector: name, reason, error },
        "Connector requested shutdown"
      );
      requestShutdown("fatal");
    }
  });

  if (telegramToken) {
    if (!telegramAuthToken && telegramLegacyToken) {
      logger.warn(
        "telegram auth should be stored in .scout/auth.json (auth.telegram.token)"
      );
    }
    logger.info("load: telegram");
    await connectorManager.syncTelegramToken(telegramToken);
  }

  logger.info(
    { connectors: connectorManager.list() },
    "Connectors initialized"
  );

  if (pendingInternalErrors.length > 0) {
    await sendPendingInternalErrors(
      connectorManager,
      sessionStore,
      pendingInternalErrors
    );
  }

  let engineServer:
    | Awaited<ReturnType<typeof startEngineServer>>
    | null = null;
  try {
    engineServer = await startEngineServer({
      onAuthUpdated: async (updatedAuth) => {
        syncAuthState(updatedAuth);
        await connectorManager.syncTelegramToken(
          updatedAuth.telegram?.token ?? null
        );
      },
      onConnectorLoad: async (id) => {
        if (id !== "telegram") {
          return {
            ok: false,
            status: "unknown",
            message: "Unknown connector"
          };
        }
        return connectorManager.load(
          "telegram",
          currentAuth.telegram?.token ?? null
        );
      },
      onConnectorUnload: async (id) => {
        if (id !== "telegram") {
          return {
            ok: false,
            status: "unknown",
            message: "Unknown connector"
          };
        }
        return connectorManager.unload("telegram", "unload");
      }
    });
  } catch (error) {
    logger.warn({ error }, "Engine server failed to start");
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
        handleSessionMessage(null, entry, session, "cron", inferenceRuntime, sessionStore)
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

  onShutdown("connectors", () => {
    void connectorManager.unloadAll("shutdown");
  });

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

  if (engineServer) {
    onShutdown("engine-server", () => {
      void engineServer?.close().catch((error) => {
        logger.warn({ error }, "Engine server shutdown failed");
      });
    });
  }

  logger.info({ connectors: connectorManager.list() }, "Bot started");
  cron?.start();
  logger.info("Ready. Listening for messages.");

  const signal = await awaitShutdown();
  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}

async function handleSessionMessage(
  connectorManager: ConnectorManager | null,
  entry: SessionMessage,
  session: Session<{ context: Context }>,
  name: string,
  inferenceRuntime: InferenceRuntime,
  sessionStore: SessionStore<{ context: Context }>
): Promise<void> {
  if (!entry.message.text) {
    return;
  }

  if (!connectorManager) {
    return;
  }

  if (name !== "telegram") {
    return;
  }

  const connector = connectorManager.get("telegram");
  if (!connector) {
    return;
  }

  if (inferenceRuntime.providers.length === 0) {
    await echoMessage(connector, entry, name);
    await recordOutgoingEntry(
      sessionStore,
      session,
      name,
      entry.context,
      entry.message.text
    );
    return;
  }

  const inference = {
    ...inferenceRuntime,
    onAttempt: (provider, modelId) => {
      logger.info(
        {
          sessionId: session.id,
          messageId: entry.id,
          provider: provider.id,
          model: modelId
        },
        "Inference started"
      );
    },
    onFallback: (provider, error) => {
      logger.warn(
        {
          sessionId: session.id,
          messageId: entry.id,
          provider: provider.id,
          error
        },
        "Inference fallback"
      );
    },
    onSuccess: (provider, modelId, message) => {
      logger.info(
        {
          sessionId: session.id,
          messageId: entry.id,
          provider: provider.id,
          model: modelId,
          stopReason: message.stopReason,
          usage: message.usage
        },
        "Inference completed"
      );
    },
    onFailure: (provider, error) => {
      logger.warn(
        {
          sessionId: session.id,
          messageId: entry.id,
          provider: provider.id,
          error
        },
        "Inference failed"
      );
    }
  } satisfies InferenceRuntime;

  const context = session.context.state.context;
  context.messages.push({
    role: "user",
    content: entry.message.text,
    timestamp: Date.now()
  });

  let response: InferenceResult;
  try {
    response = await runInferenceWithFallback(
      inference,
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
    await connector.sendMessage(entry.context.channelId, { text: message });
    await recordOutgoingEntry(
      sessionStore,
      session,
      name,
      entry.context,
      message
    );
    await recordSessionState(sessionStore, session, name);
    return;
  }

  context.messages.push(response.message);

  const responseText = extractAssistantText(response.message);
  if (!responseText) {
    logger.warn({ provider: response.provider.id }, "Inference returned no text");
    await recordSessionState(sessionStore, session, name);
    return;
  }

  try {
    await connector.sendMessage(entry.context.channelId, { text: responseText });
    await recordOutgoingEntry(
      sessionStore,
      session,
      name,
      entry.context,
      responseText
    );
  } catch (error) {
    logger.warn({ connector: name, error }, "Failed to echo message");
  } finally {
    await recordSessionState(sessionStore, session, name);
  }
}

async function sendPendingInternalErrors(
  connectorManager: ConnectorManager,
  sessionStore: SessionStore<{ context: Context }>,
  pending: Array<{
    session: Session<{ context: Context }>;
    source: string;
    context: MessageContext;
  }>
): Promise<void> {
  const message = "Internal error.";

  for (const entry of pending) {
    if (entry.source !== "telegram") {
      logger.warn(
        { sessionId: entry.session.id, source: entry.source },
        "Pending session reply skipped"
      );
      continue;
    }

    const connector = connectorManager.get("telegram");
    if (!connector) {
      logger.warn(
        { sessionId: entry.session.id, source: entry.source },
        "Pending session reply skipped"
      );
      continue;
    }

    try {
      await connector.sendMessage(entry.context.channelId, { text: message });
      await recordOutgoingEntry(
        sessionStore,
        entry.session,
        entry.source,
        entry.context,
        message
      );
      await recordSessionState(sessionStore, entry.session, entry.source);
    } catch (error) {
      logger.warn(
        { sessionId: entry.session.id, source: entry.source, error },
        "Failed to send pending session reply"
      );
    }
  }
}

async function recordOutgoingEntry(
  sessionStore: SessionStore<{ context: Context }>,
  session: Session<{ context: Context }>,
  source: string,
  context: MessageContext,
  text: string | null
): Promise<void> {
  const messageId = createId();
  try {
    await sessionStore.recordOutgoing(
      session,
      messageId,
      source,
      context,
      text
    );
  } catch (error) {
    logger.warn(
      { sessionId: session.id, source, messageId, error },
      "Session persistence failed"
    );
  }
}

async function recordSessionState(
  sessionStore: SessionStore<{ context: Context }>,
  session: Session<{ context: Context }>,
  source: string
): Promise<void> {
  try {
    await sessionStore.recordState(session);
  } catch (error) {
    logger.warn(
      { sessionId: session.id, source, error },
      "Session persistence failed"
    );
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
