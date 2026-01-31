import { promises as fs } from "node:fs";
import path from "node:path";

import fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

import { getLogger } from "../../log.js";
import { resolveEngineSocketPath } from "./socket.js";
import type { Engine } from "../engine.js";
import {
  listPlugins,
  listEnabledPlugins,
  readSettingsFile,
  nextPluginInstanceId,
  updateSettingsFile,
  upsertPlugin
} from "../../settings.js";
import { buildPluginCatalog } from "../plugins/catalog.js";
import { resolveExclusivePlugins } from "../plugins/exclusive.js";
import type { EngineEventBus } from "./events.js";
import { requestShutdown } from "../../util/shutdown.js";

export type EngineServerOptions = {
  socketPath?: string;
  settingsPath: string;
  runtime: Engine;
  eventBus: EngineEventBus;
};

export type EngineServer = {
  socketPath: string;
  close: () => Promise<void>;
};

const pluginLoadSchema = z.object({
  pluginId: z.string().min(1).optional(),
  instanceId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  settings: z.record(z.unknown()).optional()
});
const pluginUnloadSchema = z.object({
  instanceId: z.string().min(1).optional(),
  id: z.string().min(1).optional()
});
const authSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1)
});

export async function startEngineServer(
  options: EngineServerOptions
): Promise<EngineServer> {
  const logger = getLogger("engine.server");
  logger.debug(`startEngineServer() called settingsPath=${options.settingsPath}`);
  const socketPath = resolveEngineSocketPath(options.socketPath);
  logger.debug(`Socket path resolved socketPath=${socketPath}`);
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  await fs.rm(socketPath, { force: true });
  logger.debug("Socket directory prepared");

  const app = fastify({ logger: false });
  logger.debug("Fastify app created");
  const pluginCatalog = buildPluginCatalog();

  app.get("/v1/engine/status", async (_request, reply) => {
    logger.debug("GET /v1/engine/status");
    const status = options.runtime.getStatus();
    logger.debug(`Status retrieved pluginCount=${status.plugins.length} connectorCount=${status.connectors.length}`);
    return reply.send({
      ok: true,
      status
    });
  });

  app.get("/v1/engine/cron/tasks", async (_request, reply) => {
    logger.debug("GET /v1/engine/cron/tasks");
    const tasks = options.runtime.getCronTasks();
    logger.debug(`Cron tasks retrieved taskCount=${tasks.length}`);
    return reply.send({ ok: true, tasks });
  });

  app.get("/v1/engine/sessions", async (_request, reply) => {
    logger.debug("GET /v1/engine/sessions");
    const sessions = await options.runtime.getSessionStore().listSessions();
    logger.debug(`Sessions retrieved sessionCount=${sessions.length}`);
    return reply.send({ ok: true, sessions });
  });

  app.get("/v1/engine/sessions/:storageId", async (request, reply) => {
    const storageId = (request.params as { storageId: string }).storageId;
    logger.debug(`GET /v1/engine/sessions/:storageId storageId=${storageId}`);
    const entries = await options.runtime.getSessionStore().readSessionEntries(storageId);
    logger.debug(`Session entries retrieved storageId=${storageId} entryCount=${entries?.length ?? 0}`);
    return reply.send({ ok: true, entries });
  });

  app.post("/v1/engine/sessions/:storageId/reset", async (request, reply) => {
    const storageId = (request.params as { storageId: string }).storageId;
    logger.debug(`POST /v1/engine/sessions/:storageId/reset storageId=${storageId}`);
    const ok = options.runtime.resetSessionByStorageId(storageId);
    if (!ok) {
      logger.debug(`Session reset failed storageId=${storageId}`);
      return reply.status(404).send({ ok: false, error: "Session not found" });
    }
    logger.info({ storageId }, "Session reset");
    return reply.send({ ok: true });
  });

  app.get("/v1/engine/plugins", async (_request, reply) => {
    logger.debug("GET /v1/engine/plugins");
    const settings = await readSettingsFile(options.settingsPath);
    const loaded = options.runtime.getPluginManager().listLoaded();
    const configured = listPlugins(settings);
    logger.debug(`Plugin list retrieved loadedCount=${loaded.length} configuredCount=${configured.length}`);
    return reply.send({
      ok: true,
      loaded,
      configured
    });
  });

  app.post("/v1/engine/plugins/load", async (request, reply) => {
    logger.debug("POST /v1/engine/plugins/load");
    const payload = parseBody(pluginLoadSchema, request.body, reply);
    if (!payload) {
      logger.debug("Invalid payload for plugin load");
      return;
    }

    const pluginId = payload.pluginId ?? payload.id ?? payload.instanceId;
    const requestedInstanceId = payload.instanceId ?? payload.id;
    if (!pluginId) {
      logger.debug("Missing pluginId");
      reply.status(400).send({ error: "pluginId required" });
      return;
    }

    const currentSettings = await readSettingsFile(options.settingsPath);
    const instanceId =
      requestedInstanceId ?? nextPluginInstanceId(pluginId, currentSettings.plugins);
    logger.info({ plugin: pluginId, instance: instanceId }, "Plugin load requested");
    logger.debug(`Processing plugin load pluginId=${pluginId} instanceId=${instanceId} hasSettings=${!!payload.settings}`);

    let settings;
    try {
      settings = await updateSettingsFile(options.settingsPath, (current) => {
        const existing = listPlugins(current).find(
          (plugin) => plugin.instanceId === instanceId
        );
        const config = existing ?? {
          instanceId,
          pluginId,
          enabled: true
        };
        logger.debug(`Updating settings file existing=${!!existing}`);
        const nextPlugins = upsertPlugin(current.plugins, {
          ...config,
          enabled: true,
          settings: payload.settings ?? config.settings
        });
        const nextSettings = {
          ...current,
          plugins: nextPlugins
        };
        const resolution = resolveExclusivePlugins(
          listEnabledPlugins(nextSettings),
          pluginCatalog
        );
        if (resolution.skipped.length > 0) {
          const exclusiveId = resolution.exclusive?.pluginId;
          const exclusiveName =
            (exclusiveId && pluginCatalog.get(exclusiveId)?.descriptor.name) ??
            exclusiveId ??
            "Exclusive plugin";
          throw new Error(
            `${exclusiveName} is marked exclusive, so only one plugin can be enabled at a time.`
          );
        }
        return nextSettings;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plugin enable failed.";
      reply.status(400).send({ error: message });
      return;
    }

    logger.debug("Updating runtime settings");
    await options.runtime.updateSettings(settings);

    options.eventBus.emit("plugin.loaded", { id: instanceId });
    logger.debug(`Plugin load completed instanceId=${instanceId}`);
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/plugins/unload", async (request, reply) => {
    logger.debug("POST /v1/engine/plugins/unload");
    const payload = parseBody(pluginUnloadSchema, request.body, reply);
    if (!payload) {
      logger.debug("Invalid payload for plugin unload");
      return;
    }

    const instanceId = payload.instanceId ?? payload.id;
    if (!instanceId) {
      logger.debug("Missing instanceId");
      reply.status(400).send({ error: "instanceId required" });
      return;
    }

    logger.info({ instance: instanceId }, "Plugin unload requested");

    logger.debug(`Updating settings file for unload instanceId=${instanceId}`);
    const settings = await updateSettingsFile(options.settingsPath, (current) => ({
      ...current,
      plugins: upsertPlugin(current.plugins, {
        ...(listPlugins(current).find((plugin) => plugin.instanceId === instanceId) ?? {
          instanceId,
          pluginId: instanceId
        }),
        enabled: false
      })
    }));

    logger.debug("Updating runtime settings for unload");
    await options.runtime.updateSettings(settings);
    options.eventBus.emit("plugin.unloaded", { id: instanceId });
    logger.debug(`Plugin unload completed instanceId=${instanceId}`);
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/auth", async (request, reply) => {
    logger.debug("POST /v1/engine/auth");
    const payload = parseBody(authSchema, request.body, reply);
    if (!payload) {
      logger.debug("Invalid payload for auth");
      return;
    }
    logger.debug(`Setting auth field id=${payload.id} key=${payload.key}`);
    await options.runtime.getAuthStore().setField(payload.id, payload.key, payload.value);
    logger.debug("Auth field set");
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/shutdown", async (_request, reply) => {
    logger.info("Shutdown requested via API");
    reply.send({ ok: true });
    setImmediate(() => {
      requestShutdown("SIGTERM");
    });
  });

  app.get("/v1/engine/events", async (request, reply) => {
    logger.debug("GET /v1/engine/events (SSE connection)");
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    const sendEvent = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    logger.debug("Sending init event");
    sendEvent({
      type: "init",
      payload: {
        status: options.runtime.getStatus(),
        cron: options.runtime.getCronTasks()
      },
      timestamp: new Date().toISOString()
    });

    const unsubscribe = options.eventBus.onEvent((event) => {
      logger.debug(`Forwarding event to SSE client eventType=${(event as { type?: string }).type}`);
      sendEvent(event);
    });

    request.raw.on("close", () => {
      logger.debug("SSE connection closed");
      unsubscribe();
    });
  });

  logger.debug("Starting server listen");
  await app.listen({ path: socketPath });
  logger.info({ socket: socketPath }, "Engine server ready");
  logger.debug("Server listening on socket");

  return {
    socketPath,
    close: async () => {
      logger.debug("Closing engine server");
      await closeServer(app);
      await fs.rm(socketPath, { force: true });
      logger.debug("Engine server closed");
    }
  };
}

function parseBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  reply: FastifyReply
): T | null {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }
  reply.status(400).send({
    error: "Invalid payload",
    details: result.error.flatten()
  });
  return null;
}

async function closeServer(app: FastifyInstance): Promise<void> {
  await app.close();
}
