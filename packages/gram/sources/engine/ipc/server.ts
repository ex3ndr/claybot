import { promises as fs } from "node:fs";
import path from "node:path";

import fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

import { getLogger } from "../../log.js";
import { resolveEngineSocketPath } from "./socket.js";
import type { Engine } from "../engine.js";
import {
  listPlugins,
  readSettingsFile,
  updateSettingsFile,
  upsertPlugin
} from "../../settings.js";
import type { EngineEventBus } from "./events.js";

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
  logger.debug({ settingsPath: options.settingsPath }, "[VERBOSE] startEngineServer() called");
  const socketPath = resolveEngineSocketPath(options.socketPath);
  logger.debug({ socketPath }, "[VERBOSE] Socket path resolved");
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  await fs.rm(socketPath, { force: true });
  logger.debug("[VERBOSE] Socket directory prepared");

  const app = fastify({ logger: false });
  logger.debug("[VERBOSE] Fastify app created");

  app.get("/v1/engine/status", async (_request, reply) => {
    logger.debug("[VERBOSE] GET /v1/engine/status");
    const status = options.runtime.getStatus();
    logger.debug({ pluginCount: status.plugins.length, connectorCount: status.connectors.length }, "[VERBOSE] Status retrieved");
    return reply.send({
      ok: true,
      status
    });
  });

  app.get("/v1/engine/cron/tasks", async (_request, reply) => {
    logger.debug("[VERBOSE] GET /v1/engine/cron/tasks");
    const tasks = options.runtime.getCronTasks();
    logger.debug({ taskCount: tasks.length }, "[VERBOSE] Cron tasks retrieved");
    return reply.send({ ok: true, tasks });
  });

  app.get("/v1/engine/sessions", async (_request, reply) => {
    logger.debug("[VERBOSE] GET /v1/engine/sessions");
    const sessions = await options.runtime.getSessionStore().listSessions();
    logger.debug({ sessionCount: sessions.length }, "[VERBOSE] Sessions retrieved");
    return reply.send({ ok: true, sessions });
  });

  app.get("/v1/engine/sessions/:storageId", async (request, reply) => {
    const storageId = (request.params as { storageId: string }).storageId;
    logger.debug({ storageId }, "[VERBOSE] GET /v1/engine/sessions/:storageId");
    const entries = await options.runtime.getSessionStore().readSessionEntries(storageId);
    logger.debug({ storageId, entryCount: entries?.length ?? 0 }, "[VERBOSE] Session entries retrieved");
    return reply.send({ ok: true, entries });
  });

  app.get("/v1/engine/memory/search", async (request, reply) => {
    const query = (request.query as { query?: string }).query ?? "";
    logger.debug({ queryLength: query.length }, "[VERBOSE] GET /v1/engine/memory/search");
    const result = await options.runtime.executeTool("memory_search", { query });
    if (result.toolMessage.isError) {
      logger.debug("[VERBOSE] Memory tool unavailable");
      return reply.status(400).send({ error: "Memory tool unavailable" });
    }
    const details = result.toolMessage.details as { entries?: unknown[] } | undefined;
    logger.debug({ resultCount: details?.entries?.length ?? 0 }, "[VERBOSE] Memory search completed");
    return reply.send({ ok: true, results: details?.entries ?? [] });
  });

  app.get("/v1/engine/plugins", async (_request, reply) => {
    logger.debug("[VERBOSE] GET /v1/engine/plugins");
    const settings = await readSettingsFile(options.settingsPath);
    const loaded = options.runtime.getPluginManager().listLoaded();
    const configured = listPlugins(settings);
    logger.debug({ loadedCount: loaded.length, configuredCount: configured.length }, "[VERBOSE] Plugin list retrieved");
    return reply.send({
      ok: true,
      loaded,
      configured
    });
  });

  app.post("/v1/engine/plugins/load", async (request, reply) => {
    logger.debug("[VERBOSE] POST /v1/engine/plugins/load");
    const payload = parseBody(pluginLoadSchema, request.body, reply);
    if (!payload) {
      logger.debug("[VERBOSE] Invalid payload for plugin load");
      return;
    }

    const pluginId = payload.pluginId ?? payload.id ?? payload.instanceId;
    const instanceId = payload.instanceId ?? payload.id ?? pluginId;
    if (!pluginId || !instanceId) {
      logger.debug("[VERBOSE] Missing pluginId or instanceId");
      reply.status(400).send({ error: "pluginId or instanceId required" });
      return;
    }

    logger.info({ plugin: pluginId, instance: instanceId }, "Plugin load requested");
    logger.debug({ pluginId, instanceId, hasSettings: !!payload.settings }, "[VERBOSE] Processing plugin load");

    const settings = await updateSettingsFile(options.settingsPath, (current) => {
      const existing = listPlugins(current).find(
        (plugin) => plugin.instanceId === instanceId
      );
      const config = existing ?? {
        instanceId,
        pluginId,
        enabled: true
      };
      logger.debug({ existing: !!existing }, "[VERBOSE] Updating settings file");
      return {
        ...current,
        plugins: upsertPlugin(current.plugins, {
          ...config,
          enabled: true,
          settings: payload.settings ?? config.settings
        })
      };
    });

    logger.debug("[VERBOSE] Updating runtime settings");
    await options.runtime.updateSettings(settings);

    options.eventBus.emit("plugin.loaded", { id: instanceId });
    logger.debug({ instanceId }, "[VERBOSE] Plugin load completed");
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/plugins/unload", async (request, reply) => {
    logger.debug("[VERBOSE] POST /v1/engine/plugins/unload");
    const payload = parseBody(pluginUnloadSchema, request.body, reply);
    if (!payload) {
      logger.debug("[VERBOSE] Invalid payload for plugin unload");
      return;
    }

    const instanceId = payload.instanceId ?? payload.id;
    if (!instanceId) {
      logger.debug("[VERBOSE] Missing instanceId");
      reply.status(400).send({ error: "instanceId required" });
      return;
    }

    logger.info({ instance: instanceId }, "Plugin unload requested");

    logger.debug({ instanceId }, "[VERBOSE] Updating settings file for unload");
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

    logger.debug("[VERBOSE] Updating runtime settings for unload");
    await options.runtime.updateSettings(settings);
    options.eventBus.emit("plugin.unloaded", { id: instanceId });
    logger.debug({ instanceId }, "[VERBOSE] Plugin unload completed");
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/auth", async (request, reply) => {
    logger.debug("[VERBOSE] POST /v1/engine/auth");
    const payload = parseBody(authSchema, request.body, reply);
    if (!payload) {
      logger.debug("[VERBOSE] Invalid payload for auth");
      return;
    }
    logger.debug({ id: payload.id, key: payload.key }, "[VERBOSE] Setting auth field");
    await options.runtime.getAuthStore().setField(payload.id, payload.key, payload.value);
    logger.debug("[VERBOSE] Auth field set");
    return reply.send({ ok: true });
  });

  app.get("/v1/engine/events", async (request, reply) => {
    logger.debug("[VERBOSE] GET /v1/engine/events (SSE connection)");
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    const sendEvent = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    logger.debug("[VERBOSE] Sending init event");
    sendEvent({
      type: "init",
      payload: {
        status: options.runtime.getStatus(),
        cron: options.runtime.getCronTasks()
      },
      timestamp: new Date().toISOString()
    });

    const unsubscribe = options.eventBus.onEvent((event) => {
      logger.debug({ eventType: (event as { type?: string }).type }, "[VERBOSE] Forwarding event to SSE client");
      sendEvent(event);
    });

    request.raw.on("close", () => {
      logger.debug("[VERBOSE] SSE connection closed");
      unsubscribe();
    });
  });

  logger.debug("[VERBOSE] Starting server listen");
  await app.listen({ path: socketPath });
  logger.info({ socket: socketPath }, "Engine server ready");
  logger.debug("[VERBOSE] Server listening on socket");

  return {
    socketPath,
    close: async () => {
      logger.debug("[VERBOSE] Closing engine server");
      await closeServer(app);
      await fs.rm(socketPath, { force: true });
      logger.debug("[VERBOSE] Engine server closed");
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
