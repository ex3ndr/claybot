/**
 * Normalizes environment variable input into a string map.
 * Accepts plain objects with string/number/boolean values; trims keys and drops blanks.
 * Expects: value is a record-like object without nested structures.
 */
export function envNormalize(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || isBlockedKey(trimmedKey)) {
      continue;
    }
    if (!isEnvValue(entry)) {
      continue;
    }
    normalized[trimmedKey] = String(entry);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isEnvValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isBlockedKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
