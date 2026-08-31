/**
 * Central application constants. Keeping them in one place means the
 * frontend, the SQL migrations and the Edge Functions stay consistent.
 */

/** Window (days) used for "in scadenza" filtering and 7-day notifications. */
export const EXPIRY_WINDOW_DAYS = 7;

/**
 * Days that must pass after the expiration date before a product is
 * automatically accounted as economic waste. The daily maintenance Edge
 * Function mirrors this rule server-side (see supabase/functions/mark-expired).
 */
export const WASTE_GRACE_DAYS = 1;

/** Notification reminder lead time (days before expiration). */
export const NOTIFY_LEAD_DAYS = 7;

/** Currency used across the app. */
export const CURRENCY = "EUR";

/** Day the daily notification runs (hours in UTC; 06:00 UTC ≈ 08:00 Roma). */
export const NOTIFY_CRON_TIME = "0 6 * * *";

export const STATUS_LABELS: Record<string, string> = {
  active: "Attivo",
  finished: "Finito",
  expired: "Scaduto",
  wasted: "Sprecato",
};

export const STATUS_EMOJI: Record<string, string> = {
  active: "🟢",
  finished: "⚫",
  expired: "🔴",
  wasted: "💸",
};