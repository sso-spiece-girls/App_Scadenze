import { useCallback, useEffect, useRef, useState } from "react";
import type { Product, ProductInput } from "../types";
import { supabase } from "../lib/supabase";
import { productStore, PRODUCTS_TTL_MS } from "../lib/productStore";
import { barcodeCache } from "../lib/barcodeCache";
import {
  consumeOne,
  createProduct,
  deleteProduct,
  fetchProducts,
  getCurrentUserId,
  markFinished,
  markWasted,
  reactivateProduct,
  setCachedUserId,
  updateProductWithCatalogSync,
} from "../services/productService";

/**
 * useProducts — thin React binding over the global session product store.
 *
 * Why a global store:
 *  - navigating Dashboard → Products → Waste no longer refetches: the data
 *    lives once per session, and pages render the cache instantly
 *    (stale-while-revalidate: a silent background refresh runs only when the
 *    cache is older than PRODUCTS_TTL_MS);
 *  - the realtime channel is created ONCE per session (module-level) with the
 *    user_id filter, and events are applied DIRECTLY to the store
 *    (INSERT/UPDATE/DELETE by id) — no full refetch per event;
 *  - mutations stay optimistic; the realtime event for the same change then
 *    reconciles the server truth (e.g. trigger-set timestamps) for free;
 *  - no `supabase.auth.getUser()` here at all: the user id comes from
 *    productService.getCurrentUserId(), resolved once per session and cached.
 */

/** Module-level realtime channel: created once, reused across page mounts. */
let channel: ReturnType<typeof supabase.channel> | null = null;
let channelUserId: string | null = null;

function ensureRealtimeChannel(userId: string): void {
  if (channel && channelUserId === userId) return;
  if (channel) void supabase.removeChannel(channel);
  channelUserId = userId;
  channel = supabase
    .channel(`products-changes-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products", filter: `user_id=eq.${userId}` },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        productStore.applyEvent({ eventType, newRow: payload.new, oldRow: payload.old }, userId);
      },
    )
    .subscribe();
}

function teardownRealtimeChannel(): void {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
    channelUserId = null;
  }
}

export function useProducts(enabled: boolean) {
  const [snapshot, setSnapshot] = useState(() => productStore.getSnapshot());
  const productsRef = useRef<Product[]>(snapshot.products);
  productsRef.current = snapshot.products;

  // Re-render when the store changes.
  useEffect(() => {
    if (!enabled) return;
    return productStore.subscribe(() => setSnapshot(productStore.getSnapshot()));
  }, [enabled]);

  // Session → store binding: resolve the user ONCE (cached), sync on auth
  // events, and run the stale-while-revalidate load.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setCachedUserId(session?.user?.id ?? null);
      if (event === "SIGNED_OUT") {
        teardownRealtimeChannel();
        barcodeCache.clear();
        productStore.clear();
      } else if (session?.user) {
        productStore.setSession(session.user.id);
        ensureRealtimeChannel(session.user.id);
        void loadIfNeeded(session.user.id);
      }
    });

    const loadIfNeeded = async (userId: string) => {
      // Fresh cache → nothing to do (instant page). Stale or empty →
      // single-flight load; cached data stays visible while refreshing.
      if (!productStore.isStale(PRODUCTS_TTL_MS)) return;
      if (productStore.getSnapshot().loading) return; // another mount is loading
      productStore.setLoading(true);
      try {
        const data = await fetchProducts();
        if (!cancelled) productStore.replaceAll(userId, data);
      } catch (err) {
        if (!cancelled) {
          productStore.setError(err instanceof Error ? err.message : "Errore caricamento prodotti");
        }
      } finally {
        if (!cancelled) productStore.setLoading(false);
      }
    };

    void getCurrentUserId()
      .then((userId) => {
        if (cancelled) return;
        productStore.setSession(userId);
        ensureRealtimeChannel(userId);
        void loadIfNeeded(userId);
      })
      .catch(() => {
        // Not authenticated yet (login screen) — the auth listener handles it.
      });

    // Silent integrity refresh when the app returns to the foreground with a
    // stale cache (catches events missed while the channel was closed).
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const userId = productStore.getSnapshot().userId;
      if (!userId) return;
      void loadIfNeeded(userId);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  /** Manual refresh (silent = keep showing cached data). */
  const reload = useCallback(async (silent = false) => {
    const userId = productStore.getSnapshot().userId ?? (await getCurrentUserId());
    if (!silent) productStore.setLoading(true);
    try {
      const data = await fetchProducts();
      productStore.replaceAll(userId, data);
    } catch (err) {
      productStore.setError(err instanceof Error ? err.message : "Errore caricamento prodotti");
    } finally {
      productStore.setLoading(false);
    }
  }, []);

  const add = useCallback(async (input: ProductInput): Promise<Product> => {
    const created = await createProduct(input);
    productStore.upsertLocal(created);
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Product>) => {
    const updated = await updateProductWithCatalogSync(id, patch);
    productStore.upsertLocal(updated);
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteProduct(id);
    productStore.removeLocal(id);
  }, []);

  /** Marks a product as fully consumed. Quantity-aware (consumed = total). */
  const finish = useCallback(async (id: string) => {
    const product = productsRef.current.find((p) => p.id === id);
    await markFinished(id);
    const total = product?.quantity_count ?? 1;
    productStore.updateLocal(id, {
      status: "finished",
      finished_at: new Date().toISOString(),
      wasted_at: null,
      consumed_count: total,
    });
  }, []);

  /** Consumes one unit of a multi-unit product (auto-finishes at the last one). */
  const consume = useCallback(async (id: string) => {
    const updated = await consumeOne(id);
    if (updated) productStore.upsertLocal(updated);
    return updated;
  }, []);

  const waste = useCallback(async (id: string) => {
    await markWasted(id);
    productStore.updateLocal(id, { status: "wasted" });
  }, []);

  const reactivate = useCallback(
    async (id: string, newExpiration?: string) => {
      await reactivateProduct(id, newExpiration);
      productStore.updateLocal(id, {
        status: "active",
        wasted_at: null,
        ...(newExpiration ? { expiration_date: newExpiration } : {}),
      });
    },
    [],
  );

  /** Bulk import (receipt): adds many products at once, one DB round-trip each. */
  const addMany = useCallback(async (inputs: ProductInput[]): Promise<Product[]> => {
    const created: Product[] = [];
    for (const input of inputs) {
      created.push(await createProduct(input));
    }
    for (const product of created) productStore.upsertLocal(product);
    return created;
  }, []);

  /** Merges products created server-side (e.g. receipt import) into the store. */
  const mergeCreated = useCallback((created: Product[]): void => {
    for (const product of created) productStore.upsertLocal(product);
  }, []);

  return {
    products: snapshot.products,
    loading: snapshot.loading,
    error: snapshot.error,
    reload,
    add,
    addMany,
    mergeCreated,
    update,
    remove,
    finish,
    consume,
    waste,
    reactivate,
  };
}