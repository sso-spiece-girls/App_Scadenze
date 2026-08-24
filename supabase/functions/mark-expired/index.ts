/**
 * mark-expired — daily maintenance cron.
 *
 * Advances product lifecycle states deterministically:
 *
 *   Phase 1  active  -> expired     once the expiration date has passed.
 *   Phase 2  expired -> wasted      once WASTE_GRACE_DAYS (1) have passed
 *                                    beyond the expiration date.
 *
 * The `set_wasted_at` trigger assigns wasted_at = expiration_date, keeping
 * monthly/yearly waste aggregates aligned with when the food went bad.
 *
 * The frontend mirrors the same thresholds (see src/utils/status.ts) so the
 * UI stays consistent even between cron runs.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, helsinkiDate } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Must match WASTE_GRACE_DAYS in src/lib/constants.ts.
const WASTE_GRACE_DAYS = 1;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = helsinkiDate();
  const graceDate = helsinkiDate(-(WASTE_GRACE_DAYS + 1)); // strictly beyond the grace day

  try {
    // Phase 1: physical — the expiration date has passed.
    const phase1 = await supabase
      .from("products")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expiration_date", today);

    // Phase 2: economic — the grace period after expiration is over.
    const phase2 = await supabase
      .from("products")
      .update({ status: "wasted" })
      .eq("status", "expired")
      .lt("expiration_date", graceDate);

    if (phase1.error) throw phase1.error;
    if (phase2.error) throw phase2.error;

    return json({
      ok: true,
      date: today,
      marked_expired: phase1.data,
      marked_wasted: phase2.data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "errore sconosciuto";
    return json({ ok: false, error: message }, 500);
  }
});