import type { Product } from "../types";

/**
 * productStore — session-level, per-user cache of the product list.
 *
 * Pure state container (no Supabase, no React): testable in isolation.
 * Guarantees:
 *  - one source of truth for the whole session: navigating between
 *    Dashboard / Products / Waste never refetches when data is fresh;
 *  - per-user: switching session clears the data;
 *  - invalidated on logout (`clear()`);
 *  - updated by mutations (optimistic) and by realtime events (INSERT /
 *    UPDATE / DELETE applied directly, no full refetch);
 *  - stale-while-revalidate: consumers render cached data immediately and
 *    trigger a silent background refresh only when `isStale()`.
 */

export type ProductEventType = "INSERT" | "UPDATE" | "DELETE";

export interface ProductRealtimeEvent {
  eventType: ProductEventType;
  /** Payload row for INSERT/UPDATE. */
  newRow?: Partial<Product> | null;
  /** Previous row for DELETE/UPDATE (id is enough for DELETE). */
  oldRow?: Partial<Product> | null;
}

export interface ProductSnapshot {
  products: Product[];
  loading: boolean;
  error: string | null;
  /** Timestamp of the last successful full load (ms epoch), null before. */
  loadedAt: number | null;
  /** User the cached data belongs to. */
  userId: string | null;
}

export interface ProductStoreOptions {
  now?: () => number;
}

/** Freshness threshold for the session cache (ms). */
export const PRODUCTS_TTL_MS = 60_000;

/** True when the cache is old enough that a background refresh is useful. */
export function shouldRefresh(snapshot: Pick<ProductSnapshot, "loadedAt" | "products">, ttlMs: number, now: number): boolean {
  if (snapshot.products.length === 0) return true;
  if (snapshot.loadedAt === null) return true;
  return now - snapshot.loadedAt > ttlMs;
}

/** Null-safe expiration sort: unknown expiries go last. */
export function byExpiration(a: Product, b: Product): number {
  if (!a.expiration_date && !b.expiration_date) return 0;
  if (!a.expiration_date) return 1;
  if (!b.expiration_date) return -1;
  return a.expiration_date.localeCompare(b.expiration_date);
}

export class ProductStore {
  private products: Product[] = [];
  private loading = false;
  private error: string | null = null;
  private loadedAt: number | null = null;
  private userId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(options: ProductStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ProductSnapshot {
    return {
      products: this.products,
      loading: this.loading,
      error: this.error,
      loadedAt: this.loadedAt,
      userId: this.userId,
    };
  }

  /** Sorted copy of the cached products. */
  getProducts(): Product[] {
    return this.products;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Binds the store to a session. Changing user (or logging out) invalidates
   * the cache: data is per-user and must never leak across accounts.
   */
  setSession(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    this.products = [];
    this.loadedAt = null;
    this.error = null;
    this.emit();
  }

  /** Logout / session end: drop everything. */
  clear(): void {
    this.userId = null;
    this.products = [];
    this.loading = false;
    this.error = null;
    this.loadedAt = null;
    this.emit();
  }

  setLoading(loading: boolean): void {
    if (this.loading === loading) return;
    this.loading = loading;
    this.emit();
  }

  setError(error: string | null): void {
    if (this.error === error) return;
    this.error = error;
    this.emit();
  }

  /** Replaces the whole list after a successful fetch. */
  replaceAll(userId: string, products: Product[], at: number = this.now()): void {
    this.userId = userId;
    this.products = [...products].sort(byExpiration);
    this.loadedAt = at;
    this.error = null;
    this.loading = false;
    this.emit();
  }

  /** In-memory freshness check for the current cache. */
  isStale(ttlMs: number = PRODUCTS_TTL_MS): boolean {
    return shouldRefresh({ loadedAt: this.loadedAt, products: this.products }, ttlMs, this.now());
  }

  /**
   * Applies a realtime event directly to the store (no refetch):
   *  - INSERT → upsert by id;
   *  - UPDATE → merge by id;
   *  - DELETE → remove by id.
   * Events for rows of another user are ignored.
   */
  applyEvent(event: ProductRealtimeEvent, userId: string): void {
    if (event.eventType === "DELETE") {
      const id = event.oldRow?.id;
      if (!id) return;
      this.removeLocal(String(id));
      return;
    }
    const row = event.newRow;
    if (!row?.id) return;
    if (row.user_id && row.user_id !== userId) return;
    this.upsertLocal(row as Product);
  }

  /** Optimistic insert/update (used by mutations and realtime events). */
  upsertLocal(product: Product): void {
    const index = this.products.findIndex((p) => p.id === product.id);
    if (index === -1) {
      this.products = [...this.products, product].sort(byExpiration);
    } else {
      this.products = this.products.map((p) => (p.id === product.id ? { ...p, ...product } : p));
    }
    this.emit();
  }

  /** Optimistic partial update. */
  updateLocal(id: string, patch: Partial<Product>): void {
    this.products = this.products.map((p) => (p.id === id ? { ...p, ...patch } : p));
    this.emit();
  }

  /** Optimistic removal. */
  removeLocal(id: string): void {
    if (!this.products.some((p) => p.id === id)) return;
    this.products = this.products.filter((p) => p.id !== id);
    this.emit();
  }

  /** Products matching a barcode (excluding finished), for "già in dispensa". */
  findExistingByBarcode(barcode: string): Product[] {
    return this.products.filter((p) => p.barcode === barcode && p.status !== "finished");
  }
}

/** App-wide singleton. */
export const productStore = new ProductStore();