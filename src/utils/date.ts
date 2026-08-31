/**
 * Date helpers. All "expiration dates" are stored as `YYYY-MM-DD` strings and
 * interpreted as LOCAL calendar dates. Day arithmetic is done on UTC-rounded
 * timestamps so DST transitions never shift a date by one day.
 */

export const DAY_MS = 86_400_000;

/** Returns the local calendar date for `d`, e.g. "2026-08-23". */
export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parses "YYYY-MM-DD" as a LOCAL date at midnight. */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local "today" at midnight. */
export function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Adds `days` to a date, preserving the local calendar day. */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Absolute UTC-based timestamp for a local calendar date (DST-safe). */
export function utcStamp(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

/** Whole days between `a` and `b` (positive when `b` is after `a`). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (utcStamp(b.getFullYear(), b.getMonth() + 1, b.getDate()) -
      utcStamp(a.getFullYear(), a.getMonth() + 1, a.getDate())) /
      DAY_MS,
  );
}

/** Whole days between two date-only strings ("YYYY-MM-DD"). */
export function daysBetweenDates(from: string, to: string): number {
  return daysBetween(parseDateOnly(from), parseDateOnly(to));
}

/** Days from today until `expirationDate` (negative when already past).
 *  Null (unknown expiry) yields +Infinity: never "expiring". */
export function daysUntil(expirationDate: string | null, from = todayLocal()): number {
  if (!expirationDate) return Number.POSITIVE_INFINITY;
  return daysBetween(from, parseDateOnly(expirationDate));
}

/** True when `expirationDate` falls within the next `windowDays` days (inclusive). */
export function isWithinWindow(expirationDate: string | null, windowDays: number, from = todayLocal()): boolean {
  if (!expirationDate) return false;
  const d = daysUntil(expirationDate, from);
  return d >= 0 && d <= windowDays;
}

/** True when the date is strictly in the past. Null → false. */
export function isPastDate(dateOnly: string | null, from = todayLocal()): boolean {
  if (!dateOnly) return false;
  return daysUntil(dateOnly, from) < 0;
}

// Intl.DateTimeFormat construction is expensive: cache formatters per style.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const longDateFormatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

function formatterFor(style: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(style);
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("it-IT", style);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Human friendly date in Italian, e.g. "sab 30 ago". Null → "—". */
export function formatDate(dateOnly: string | null, style: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!dateOnly) return "—";
  return formatterFor(style).format(parseDateOnly(dateOnly));
}

/** Full Italian date, e.g. "30 agosto 2026". Null → "—". */
export function formatDateLong(dateOnly: string | null): string {
  if (!dateOnly) return "—";
  return longDateFormatter.format(parseDateOnly(dateOnly));
}

/** Relative label used in product cards. */
export function expiryLabel(days: number): string {
  if (days < 0) return `Scaduto da ${Math.abs(days)} g`;
  if (days === 0) return "Scade oggi";
  if (days === 1) return "Scade domani";
  return `Scade tra ${days} giorni`;
}

/** ISO timestamp now (used when saving records). */
export function isoNow(): string {
  return new Date().toISOString();
}