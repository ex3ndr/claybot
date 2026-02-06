import type { Config } from "@/types";
import { ReadWriteLock } from "../../util/readWriteLock.js";

/**
 * Owns runtime config state and the shared configuration lock.
 * Expects: callers update config through `configSet` during controlled reload flow.
 */
export class ConfigModule {
  private config: Config;
  readonly configurationLock: ReadWriteLock;

  constructor(config: Config) {
    this.config = config;
    this.configurationLock = new ReadWriteLock();
  }

  configGet(): Config {
    return this.config;
  }

  configSet(config: Config): void {
    this.config = config;
  }

  async inReadLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.configurationLock.inReadLock(operation);
  }

  async inWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.configurationLock.inWriteLock(operation);
  }
}
