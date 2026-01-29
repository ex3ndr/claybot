import http from "node:http";
import { promises as fs } from "node:fs";

import { DEFAULT_AUTH_PATH, updateAuthFile } from "../auth.js";
import {
  applyClaudeCodeAuthUpdate,
  applyCodexAuthUpdate,
  applyTelegramAuthUpdate,
  removeClaudeCodeAuth as stripClaudeCodeAuth,
  removeCodexAuth as stripCodexAuth,
  removeTelegramAuth as stripTelegramAuth,
  type ClaudeCodeAuthUpdate,
  type CodexAuthUpdate
} from "./auth.js";
import {
  resolveEngineSocketPath,
  resolveRemoteEngineUrl
} from "./socket.js";

export type EngineWriteResult = {
  mode: "file" | "socket";
};

export type EngineClientOptions = {
  socketPath?: string;
  remoteUrl?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 1500;

export async function saveTelegramAuth(
  token: string,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/telegram",
    method: "POST",
    payload: { token },
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        applyTelegramAuthUpdate(auth, token)
      );
    }
  });
}

export async function removeTelegramAuth(
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/telegram",
    method: "DELETE",
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        stripTelegramAuth(auth)
      );
    }
  });
}

export async function saveCodexAuth(
  update: CodexAuthUpdate,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/codex",
    method: "POST",
    payload: update,
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        applyCodexAuthUpdate(auth, update)
      );
    }
  });
}

export async function removeCodexAuth(
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/codex",
    method: "DELETE",
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        stripCodexAuth(auth)
      );
    }
  });
}

export async function saveClaudeCodeAuth(
  update: ClaudeCodeAuthUpdate,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/claude-code",
    method: "POST",
    payload: update,
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        applyClaudeCodeAuthUpdate(auth, update)
      );
    }
  });
}

export async function removeClaudeCodeAuth(
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/auth/claude-code",
    method: "DELETE",
    applyLocal: async () => {
      await updateAuthFile(DEFAULT_AUTH_PATH, (auth) =>
        stripClaudeCodeAuth(auth)
      );
    }
  });
}

export async function loadConnector(
  id: string,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/connectors/load",
    method: "POST",
    payload: { id },
    applyLocal: async () => {
      throw new Error("Connector load requires a running engine");
    }
  });
}

export async function unloadConnector(
  id: string,
  options: EngineClientOptions = {}
): Promise<EngineWriteResult> {
  return writeEngineMutation({
    options,
    endpoint: "/v1/engine/connectors/unload",
    method: "POST",
    payload: { id },
    applyLocal: async () => {
      throw new Error("Connector unload requires a running engine");
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
    const request = http.request(
      {
        socketPath,
        path: endpoint,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
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
