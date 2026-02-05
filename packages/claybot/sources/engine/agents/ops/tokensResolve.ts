import type { AssistantMessage, Context } from "@mariozechner/pi-ai";

const SYMBOLS_PER_TOKEN = 4;
const IMAGE_SYMBOLS_ESTIMATE = 512;
const IMAGE_DATA_PLACEHOLDER = "<image>";

type TokenDelta = {
  size: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  source: "usage" | "estimate";
};

/**
 * Resolves token usage from inference output, falling back to estimates when missing.
 * Expects: context is the request context prior to appending the assistant message.
 */
export function tokensResolve(
  context: Context,
  message: AssistantMessage
): TokenDelta {
  const usage = resolveUsageDelta(message);
  if (usage) {
    return usage;
  }

  const input = symbolsToTokens(estimateContextSymbols(context));
  const output = symbolsToTokens(estimateMessageSymbols(message));
  const total = input + output;
  return {
    size: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      total
    },
    source: "estimate"
  };
}

function resolveUsageDelta(message: AssistantMessage): TokenDelta | null {
  const usage = message.usage;
  if (!usage) {
    return null;
  }
  const input = normalizeTokenValue(usage.input);
  const output = normalizeTokenValue(usage.output);
  const cacheRead = normalizeTokenValue(usage.cacheRead);
  const cacheWrite = normalizeTokenValue(usage.cacheWrite);
  const total = normalizeTokenValue(usage.totalTokens);
  if (input <= 0 && output <= 0 && cacheRead <= 0 && cacheWrite <= 0 && total <= 0) {
    return null;
  }
  const resolvedTotal = total > 0 ? total : input + output + cacheRead + cacheWrite;
  return {
    size: {
      input,
      output,
      cacheRead,
      cacheWrite,
      total: resolvedTotal
    },
    source: "usage"
  };
}

function estimateContextSymbols(context: Context): number {
  const messages = context.messages ?? [];
  const messageSymbols = messages.reduce(
    (total, message) => total + estimateMessageSymbols(message),
    0
  );
  const systemPromptSymbols = context.systemPrompt ? context.systemPrompt.length : 0;
  return messageSymbols + systemPromptSymbols;
}

function estimateMessageSymbols(message: Context["messages"][number]): number {
  return estimateContentSymbols(message.content);
}

function estimateContentSymbols(content: unknown): number {
  if (typeof content === "string") {
    return content.length;
  }
  if (Array.isArray(content)) {
    return content.reduce((total, item) => total + estimateContentItemSymbols(item), 0);
  }
  return safeStringLength(content);
}

function estimateContentItemSymbols(item: unknown): number {
  if (item && typeof item === "object") {
    if (isImageLike(item)) {
      return IMAGE_SYMBOLS_ESTIMATE;
    }
    const maybeText = item as { type?: string; text?: unknown };
    if (maybeText.type === "text" && typeof maybeText.text === "string") {
      return maybeText.text.length;
    }
  }
  return safeStringLength(item);
}

function safeStringLength(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }
  try {
    const encoded = JSON.stringify(sanitizeImageData(value, 0, new WeakSet()));
    return encoded ? encoded.length : 0;
  } catch {
    return 0;
  }
}

function sanitizeImageData(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return null;
  }
  if (depth > 6) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeImageData(entry, depth + 1, seen));
  }
  if (isImageLike(value)) {
    const image = value as Record<string, unknown>;
    return { ...image, data: IMAGE_DATA_PLACEHOLDER };
  }
  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    sanitized[key] = sanitizeImageData(entry, depth + 1, seen);
  }
  return sanitized;
}

function isImageLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { type?: unknown; data?: unknown; mimeType?: unknown };
  if (record.type === "image" && typeof record.data === "string") {
    return true;
  }
  return (
    typeof record.mimeType === "string" &&
    record.mimeType.startsWith("image/") &&
    typeof record.data === "string"
  );
}

function symbolsToTokens(symbols: number): number {
  if (symbols <= 0) {
    return 0;
  }
  return Math.ceil(symbols / SYMBOLS_PER_TOKEN);
}

function normalizeTokenValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}
