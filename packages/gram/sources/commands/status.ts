import http from "node:http";

import { resolveEngineSocketPath } from "../engine/ipc/socket.js";

export async function statusCommand(): Promise<void> {
  intro("gram status");
  try {
    const status = await fetchStatus();
    console.log(JSON.stringify(status, null, 2));
    outro("Done.");
  } catch (error) {
    outro(`Engine not running: ${(error as Error).message}`);
  }
}

async function fetchStatus(): Promise<unknown> {
  const socketPath = resolveEngineSocketPath();
  const response = await requestSocket(socketPath, "/v1/engine/status");
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body);
  }
  return JSON.parse(response.body) as unknown;
}

type SocketResponse = {
  statusCode: number;
  body: string;
};

function requestSocket(socketPath: string, path: string): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method: "GET"
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

    request.end();
  });
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
