import { useCallback, useEffect, useRef, useState } from "react";
import type { Product, ProductInput } from "../types";
import { supabase } from "../lib/supabase";
import {
  createProduct,
  deleteProduct,
  fetchProducts,
  markFinished,
  markWasted,
  reactivateProduct,
  updateProduct,
} from "../services/productService";

/**
 * useProducts — product data store with optimistic updates and realtime
 * refresh (triggered by the Supabase realtime channel + manual reload).
 */
export function useProducts(enabled: boolean) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

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

    const channel = supabase
      .channel("products-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => void reload(true),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, reload]);

  const add = useCallback(async (input: ProductInput): Promise<Product> => {
    const created = await createProduct(input);
    setProducts((prev) => [...prev, created].sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)));
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Product>) => {
    const updated = await updateProduct(id, patch);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const finish = useCallback(async (id: string) => {
    await markFinished(id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "finished", finished_at: new Date().toISOString(), wasted_at: null } : p)));
  }, []);

  const waste = useCallback(async (id: string) => {
    await markWasted(id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "wasted" } : p)));
  }, []);

  const reactivate = useCallback(
    async (id: string, newExpiration?: string) => {
      await reactivateProduct(id, newExpiration);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: "active" as const, wasted_at: null, ...(newExpiration ? { expiration_date: newExpiration } : {}) } : p,
        ),
      );
    },
    [],
  );

  return { products, loading, error, reload, add, update, remove, finish, waste, reactivate };
}