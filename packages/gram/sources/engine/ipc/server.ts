import { promises as fs } from "node:fs";
import path from "node:path";

import fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

import { getLogger } from "../../log.js";
import { resolveEngineSocketPath } from "./socket.js";
import type { EngineRuntime } from "../runtime.js";
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
  runtime: EngineRuntime;
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
  const socketPath = resolveEngineSocketPath(options.socketPath);
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  await fs.rm(socketPath, { force: true });

  const app = fastify({ logger: false });

  app.get("/v1/engine/status", async (_request, reply) => {
    return reply.send({
      ok: true,
      status: options.runtime.getStatus()
    });
  });

  app.get("/v1/engine/cron/tasks", async (_request, reply) => {
    return reply.send({ ok: true, tasks: options.runtime.getCronTasks() });
  });

  app.get("/v1/engine/sessions", async (_request, reply) => {
    const sessions = await options.runtime.getSessionStore().listSessions();
    return reply.send({ ok: true, sessions });
  });

  app.get("/v1/engine/sessions/:storageId", async (request, reply) => {
    const storageId = (request.params as { storageId: string }).storageId;
    const entries = await options.runtime.getSessionStore().readSessionEntries(storageId);
    return reply.send({ ok: true, entries });
  });

  app.get("/v1/engine/memory/search", async (request, reply) => {
    const query = (request.query as { query?: string }).query ?? "";
    const memory = options.runtime.getMemoryEngine();
    if (!memory) {
      return reply.status(400).send({ error: "Memory engine unavailable" });
    }
    const results = await memory.query(query);
    return reply.send({ ok: true, results });
  });

  app.get("/v1/engine/plugins", async (_request, reply) => {
    const settings = await readSettingsFile(options.settingsPath);
    return reply.send({
      ok: true,
      loaded: options.runtime.getPluginManager().listLoaded(),
      configured: listPlugins(settings)
    });
  });

  app.post("/v1/engine/plugins/load", async (request, reply) => {
    const payload = parseBody(pluginLoadSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const pluginId = payload.pluginId ?? payload.id ?? payload.instanceId;
    const instanceId = payload.instanceId ?? payload.id ?? pluginId;
    if (!pluginId || !instanceId) {
      reply.status(400).send({ error: "pluginId or instanceId required" });
      return;
    }

    logger.info({ plugin: pluginId, instance: instanceId }, "Plugin load requested");

    const settings = await updateSettingsFile(options.settingsPath, (current) => {
      const existing = listPlugins(current).find(
        (plugin) => plugin.instanceId === instanceId
      );
      const config = existing ?? {
        instanceId,
        pluginId,
        enabled: true
      };
      return {
        ...current,
        plugins: upsertPlugin(current.plugins, {
          ...config,
          enabled: true,
          settings: payload.settings ?? config.settings
        })
      };
    });

    await options.runtime.updateSettings(settings);

    options.eventBus.emit("plugin.loaded", { id: instanceId });
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/plugins/unload", async (request, reply) => {
    const payload = parseBody(pluginUnloadSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const instanceId = payload.instanceId ?? payload.id;
    if (!instanceId) {
      reply.status(400).send({ error: "instanceId required" });
      return;
    }

    logger.info({ instance: instanceId }, "Plugin unload requested");

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

    await options.runtime.updateSettings(settings);
    options.eventBus.emit("plugin.unloaded", { id: instanceId });
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/auth", async (request, reply) => {
    const payload = parseBody(authSchema, request.body, reply);
    if (!payload) {
      return;
    }
    await options.runtime.getAuthStore().setField(payload.id, payload.key, payload.value);
    return reply.send({ ok: true });
  });

  app.get("/v1/engine/events", async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    const sendEvent = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent({
      type: "init",
      payload: {
        status: options.runtime.getStatus(),
        cron: options.runtime.getCronTasks()
      },
      timestamp: new Date().toISOString()
    });

    const unsubscribe = options.eventBus.onEvent((event) => {
      sendEvent(event);
    });

    request.raw.on("close", () => {
      unsubscribe();
    });
  });

  await app.listen({ path: socketPath });
  logger.info({ socket: socketPath }, "Engine server ready");

  return {
    socketPath,
    close: async () => {
      await closeServer(app);
      await fs.rm(socketPath, { force: true });
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
