import type { ParsedCron } from "./cronTypes.js";
import { cronFieldParse } from "./cronFieldParse.js";

/**
 * Parses a 5-field cron expression into its components.
 *
 * Expects: cron expression string with format "minute hour day month weekday".
 * Returns: ParsedCron object or null if the expression is invalid.
 */
export function cronExpressionParse(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  const minute = cronFieldParse(minuteStr!, 0, 59);
  const hour = cronFieldParse(hourStr!, 0, 23);
  const day = cronFieldParse(dayStr!, 1, 31);
  const month = cronFieldParse(monthStr!, 1, 12);
  const weekday = cronFieldParse(weekdayStr!, 0, 6);

  if (!minute || !hour || !day || !month || !weekday) {
    return null;
  }

  return { minute, hour, day, month, weekday };
}
