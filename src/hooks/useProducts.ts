import { useCallback, useEffect, useRef, useState } from "react";
import type { Product, ProductInput } from "../types";
import { supabase } from "../lib/supabase";
import {
  consumeOne,
  createProduct,
  deleteProduct,
  fetchProducts,
  markFinished,
  markWasted,
  reactivateProduct,
  setCachedUserId,
  updateProductWithCatalogSync,
} from "../services/productService";

/**
 * useProducts — product data store with optimistic updates and realtime
 * refresh.
 *
 * Performance notes:
 *  - the realtime channel is filtered by the current user, so events from
 *    other users never trigger a reload;
 *  - mutations update the local state immediately (optimistic) and the
 *    realtime reload is skipped when the change originated from this tab
 *    (suppressed for a short window), avoiding a redundant full refetch;
 *  - the auth user id is cached module-wide (see productService), so no
 *    `getUser()` network call happens on every reload.
 */
/** Null-safe expiration sort: unknown expiries go last. */
const byExpiration = (a: Product, b: Product) => {
  if (!a.expiration_date && !b.expiration_date) return 0;
  if (!a.expiration_date) return 1;
  if (!b.expiration_date) return -1;
  return a.expiration_date.localeCompare(b.expiration_date);
};

export function useProducts(enabled: boolean) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

  // When this tab mutates data the realtime callback is suppressed briefly:
  // the optimistic update already applied the change, a refetch would be
  // redundant. Changes from other tabs are still honored.
  const suppressRealtimeUntil = useRef(0);
  const suppressRealtime = () => {
    suppressRealtimeUntil.current = Date.now() + 1500;
  };

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchProducts();
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento prodotti");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();

    // Keep the cached user id in sync when the session changes (sign out/in).
    void supabase.auth.getUser().then(({ data }) => setCachedUserId(data.user?.id ?? null));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCachedUserId(session?.user?.id ?? null);
    });

    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Resolve the user id once to filter the realtime stream by user.
    void supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (!userId) return;
      channel = supabase
        .channel(`products-changes-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "products", filter: `user_id=eq.${userId}` },
          () => {
            if (Date.now() < suppressRealtimeUntil.current) return;
            void reload(true);
          },
        )
        .subscribe();
    });

    return () => {
      authListener.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, reload]);

  const add = useCallback(async (input: ProductInput): Promise<Product> => {
    const created = await createProduct(input);
    setProducts((prev) => [...prev, created].sort(byExpiration));
    suppressRealtime();
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Product>) => {
    const updated = await updateProductWithCatalogSync(id, patch);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    suppressRealtime();
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    suppressRealtime();
  }, []);

  /** Marks a product as fully consumed. Quantity-aware (consumed = total). */
  const finish = useCallback(
    async (id: string) => {
      const product = productsRef.current.find((p) => p.id === id);
      await markFinished(id);
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const total = product?.quantity_count ?? p.quantity_count ?? 1;
          return {
            ...p,
            status: "finished",
            finished_at: new Date().toISOString(),
            wasted_at: null,
            consumed_count: total,
          };
        }),
      );
      suppressRealtime();
    },
    [],
  );

  /** Consumes one unit of a multi-unit product (auto-finishes at the last one). */
  const consume = useCallback(async (id: string) => {
    const updated = await consumeOne(id);
    if (updated) {
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      suppressRealtime();
    }
    return updated;
  }, []);

  const waste = useCallback(async (id: string) => {
    await markWasted(id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "wasted" } : p)));
    suppressRealtime();
  }, []);

  const reactivate = useCallback(
    async (id: string, newExpiration?: string) => {
      await reactivateProduct(id, newExpiration);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: "active" as const, wasted_at: null, ...(newExpiration ? { expiration_date: newExpiration } : {}) } : p,
        ),
      );
      suppressRealtime();
    },
    [],
  );

  /** Bulk import (receipt): adds many products at once, one DB round-trip each. */
  const addMany = useCallback(async (inputs: ProductInput[]): Promise<Product[]> => {
    const created: Product[] = [];
    for (const input of inputs) {
      created.push(await createProduct(input));
    }
    setProducts((prev) => [...prev, ...created].sort(byExpiration));
    suppressRealtime();
    return created;
  }, []);

  /** Merges products created server-side (e.g. receipt import) into the store. */
  const mergeCreated = useCallback((created: Product[]): void => {
    setProducts((prev) => [...prev, ...created].sort(byExpiration));
    suppressRealtime();
  }, []);

  return { products, loading, error, reload, add, addMany, mergeCreated, update, remove, finish, consume, waste, reactivate };
}