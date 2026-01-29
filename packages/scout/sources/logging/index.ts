import { createRequire } from "node:module";

import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions
} from "pino";

export type LogFormat = "pretty" | "json";
export type LogDestination = "stdout" | "stderr" | string;

export type LogConfig = {
  level: string;
  format: LogFormat;
  destination: LogDestination;
  redact: string[];
  service: string;
  environment: string;
};

const DEFAULT_REDACT = [
  "token",
  "password",
  "secret",
  "apiKey",
  "*.token",
  "*.password",
  "*.secret",
  "*.apiKey"
];

const VALID_FORMATS = new Set<LogFormat>(["pretty", "json"]);
const require = createRequire(import.meta.url);

let rootLogger: Logger | null = null;

export function initLogging(overrides: Partial<LogConfig> = {}): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const config = resolveLogConfig(overrides);
  rootLogger = buildLogger(config);
  return rootLogger;
}

export function getLogger(scope?: string): Logger {
  const logger = rootLogger ?? initLogging();
  return scope ? logger.child({ scope }) : logger;
}

export function resetLogging(): void {
  rootLogger = null;
}

function resolveLogConfig(overrides: Partial<LogConfig>): LogConfig {
  const level =
    overrides.level ??
    envValue("SCOUT_LOG_LEVEL") ??
    envValue("LOG_LEVEL") ??
    "info";
  const destination =
    overrides.destination ??
    envValue("SCOUT_LOG_DEST") ??
    envValue("LOG_DEST") ??
    (process.stdout.isTTY ? "stderr" : "stdout");
  let format =
    overrides.format ??
    parseFormat(envValue("SCOUT_LOG_FORMAT")) ??
    parseFormat(envValue("LOG_FORMAT")) ??
    (process.stdout.isTTY && process.env.NODE_ENV !== "production"
      ? "pretty"
      : "json");
  const service =
    overrides.service ??
    envValue("SCOUT_LOG_SERVICE") ??
    "scout";
  const environment =
    overrides.environment ??
    envValue("NODE_ENV") ??
    "development";

  if (!isStdDestination(destination)) {
    format = "json";
  }

  const redact =
    overrides.redact ??
    mergeRedactList(DEFAULT_REDACT, envValue("SCOUT_LOG_REDACT"));

  return {
    level,
    format,
    destination,
    redact,
    service,
    environment
  };
}

function buildLogger(config: LogConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: config.service,
      environment: config.environment
    },
    redact:
      config.redact.length > 0
        ? { paths: config.redact, censor: "[REDACTED]" }
        : undefined,
    errorKey: "error",
    serializers: {
      error: pino.stdSerializers.err
    }
  };

  const destination = resolveDestination(config.destination);

  if (config.format === "pretty") {
    const prettyTarget = resolvePrettyTarget();
    if (!prettyTarget) {
      return destination ? pino(options, destination) : pino(options);
    }
    return pino({
      ...options,
      transport: {
        target: prettyTarget,
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname,level,service,environment,scope",
          hideObject: true,
          singleLine: false,
          destination: config.destination === "stderr" ? 2 : 1
        }
      }
    });
  }

  return destination ? pino(options, destination) : pino(options);
}

function resolveDestination(
  destination: LogDestination
): DestinationStream | undefined {
  if (destination === "stdout") {
    return undefined;
  }

  if (destination === "stderr") {
    return pino.destination(2);
  }

  return pino.destination({ dest: destination, mkdir: true, sync: false });
}

function parseFormat(value?: string | null): LogFormat | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase().trim();
  if (VALID_FORMATS.has(normalized as LogFormat)) {
    return normalized as LogFormat;
  }
  return null;
}

function envValue(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mergeRedactList(base: string[], extra: string | null): string[] {
  if (!extra) {
    return [...base];
  }

  const additions = extra
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...base, ...additions])];
}

function isStdDestination(destination: LogDestination): boolean {
  return destination === "stdout" || destination === "stderr";
}

function resolvePrettyTarget(): string | null {
  try {
    return require.resolve("pino-pretty");
  } catch {
    return null;
  }
}
