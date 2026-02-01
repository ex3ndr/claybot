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
const nodeRequire = createRequire(import.meta.url);

let rootLogger: Logger | null = null;

const MODULE_WIDTH = 20;
const PLUGIN_MODULE_PREFIX = "plugin.";

export function initLogging(overrides: Partial<LogConfig> = {}): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const config = resolveLogConfig(overrides);
  rootLogger = buildLogger(config);
  return rootLogger;
}

export function getLogger(moduleName?: string): Logger {
  const logger = rootLogger ?? initLogging();
  const resolvedModule = normalizeModule(moduleName);
  return logger.child({ module: resolvedModule });
}

export function resetLogging(): void {
  rootLogger = null;
}

function resolveLogConfig(overrides: Partial<LogConfig>): LogConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const level =
    overrides.level ??
    envValue("CLAYBOT_LOG_LEVEL") ??
    envValue("LOG_LEVEL") ??
    (isDev ? "debug" : "info");
  const destination =
    overrides.destination ??
    envValue("CLAYBOT_LOG_DEST") ??
    envValue("LOG_DEST") ??
    (process.stdout.isTTY ? "stderr" : "stdout");
  let format =
    overrides.format ??
    parseFormat(envValue("CLAYBOT_LOG_FORMAT")) ??
    parseFormat(envValue("LOG_FORMAT")) ??
    (process.stdout.isTTY && process.env.NODE_ENV !== "production"
      ? "pretty"
      : "json");
  const service =
    overrides.service ??
    envValue("CLAYBOT_LOG_SERVICE") ??
    "claybot";
  const environment =
    overrides.environment ??
    envValue("NODE_ENV") ??
    "development";

  if (!isStdDestination(destination)) {
    format = "json";
  }

  const redact =
    overrides.redact ??
    mergeRedactList(DEFAULT_REDACT, envValue("CLAYBOT_LOG_REDACT"));

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
    const prettyFactory = resolvePrettyFactory();
    if (!prettyFactory) {
      return destination ? pino(options, destination) : pino(options);
    }
    const prettyStream = prettyFactory({
      colorize: true,
      translateTime: false,
      ignore: "pid,hostname,level,service,environment,module",
      hideObject: true,
      levelKey: "__level",
      timestampKey: "__time",
      messageFormat: formatPrettyMessage,
      singleLine: false,
      destination: config.destination === "stderr" ? 2 : 1
    }) as DestinationStream;
    return pino(options, prettyStream);
  }

  return destination ? pino(options, destination) : pino(options);
}

function formatPrettyMessage(
  log: Record<string, unknown>,
  messageKey: string,
  _levelLabel: string,
  extra?: { colors?: { gray?: (value: string) => string; cyan?: (value: string) => string } }
): string {
  const colors = extra?.colors;
  const gray = colors?.gray ?? (colors as { grey?: (value: string) => string } | undefined)?.grey;
  const colorTime = typeof gray === "function" ? gray : (value: string) => value;
  const level = resolveLogLevel(log);
  const colorMessage =
    level === 40 && typeof colors?.yellow === "function"
      ? colors.yellow
      : typeof colors?.cyan === "function"
        ? colors.cyan
        : (value: string) => value;
  const timeValue = log.time ?? log.timestamp ?? Date.now();
  const time = formatLogTime(timeValue);
  const module = formatModuleLabel(log.module);
  const messageValue = log[messageKey];
  const message =
    messageValue === undefined || messageValue === null
      ? ""
      : String(messageValue);
  const timeLabel = colorTime(`[${time}]`);
  const content = message.length > 0 ? `${module} ${message}` : module;
  return `${timeLabel} ${colorMessage(content)}`;
}

function resolveLogLevel(log: Record<string, unknown>): number | null {
  const candidates = [log.level, (log as Record<string, unknown>).__level, log.lvl];
  for (const raw of candidates) {
    if (typeof raw === "number") {
      return raw;
    }
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      switch (normalized) {
        case "trace":
          return 10;
        case "debug":
          return 20;
        case "info":
          return 30;
        case "warn":
        case "warning":
          return 40;
        case "error":
          return 50;
        case "fatal":
          return 60;
        default: {
          const parsed = Number(normalized);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }
    }
  }
  return null;
}

function normalizeModule(moduleName?: string): string {
  if (typeof moduleName !== "string") {
    return "unknown";
  }
  const trimmed = moduleName.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function formatModuleLabel(moduleValue: unknown): string {
  const rawModule = normalizeModule(
    typeof moduleValue === "string" ? moduleValue : undefined
  );
  const isPlugin = rawModule.startsWith(PLUGIN_MODULE_PREFIX);
  const baseName = isPlugin ? rawModule.slice(PLUGIN_MODULE_PREFIX.length) : rawModule;
  const normalized = normalizeModuleName(baseName);
  return isPlugin ? `(${normalized})` : `[${normalized}]`;
}

function normalizeModuleName(value: string): string {
  const trimmed = value.trim();
  const base = trimmed.length > 0 ? trimmed : "unknown";
  if (base.length === MODULE_WIDTH) {
    return base;
  }
  if (base.length > MODULE_WIDTH) {
    return base.slice(0, MODULE_WIDTH);
  }
  return base.padEnd(MODULE_WIDTH, " ");
}

function formatLogTime(value: unknown): string {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" || typeof value === "string") {
    date = new Date(value);
  } else {
    date = new Date();
  }
  if (Number.isNaN(date.getTime())) {
    date = new Date();
  }
  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(
    date.getSeconds()
  )}`;
}

function padTime(value: number): string {
  return String(value).padStart(2, "0");
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

function resolvePrettyFactory():
  | ((options: Record<string, unknown>) => DestinationStream)
  | null {
  try {
    return nodeRequire("pino-pretty");
  } catch {
    return null;
  }
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
