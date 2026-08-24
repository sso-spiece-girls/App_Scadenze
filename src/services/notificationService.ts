import type { PushSubscriptionRow } from "../types";
import { supabase, vapidPublicKey } from "../lib/supabase";

/**
 * notificationService — Web Push subscription management (client side).
 *
 * The actual sending is done by the `notify-expiring` Edge Function (cron).
 * The client only:
 *   - requests the Notification permission;
 *   - creates the subscription via the service worker;
 *   - persists it in `push_subscriptions` (RLS: owned by the user).
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(vapidPublicKey)
  );
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker non supportato");
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js"));
  // Make sure the SW is active before subscribing.
  if (reg.active) return reg;
  await navigator.serviceWorker.ready;
  return reg;
}

/**
 * Subscribes the current device for push and stores the subscription.
 * Returns true when the device is now subscribed.
 */
export async function subscribeForPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await ensureRegistration();
  const existing = await reg.pushManager.getSubscription();
  const subscription = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey as string),
  }));

  await storeSubscription(subscription);
  return true;
}

/** Stores a PushSubscription in the DB (idempotent by endpoint). */
export async function storeSubscription(subscription: PushSubscription): Promise<void> {
  const { data: sessionData } = await supabase.auth.getUser();
  if (!sessionData.user) return;

  const subJson = subscription.toJSON() as {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const row: Omit<PushSubscriptionRow, "id" | "created_at" | "user_id"> = {
    endpoint: subJson.endpoint,
    p256dh: subJson.keys?.p256dh ?? "",
    auth: subJson.keys?.auth ?? "",
    user_agent: navigator.userAgent,
  };

  await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
}

/** Unsubscribes this device and removes the stored row. */
export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}

/**
 * Ensures the current device's subscription exists in the DB. Call after
 * login / app start so that re-installs and session changes are covered.
 */
export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    if (Notification.permission !== "granted") return false;
    const reg = await ensureRegistration();
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return false;
    await storeSubscription(subscription);
    return true;
  } catch {
    return false;
  }
}