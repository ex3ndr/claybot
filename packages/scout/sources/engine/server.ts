import { promises as fs } from "node:fs";
import path from "node:path";

import fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

import { DEFAULT_AUTH_PATH, updateAuthFile, type AuthConfig } from "../auth.js";
import { getLogger } from "../log.js";
import {
  applyClaudeCodeAuthUpdate,
  applyCodexAuthUpdate,
  applyTelegramAuthUpdate,
  removeClaudeCodeAuth,
  removeCodexAuth,
  removeTelegramAuth
} from "./auth.js";
import { resolveEngineSocketPath } from "./socket.js";
import type { ConnectorActionResult } from "../connectors/manager.js";

export type EngineServerOptions = {
  socketPath?: string;
  onAuthUpdated?: (auth: AuthConfig) => void | Promise<void>;
  onConnectorLoad?: (id: string) => Promise<ConnectorActionResult>;
  onConnectorUnload?: (id: string) => Promise<ConnectorActionResult>;
};

export type EngineServer = {
  socketPath: string;
  close: () => Promise<void>;
};

const tokenSchema = z.object({ token: z.string().min(1) });
const codexSchema = tokenSchema.extend({
  model: z.string().min(1),
  main: z.boolean().optional()
});
const claudeSchema = tokenSchema.extend({
  model: z.string().min(1),
  main: z.boolean().optional()
});
const connectorSchema = z.object({ id: z.string().min(1) });

export async function startEngineServer(
  options: EngineServerOptions = {}
): Promise<EngineServer> {
  const logger = getLogger("engine.server");
  const socketPath = resolveEngineSocketPath(options.socketPath);
  const authPath = DEFAULT_AUTH_PATH;

  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  await fs.rm(socketPath, { force: true });

  const app = fastify({ logger: false });

  app.post("/v1/engine/auth/telegram", async (request, reply) => {
    const payload = parseBody(tokenSchema, request.body, reply);
    if (!payload) {
      return;
    }
    const updated = await updateAuthFile(authPath, (auth) =>
      applyTelegramAuthUpdate(auth, payload.token)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.delete("/v1/engine/auth/telegram", async (_request, reply) => {
    const updated = await updateAuthFile(authPath, (auth) =>
      removeTelegramAuth(auth)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/auth/codex", async (request, reply) => {
    const payload = parseBody(codexSchema, request.body, reply);
    if (!payload) {
      return;
    }
    const updated = await updateAuthFile(authPath, (auth) =>
      applyCodexAuthUpdate(auth, payload)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.delete("/v1/engine/auth/codex", async (_request, reply) => {
    const updated = await updateAuthFile(authPath, (auth) =>
      removeCodexAuth(auth)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/auth/claude-code", async (request, reply) => {
    const payload = parseBody(claudeSchema, request.body, reply);
    if (!payload) {
      return;
    }
    const updated = await updateAuthFile(authPath, (auth) =>
      applyClaudeCodeAuthUpdate(auth, payload)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.delete("/v1/engine/auth/claude-code", async (_request, reply) => {
    const updated = await updateAuthFile(authPath, (auth) =>
      removeClaudeCodeAuth(auth)
    );
    await options.onAuthUpdated?.(updated);
    return reply.send({ ok: true });
  });

  app.post("/v1/engine/connectors/load", async (request, reply) => {
    const payload = parseBody(connectorSchema, request.body, reply);
    if (!payload) {
      return;
    }
    if (!options.onConnectorLoad) {
      return reply.status(400).send({ error: "Connector load unsupported" });
    }
    return respondConnectorAction(
      reply,
      await options.onConnectorLoad(payload.id)
    );
  });

  app.post("/v1/engine/connectors/unload", async (request, reply) => {
    const payload = parseBody(connectorSchema, request.body, reply);
    if (!payload) {
      return;
    }
    if (!options.onConnectorUnload) {
      return reply.status(400).send({ error: "Connector unload unsupported" });
    }
    return respondConnectorAction(
      reply,
      await options.onConnectorUnload(payload.id)
    );
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

function respondConnectorAction(
  reply: FastifyReply,
  result: ConnectorActionResult
) {
  if (result.ok) {
    return reply.send({ ok: true, status: result.status });
  }

  const statusCode = result.status === "unknown" ? 404 : 400;
  return reply.status(statusCode).send({
    error: result.message,
    status: result.status
  });
}
