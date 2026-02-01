import type { CronField } from "./cronTypes.js";

/**
 * Parses a single cron field (minute, hour, day, month, or weekday).
 *
 * Expects: field string and valid min/max range for that field.
 * Returns: CronField with values set, or null if invalid.
 */
export function cronFieldParse(field: string, min: number, max: number): CronField | null {
  if (field === "*") {
    return { values: new Set(), any: true };
  }

  const values = new Set<number>();

  // Handle step values like */5
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) {
      return null;
    }
    for (let i = min; i <= max; i += step) {
      values.add(i);
    }
    return { values, any: false };
  }

  // Handle comma-separated values
  const parts = field.split(",");
  for (const part of parts) {
    // Handle ranges like 1-5
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        return null;
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      const value = parseInt(part, 10);
      if (isNaN(value) || value < min || value > max) {
        return null;
      }
      values.add(value);
    }
  }

  return { values, any: false };
}
