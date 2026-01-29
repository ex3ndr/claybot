import fs from "node:fs";
import { PassThrough } from "node:stream";

import Docker from "dockerode";

import { getLogger } from "../../log.js";

export type DockerContainerAction =
  | "start"
  | "stop"
  | "restart"
  | "ensure-running";

export type DockerContainerConfig = {
  id?: string;
  name?: string;
  action?: DockerContainerAction;
  stopTimeoutMs?: number;
  timeoutMs?: number;
};

export type DockerConnectionConfig = {
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  ca?: string;
  cert?: string;
  key?: string;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  timeoutMs?: number;
};

export type DockerRuntimeConfig = {
  connection?: DockerConnectionConfig;
  containers?: DockerContainerConfig[];
};

export type DockerRuntimeOptions = {
  connection?: DockerConnectionConfig;
  timeoutMs?: number;
};

export type DockerOneOffMount = {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
};

export type DockerOneOffOptions = {
  image: string;
  command: string[];
  workingDir?: string;
  env?: Record<string, string>;
  mounts?: DockerOneOffMount[];
  timeoutMs?: number;
  network?: string;
};

export type DockerOneOffResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type DockerOptions = ConstructorParameters<typeof Docker>[0];

const DEFAULT_PING_TIMEOUT_MS = 5000;
const DEFAULT_ACTION_TIMEOUT_MS = 15000;

export class DockerRuntime {
  private docker: Docker;
  private logger = getLogger("runtime.docker");
  private pingTimeoutMs: number;

  constructor(options: DockerRuntimeOptions = {}) {
    const connection = options.connection ?? {};
    this.pingTimeoutMs = connection.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
    this.docker = new Docker(resolveDockerOptions(connection));
  }

  async ensureConnected(): Promise<void> {
    await withTimeout(
      this.docker.ping(),
      this.pingTimeoutMs,
      "docker ping"
    );
  }

  async applyContainers(
    containers: DockerContainerConfig[]
  ): Promise<void> {
    for (const container of containers) {
      await this.applyContainer(container);
    }
  }

  async runOneOff(options: DockerOneOffOptions): Promise<DockerOneOffResult> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    const env = options.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;
    const binds = (options.mounts ?? []).map((mount) => {
      const mode = mount.readOnly ? "ro" : "rw";
      return `${mount.hostPath}:${mount.containerPath}:${mode}`;
    });

    const createOptions = {
      Env: env,
      WorkingDir: options.workingDir,
      HostConfig: {
        AutoRemove: true,
        Binds: binds,
        NetworkMode: options.network
      }
    };

    const result = await withTimeout(
      new Promise<{ data: { StatusCode?: number } }>((resolve, reject) => {
        this.docker.run(
          options.image,
          options.command,
          [stdout, stderr],
          createOptions as never,
          (error, data) => {
            if (error) {
              reject(error);
              return;
            }
            resolve({ data: data ?? {} });
          }
        );
      }),
      options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      "docker run"
    );

    return {
      exitCode: result.data.StatusCode ?? null,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8")
    };
  }

  private async applyContainer(
    config: DockerContainerConfig
  ): Promise<void> {
    const identifier = resolveContainerIdentifier(config);
    const label = config.name ?? config.id ?? identifier;
    const action = config.action ?? "ensure-running";
    const timeoutMs = config.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    const container = this.docker.getContainer(identifier);

    try {
      switch (action) {
        case "start":
          await withTimeout(container.start(), timeoutMs, "docker start");
          this.logger.info({ container: label }, "Docker container started");
          break;
        case "stop":
          await withTimeout(
            container.stop(resolveStopOptions(config.stopTimeoutMs)),
            timeoutMs,
            "docker stop"
          );
          this.logger.info({ container: label }, "Docker container stopped");
          break;
        case "restart":
          await withTimeout(
            container.restart(resolveStopOptions(config.stopTimeoutMs)),
            timeoutMs,
            "docker restart"
          );
          this.logger.info({ container: label }, "Docker container restarted");
          break;
        case "ensure-running": {
          const info = await withTimeout(
            container.inspect() as Promise<Docker.ContainerInspectInfo>,
            timeoutMs,
            "docker inspect"
          );
          if (info.State?.Running) {
            this.logger.info(
              { container: label },
              "Docker container already running"
            );
            break;
          }
          await withTimeout(container.start(), timeoutMs, "docker start");
          this.logger.info({ container: label }, "Docker container started");
          break;
        }
        default:
          this.logger.warn(
            { container: label, action },
            "Unsupported container action"
          );
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        this.logger.warn(
          { container: label },
          "Docker container not found"
        );
        return;
      }
      this.logger.warn(
        { container: label, action, error },
        "Docker container action failed"
      );
    }
  }
}

function resolveContainerIdentifier(config: DockerContainerConfig): string {
  const identifier = config.id ?? config.name;
  if (!identifier) {
    throw new Error("Docker container config requires id or name");
  }
  return identifier;
}

function resolveStopOptions(
  stopTimeoutMs?: number
): { t?: number } {
  if (!stopTimeoutMs) {
    return {};
  }
  return {
    t: Math.max(0, Math.ceil(stopTimeoutMs / 1000))
  };
}

function resolveDockerOptions(
  connection: DockerConnectionConfig
): DockerOptions {
  const socketPath = connection.socketPath ?? parseDockerSocketEnv();
  if (socketPath) {
    return { socketPath };
  }

  const dockerHost = connection.host ?? parseDockerHostEnv();
  const dockerPort = connection.port ?? parseDockerPortEnv();
  const dockerProtocol = connection.protocol ?? parseDockerProtocolEnv();

  if (dockerHost) {
    return {
      host: dockerHost,
      port: dockerPort ?? 2375,
      protocol: dockerProtocol ?? "http",
      ca: resolveDockerSecret(connection.ca, connection.caPath),
      cert: resolveDockerSecret(connection.cert, connection.certPath),
      key: resolveDockerSecret(connection.key, connection.keyPath)
    };
  }

  return {
    socketPath: "/var/run/docker.sock"
  };
}

function resolveDockerSecret(
  inline?: string,
  filePath?: string
): string | undefined {
  if (inline) {
    return inline;
  }
  if (!filePath) {
    return undefined;
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function parseDockerHostEnv(): string | undefined {
  const host = process.env.DOCKER_HOST;
  if (!host) {
    return undefined;
  }
  if (host.startsWith("unix://")) {
    return undefined;
  }
  if (host.startsWith("tcp://")) {
    const url = new URL(host.replace("tcp://", "http://"));
    return url.hostname;
  }
  if (host.startsWith("http://") || host.startsWith("https://")) {
    const url = new URL(host);
    return url.hostname;
  }
  return undefined;
}

function parseDockerSocketEnv(): string | undefined {
  const host = process.env.DOCKER_HOST;
  if (!host) {
    return undefined;
  }
  if (host.startsWith("unix://")) {
    return host.replace("unix://", "");
  }
  return undefined;
}

function parseDockerPortEnv(): number | undefined {
  const host = process.env.DOCKER_HOST;
  if (!host) {
    return undefined;
  }
  if (host.startsWith("tcp://")) {
    const url = new URL(host.replace("tcp://", "http://"));
    return url.port ? Number(url.port) : undefined;
  }
  if (host.startsWith("http://") || host.startsWith("https://")) {
    const url = new URL(host);
    return url.port ? Number(url.port) : undefined;
  }
  return undefined;
}

function parseDockerProtocolEnv(): "http" | "https" | undefined {
  const host = process.env.DOCKER_HOST;
  if (!host) {
    return undefined;
  }
  if (host.startsWith("https://")) {
    return "https";
  }
  if (host.startsWith("http://") || host.startsWith("tcp://")) {
    return "http";
  }
  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybe = error as {
    statusCode?: number;
    reason?: string;
    message?: string;
  };
  if (maybe.statusCode === 404) {
    return true;
  }
  const message = `${maybe.reason ?? ""} ${maybe.message ?? ""}`.toLowerCase();
  return message.includes("no such container") || message.includes("not found");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
