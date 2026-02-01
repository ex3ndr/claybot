import type { CronField } from "./cronTypes.js";

/**
 * Checks if a value matches a cron field.
 *
 * Expects: a parsed CronField and a numeric value.
 * Returns: true if the value matches (field is "any" or value is in the set).
 */
export function cronFieldMatch(field: CronField, value: number): boolean {
  return field.any || field.values.has(value);
}
