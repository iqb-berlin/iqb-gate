export const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day without a time, as `?to=2026-10-08` gives it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const read = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** The start of a period of the audit log: the moment given, or the start of the day (UTC). */
export function periodStart(value?: string): Date | undefined {
  return read(value);
}

/**
 * The end of a period of the audit log, included. A day without a time counts to its end (UTC):
 * whoever asks "up to the 8th" expects the 8th itself. A moment with a time is taken as it is.
 */
export function periodEnd(value?: string): Date | undefined {
  const date = read(value);
  if (!date || !DATE_ONLY.test(value as string)) return date;
  return new Date(date.getTime() + DAY_MS - 1);
}
