import pm2 from "pm2";

import { getLogger } from "../../logging/index.js";

export type Pm2ProcessConfig = {
  name: string;
  script: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  interpreter?: string;
  instances?: number | "max";
  watch?: boolean | string[];
  autorestart?: boolean;
  maxRestarts?: number;
  minUptime?: number;
};

export type Pm2RuntimeOptions = {
  connectTimeoutMs?: number;
  disconnectOnExit?: boolean;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export class Pm2Runtime {
  private connected = false;
  private connecting: Promise<void> | null = null;
  private disconnecting = false;
  private logger = getLogger("runtime.pm2");
  private connectTimeoutMs: number;
  private disconnectOnExit: boolean;

  constructor(options: Pm2RuntimeOptions = {}) {
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.disconnectOnExit = options.disconnectOnExit ?? true;

    if (this.disconnectOnExit) {
      this.attachSignalHandlers();
    }
  }

  async startProcesses(processes: Pm2ProcessConfig[]): Promise<void> {
    for (const process of processes) {
      await this.startProcess(process);
    }
  }

  async startProcess(config: Pm2ProcessConfig): Promise<void> {
    await this.ensureConnected();

    const options: pm2.StartOptions = {
      name: config.name,
      script: config.script,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      interpreter: config.interpreter,
      instances: config.instances,
      watch: config.watch,
      autorestart: config.autorestart ?? true,
      max_restarts: config.maxRestarts,
      min_uptime: config.minUptime
    };

    await new Promise<void>((resolve, reject) => {
      pm2.start(options, (error) => {
        if (error) {
          this.logger.warn({ error, process: config.name }, "pm2 start failed");
          reject(error);
          return;
        }
        this.logger.info({ process: config.name }, "pm2 process started");
        resolve();
      });
    });
  }

  async stopProcess(name: string): Promise<void> {
    await this.ensureConnected();
    await new Promise<void>((resolve, reject) => {
      pm2.stop(name, (error) => {
        if (error) {
          this.logger.warn({ error, process: name }, "pm2 stop failed");
          reject(error);
          return;
        }
        this.logger.info({ process: name }, "pm2 process stopped");
        resolve();
      });
    });
  }

  async restartProcess(name: string): Promise<void> {
    await this.ensureConnected();
    await new Promise<void>((resolve, reject) => {
      pm2.restart(name, (error) => {
        if (error) {
          this.logger.warn({ error, process: name }, "pm2 restart failed");
          reject(error);
          return;
        }
        this.logger.info({ process: name }, "pm2 process restarted");
        resolve();
      });
    });
  }

  async deleteProcess(name: string): Promise<void> {
    await this.ensureConnected();
    await new Promise<void>((resolve, reject) => {
      pm2.delete(name, (error) => {
        if (error) {
          this.logger.warn({ error, process: name }, "pm2 delete failed");
          reject(error);
          return;
        }
        this.logger.info({ process: name }, "pm2 process deleted");
        resolve();
      });
    });
  }

  async listProcesses(): Promise<pm2.ProcessDescription[]> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      pm2.list((error, list) => {
        if (error) {
          this.logger.warn({ error }, "pm2 list failed");
          reject(error);
          return;
        }
        resolve(list);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected || this.disconnecting) {
      return;
    }

    this.disconnecting = true;

    await new Promise<void>((resolve) => {
      pm2.disconnect(() => {
        this.connected = false;
        this.disconnecting = false;
        resolve();
      });
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("pm2 connect timeout"));
      }, this.connectTimeoutMs);

      pm2.connect((error) => {
        clearTimeout(timer);
        if (error) {
          this.connecting = null;
          reject(error);
          return;
        }

        this.connected = true;
        this.connecting = null;
        resolve();
      });
    });

    return this.connecting;
  }

  private attachSignalHandlers(): void {
    const handler = () => {
      void this.disconnect();
    };

    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  }
}
