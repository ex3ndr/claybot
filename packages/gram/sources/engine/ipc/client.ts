import http from "node:http";

import { resolveEngineSocketPath } from "./socket.js";

export type SocketResponse = {
  statusCode: number;
  body: string;
};

export type SocketRequestOptions = {
  socketPath: string;
  path: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
};

export function requestSocket(options: SocketRequestOptions): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: options.socketPath,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers
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

    request.on("error", (error) => {
      reject(error);
    });

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

type LoadPluginOptions = {
  pluginId?: string;
  instanceId?: string;
  settings?: Record<string, unknown>;
};

export async function setAuth(id: string, key: string, value: string): Promise<void> {
  const socketPath = resolveEngineSocketPath();
  const response = await requestSocket({
    socketPath,
    path: "/v1/engine/auth",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, key, value })
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body);
  }
}

export async function loadPlugin(options: LoadPluginOptions): Promise<void> {
  const socketPath = resolveEngineSocketPath();
  const response = await requestSocket({
    socketPath,
    path: "/v1/engine/plugins/load",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body);
  }
}

export async function unloadPlugin(instanceId: string): Promise<void> {
  const socketPath = resolveEngineSocketPath();
  const response = await requestSocket({
    socketPath,
    path: "/v1/engine/plugins/unload",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId })
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body);
  }
}
