/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Precache everything produced by the build (app shell).
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback: serve the app shell for any route (offline too).
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

// Runtime caching (injectManifest strategy keeps this in the custom SW):
// offline caching for Open Food Facts lookups (read-only, GET).
registerRoute(
  ({ url }) => url.hostname === "world.openfoodfacts.org" && url.pathname.startsWith("/api/v2/product/"),
  new CacheFirst({
    cacheName: "openfoodfacts-api",
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// Never cache Supabase / edge function calls (auth-sensitive).
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in"),
  new NetworkOnly(),
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

/** NotificationOptions in the WebWorker lib lacks `vibrate`; keep it for haptics. */
interface SwNotificationOptions extends NotificationOptions {
  vibrate?: number[];
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      cleanupOutdatedCaches();
      await self.clients.claim();
    })(),
  );
});

// Web Push handler: the payload is sent by the notify-expiring Edge Function.
self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    if (event.data) {
      payload = typeof event.data.json() === "object" ? event.data.json() : {};
    }
  } catch {
    payload = { body: event.data?.text() };
  }

  const { title, body, url, tag } = payload;

  event.waitUntil(
    self.registration.showNotification(title ?? "⚠️ Scadenza in arrivo", {
      body: body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag,
      vibrate: [200, 100, 200],
      data: { url: url ?? "/products" },
    } as SwNotificationOptions),
  );
});

// Tapping the notification opens (or focuses) the relevant view.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? "/products";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if ("navigate" in client) {
          await client.navigate(url);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});