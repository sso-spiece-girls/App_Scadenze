import type { ProductLookup } from "../types";

/**
 * barcodeCache — session-level, per-user resolution cache for barcode → product.
 *
 * A barcode already resolved during the session (from the catalog, the pantry
 * or Open Food Facts) is served from memory: ZERO network round trips for
 * repeated scans. Cleared on logout / session change.
 */

export type BarcodeLookupSource = ProductLookup["source"] | "none";

export interface BarcodeCacheEntry {
  lookup: ProductLookup | null;
  source: BarcodeLookupSource;
  at: number;
}

export interface BarcodeCacheOptions {
  now?: () => number;
}

/** How long a resolved barcode stays in the session cache (ms). */
export const BARCODE_CACHE_TTL_MS = 30 * 60 * 1000;

export class BarcodeCache {
  private readonly cache = new Map<string, BarcodeCacheEntry>();
  private readonly now: () => number;

  constructor(options: BarcodeCacheOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Returns the cached resolution when fresh, else null. */
  get(barcode: string): BarcodeCacheEntry | null {
    const entry = this.cache.get(barcode);
    if (!entry) return null;
    if (this.now() - entry.at > BARCODE_CACHE_TTL_MS) {
      this.cache.delete(barcode);
      return null;
    }
    return entry;
  }

  set(barcode: string, entry: Omit<BarcodeCacheEntry, "at">): void {
    this.cache.set(barcode, { ...entry, at: this.now() });
    // Bounded: never grow unboundedly within a session.
    if (this.cache.size > 500) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  /** Session end: drop every resolution (identity data is not personal, but
   *  keeping it across users would serve wrong lookups after switching). */
  clear(): void {
    this.cache.clear();
  }
}

/** App-wide singleton. */
export const barcodeCache = new BarcodeCache();