/**
 * Access control — the ONLY emails allowed to use this app.
 *
 * This is the frontend source of truth. The same list is enforced
 * server-side by `supabase/migrations/0002_allowlist.sql` (new signups for
 * any other email are rejected by the database) and by the App gate
 * (any session whose email is not allowed is signed out).
 *
 * The list can be overridden at build time via `VITE_ALLOWED_EMAILS`
 * (comma-separated); when unset, the default below applies.
 */

const ENV_ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_EMAILS: readonly string[] =
  ENV_ALLOWED_EMAILS.length > 0
    ? ENV_ALLOWED_EMAILS
    : ["naldilisa568@gmail.com", "naldilisa93@gmail.com"];

/** True when the email may use the app (case-insensitive, trimmed). */
export function isAllowedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}