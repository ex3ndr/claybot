/**
 * Normalizes timestamp inputs to unix milliseconds.
 * Expects: value is a unix ms number or an ISO string.
 */
export function agentTimestampGet(value?: number | string): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
}
