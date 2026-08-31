-- ============================================================================
-- 0006_decontamination.sql — Remove the S-Kaupat (Finnish) price source
--
-- The app targets UNICOOP FIRENZE / COOP.FI (Italy). The previous price
-- lookup fetched prices from S-Kaupat (Finnish S-Group) via the coop-price
-- edge function — that source is wrong for Coop.fi and has been removed:
--
--   * drops the `price_cache` table (it only ever held S-Kaupat prices and
--     the cached S-Kaupat store id);
--   * moves the database timezone from Europe/Helsinki to Europe/Rome (the
--     "today" logic used by the cron functions must match the store's timezone).
--
-- Historical `products.price_source` values equal to 's-kaupat' are left in
-- place (read-only legacy): the check constraint keeps accepting them, but no
-- new row will ever use it.
-- ============================================================================

drop table if exists public.price_cache;

alter database postgres set timezone to 'Europe/Rome';