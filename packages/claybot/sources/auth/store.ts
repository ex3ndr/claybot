import { promises as fs } from "node:fs";
import path from "node:path";

import type { Config } from "@/types";

export type AuthEntry = {
  type?: "apiKey" | "oauth" | "token";
  apiKey?: string;
  token?: string;
  [key: string]: unknown;
};

export type AuthConfig = Record<string, AuthEntry>;

export class AuthStore {
  private filePath: string;

  constructor(config: Config) {
    this.filePath = config.authPath;
  }

  async read(): Promise<AuthConfig> {
    const resolvedPath = path.resolve(this.filePath);
    try {
      const raw = await fs.readFile(resolvedPath, "utf8");
      const parsed = JSON.parse(raw) as AuthConfig;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async write(config: AuthConfig): Promise<void> {
    const resolvedPath = path.resolve(this.filePath);
    const dir = path.dirname(resolvedPath);
    if (dir && dir !== ".") {
      await fs.mkdir(dir, { recursive: true });
    }
    const payload = `${JSON.stringify(config, null, 2)}\n`;
    await fs.writeFile(resolvedPath, payload, { mode: 0o600 });
  }

  async getEntry(id: string): Promise<AuthEntry | null> {
    const config = await this.read();
    return config[id] ?? null;
  }

  async setEntry(id: string, entry: AuthEntry): Promise<void> {
    const config = await this.read();
    config[id] = entry;
    await this.write(config);
  }

  async remove(id: string): Promise<void> {
    const config = await this.read();
    if (!config[id]) {
      return;
    }
    delete config[id];
    await this.write(config);
  }

  async getApiKey(id: string): Promise<string | null> {
    const entry = await this.getEntry(id);
    return entry?.apiKey ?? null;
  }

  async setApiKey(id: string, apiKey: string): Promise<void> {
    await this.setEntry(id, { type: "apiKey", apiKey });
  }

  async getToken(id: string): Promise<string | null> {
    const entry = await this.getEntry(id);
    return entry?.token ?? null;
  }

  async setToken(id: string, token: string): Promise<void> {
    await this.setEntry(id, { type: "token", token });
  }

  async getOAuth(id: string): Promise<AuthEntry | null> {
    const entry = await this.getEntry(id);
    if (!entry || entry.type !== "oauth") {
      return null;
    }
    return entry;
  }

  async setOAuth(id: string, credentials: AuthEntry): Promise<void> {
    await this.setEntry(id, { type: "oauth", ...credentials });
  }

  async setField(id: string, key: string, value: string): Promise<void> {
    const config = await this.read();
    const entry = config[id] ?? {};
    entry[key] = value;
    config[id] = entry;
    await this.write(config);
  }
}
