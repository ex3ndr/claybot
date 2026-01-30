import http from "node:http";
import { promises as fs } from "node:fs";

import {
  DEFAULT_SETTINGS_PATH,
  listPlugins,
  updateSettingsFile,
  upsertPlugin
} from "../settings.js";
import { DEFAULT_SECRETS_PATH, SecretsStore } from "../secrets/store.js";
import { resolveEngineSocketPath, resolveRemoteEngineUrl } from "./socket.js";

export type EngineWriteResult = {
  mode: "file" | "socket";
};

export type EngineClientOptions = {
  socketPath?: string;
  remoteUrl?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 1500;

export type PluginInstallPayload = {
  pluginId: string;
  instanceId?: string;
  settings?: Record<string, unknown>;
};

export async function loadPlugin(
  payload: PluginInstallPayload,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  const instanceId = payload.instanceId ?? payload.pluginId;
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/plugins/load",
    method: "POST",
    payload: { ...payload, instanceId },
    applyLocal: async () => {
      await updateSettingsFile(DEFAULT_SETTINGS_PATH, (settings) => {
        const existing = listPlugins(settings).find(
          (plugin) => plugin.instanceId === instanceId
        );
        return {
          ...settings,
          plugins: upsertPlugin(settings.plugins, {
            instanceId,
            pluginId: payload.pluginId,
            enabled: true,
            settings: payload.settings ?? existing?.settings
          })
        };
      });
    }
  });
}

export async function unloadPlugin(
  instanceId: string,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/plugins/unload",
    method: "POST",
    payload: { instanceId },
    applyLocal: async () => {
      await updateSettingsFile(DEFAULT_SETTINGS_PATH, (settings) => {
        const existing = listPlugins(settings).find(
          (plugin) => plugin.instanceId === instanceId
        );
        if (!existing) {
          return settings;
        }
        return {
          ...settings,
          plugins: upsertPlugin(settings.plugins, { ...existing, enabled: false })
        };
      });
    }
  });
}

export async function setSecret(
  pluginId: string,
  key: string,
  value: string,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/secrets",
    method: "POST",
    payload: { pluginId, key, value },
    applyLocal: async () => {
      const store = new SecretsStore(DEFAULT_SECRETS_PATH);
      await store.set(pluginId, key, value);
    }
  });
}

type WriteEngineArgs<TPayload> = {
  endpoint: string;
  method: "POST" | "DELETE";
  payload?: TPayload;
  applyLocal: () => Promise<void>;
  options: EngineClientOptions;
};

async function writeEngineMutation<TPayload>(
  args: WriteEngineArgs<TPayload>
): Promise<EngineWriteResult> {
  const remoteUrl = resolveRemoteEngineUrl(args.options.remoteUrl);
  if (remoteUrl) {
    throw new Error("Remote engine updates are not implemented yet.");
  }

  const socketPath = resolveEngineSocketPath(args.options.socketPath);
  const timeoutMs = args.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const socketResult = await trySocketRequest(
    socketPath,
    args.endpoint,
    args.method,
    args.payload,
    timeoutMs
  );

  if (socketResult.mode === "socket") {
    return socketResult;
  }

  if (socketResult.mode === "not-running") {
    await args.applyLocal();
    return { mode: "file" };
  }

  throw new Error(socketResult.message);
}

type SocketRequestResult =
  | { mode: "socket" }
  | { mode: "not-running" }
  | { mode: "error"; message: string };

async function trySocketRequest<TPayload>(
  socketPath: string,
  endpoint: string,
  method: "POST" | "DELETE",
  payload: TPayload | undefined,
  timeoutMs: number
): Promise<SocketRequestResult> {
  try {
    await fs.stat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mode: "not-running" };
    }
    return {
      mode: "error",
      message: `Unable to check socket at ${socketPath}`
    };
  }

  try {
    const response = await requestSocket(
      socketPath,
      endpoint,
      method,
      payload,
      timeoutMs
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { mode: "socket" };
    }
    return {
      mode: "error",
      message: `Engine update failed with ${response.statusCode}: ${response.body}`
    };
  } catch (error) {
    if (isSocketNotRunning(error)) {
      return { mode: "not-running" };
    }
    return {
      mode: "error",
      message: `Engine update failed: ${(error as Error).message}`
    };
  }
}

type SocketResponse = {
  statusCode: number;
  body: string;
};

function requestSocket<TPayload>(
  socketPath: string,
  endpoint: string,
  method: "POST" | "DELETE",
  payload: TPayload | undefined,
  timeoutMs: number
): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : "";
    const headers: Record<string, number | string> = {};
    if (body) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(body);
    }

    const request = http.request(
      {
        socketPath,
        path: endpoint,
        method,
        headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("socket request timeout"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function isSocketNotRunning(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOENT" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE" ||
    code === "ECONNRESET"
  );
}
