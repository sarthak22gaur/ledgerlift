import { format, subMonths, startOfMonth } from "date-fns";

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // "YYYY-MM" alone is parsed as UTC midnight by `new Date()` and then shifts
  // backward when rendered in a negative-UTC-offset timezone (e.g. Pacific),
  // displaying as the prior month. Parse explicitly in local time.
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(value);
  if (ymMatch) {
    return new Date(Number(ymMatch[1]), Number(ymMatch[2]) - 1, 1);
  }
  // "YYYY-MM-DD" — same trap. Parse as local-midnight.
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymdMatch) {
    return new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]));
  }
  return new Date(value);
}

/**
 * Format as "Jan 15, 2025"
 */
export function formatDate(date: string | Date): string {
  return format(toDate(date), "MMM d, yyyy");
}

/**
 * Format as "Jan 2025"
 */
export function formatMonth(date: string | Date): string {
  return format(toDate(date), "MMM yyyy");
}

/**
 * Format a date range: "Jan 15, 2025 - Feb 15, 2025"
 */
export function formatDateRange(
  start: string | Date,
  end: string | Date
): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

/**
 * Returns the default date range: last 12 months from today.
 * Dates are formatted as ISO date strings (YYYY-MM-DD).
 */
export function getDefaultDateRange(): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const start = startOfMonth(subMonths(now, 12));
  return {
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(now, "yyyy-MM-dd"),
  };
}
