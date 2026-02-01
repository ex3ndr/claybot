import { cronExpressionParse } from "./cronExpressionParse.js";
import { cronFieldMatch } from "./cronFieldMatch.js";

/**
 * Calculates the next time a cron expression should run.
 *
 * Expects: a valid cron expression string and optional start date.
 * Returns: the next matching Date, or null if invalid/no match within 2 years.
 */
export function cronTimeGetNext(expression: string, from?: Date): Date | null {
  const parsed = cronExpressionParse(expression);
  if (!parsed) {
    return null;
  }

  const start = from ?? new Date();
  const candidate = new Date(start);

  // Start from next minute
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search for next matching time (max 2 years to prevent infinite loop)
  const maxIterations = 365 * 24 * 60 * 2;

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1; // 1-12
    const day = candidate.getDate();
    const weekday = candidate.getDay(); // 0-6
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (
      cronFieldMatch(parsed.month, month) &&
      cronFieldMatch(parsed.day, day) &&
      cronFieldMatch(parsed.weekday, weekday) &&
      cronFieldMatch(parsed.hour, hour) &&
      cronFieldMatch(parsed.minute, minute)
    ) {
      return candidate;
    }

    // Advance by one minute
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}
