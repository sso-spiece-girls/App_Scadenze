/** Money formatting and parsing helpers (Euro). */

/** Formats a number as EUR, e.g. 12.73 → "€12,73". */
export function formatEuro(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

/** Formats a plain number with 2 decimals, e.g. 12.73 → "12,73". */
export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Parses "12,73" or "12.73" or "1.299,90" into a number (returns null if invalid). */
export function parseEuro(input: string): number | null {
  const cleaned = input.trim().replace(/€/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // Italian: 1.234,56 ; English: 1234.56
  const m = cleaned.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/);
  if (!m) return null;
  const intPart = m[1].replace(/\./g, "");
  const decPart = m[2] ?? "";
  const value = Number(`${intPart}.${decPart}`);
  return Number.isFinite(value) ? value : null;
}

/** Clamps to a safe money value with 2 decimals. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}