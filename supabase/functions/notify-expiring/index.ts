/**
 * notify-expiring — daily cron that sends Web Push notifications for
 * products expiring within NOTIFY_LEAD_DAYS (7).
 *
 * - Only products with status = 'active' are notified.
 * - Duplicate notifications are avoided via `notification_7_days_sent`.
 * - When several products hit the threshold at the same time a single
 *   summary notification is sent.
 * - Subscriptions that the push service reports as gone (404/410) are
 *   removed.
 * - If a product's expiration date is moved later, the
 *   `reset_notification_flag` trigger re-arms the notification.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders, json, storeDate } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:app@example.com";

// Must match NOTIFY_LEAD_DAYS in src/lib/constants.ts.
const NOTIFY_LEAD_DAYS = 7;

const CONCURRENCY = 5;

interface ProductForNotify {
  id: string;
  user_id: string;
  name: string;
  barcode: string;
  expiration_date: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

function notificationPayload(products: ProductForNotify[], count: number) {
  const expiresOn = products[0]?.expiration_date;
  const title = "⚠️ Scadenza in arrivo";
  let body: string;
  if (count === 1 && products[0]) {
    body = `"${products[0].name}" scade tra ${NOTIFY_LEAD_DAYS} giorni.`;
  } else {
    body = `Hai ${count} prodotti in scadenza entro ${NOTIFY_LEAD_DAYS} giorni.`;
  }
  return {
    title,
    body,
    url: "/products?filter=expiring",
    tag: `expiring-${expiresOn ?? "today"}`,
    timestamp: Date.now(),
  };
}

async function markNotified(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase
    .from("products")
    .update({ notification_7_days_sent: true })
    .in("id", ids);
}

async function sendToUser(
  supabase: SupabaseClient,
  userProducts: ProductForNotify[],
  userSubs: SubscriptionRow[],
): Promise<{ sent: number; dead: number }> {
  const payload = notificationPayload(userProducts, userProducts.length);
  const body = JSON.stringify(payload);
  let sent = 0;
  let dead = 0;

  const results = await Promise.allSettled(
    userSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent++;
      } catch (err) {
        const code =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : 0;
        // 404/410: subscription is gone. 400 with invalid payload can also
        // happen if the keys are stale — treat as dead too.
        if (code === 404 || code === 410 || code === 400) {
          dead++;
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }),
  );
  void results;

  if (sent > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_notified_at: new Date().toISOString() })
      .in("id", userSubs.map((s) => s.id));
  }

  return { sent, dead };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ ok: false, error: "VAPID keys non configurate" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = storeDate();
  const horizon = storeDate(NOTIFY_LEAD_DAYS);

  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, user_id, name, barcode, expiration_date")
      .eq("status", "active")
      .eq("notification_7_days_sent", false)
      .gte("expiration_date", today)
      .lte("expiration_date", horizon);

    if (error) throw error;
    if (!products || products.length === 0) {
      return json({ ok: true, notified: 0, message: "nessun prodotto in scadenza" });
    }

    // Group by user.
    const byUser = new Map<string, ProductForNotify[]>();
    for (const p of products as ProductForNotify[]) {
      const list = byUser.get(p.user_id) ?? [];
      list.push(p);
      byUser.set(p.user_id, list);
    }

    // Load subscriptions + notification preference for involved users.
    const userIds = [...byUser.keys()];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, notification_enabled")
      .in("id", userIds);
    const profiles = (profilesData ?? []) as { id: string; notification_enabled: boolean | null }[];
    const enabledUsers = new Set(
      profiles.filter((p) => p.notification_enabled !== false).map((p) => p.id),
    );

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    const subsByUser = new Map<string, SubscriptionRow[]>();
    for (const s of (subs ?? []) as SubscriptionRow[]) {
      const list = subsByUser.get(s.user_id) ?? [];
      list.push(s);
      subsByUser.set(s.user_id, list);
    }

    let notified = 0;
    let deadSubs = 0;
    const pool = async <T,>(items: T[], worker: (item: T) => Promise<void>) => {
      let i = 0;
      async function next(): Promise<void> {
        if (i >= items.length) return;
        const item = items[i++];
        await worker(item);
        await next();
      }
      const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => next());
      await Promise.all(runners);
    };

    const usersWithProducts = [...byUser.entries()].filter(([uid]) => enabledUsers.has(uid));

    await pool(usersWithProducts, async ([uid, userProducts]) => {
      const userSubs = subsByUser.get(uid) ?? [];
      if (userSubs.length === 0) return;
      const res = await sendToUser(supabase, userProducts, userSubs);
      notified += res.sent > 0 ? 1 : 0;
      deadSubs += res.dead;
      if (res.sent > 0) await markNotified(supabase, userProducts.map((p) => p.id));
    });

    return json({
      ok: true,
      date: today,
      products_in_window: products.length,
      users_notified: notified,
      dead_subscriptions: deadSubs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "errore sconosciuto";
    return json({ ok: false, error: message }, 500);
  }
});