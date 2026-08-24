import type { PriceLookupResult } from "../types";
import { supabase } from "../lib/supabase";

/**
 * priceService — automatic price lookup from Coop.fi / S-Kaupat.
 *
 * The heavy lifting happens server-side in the `coop-price` Edge Function
 * (GraphQL persisted queries against the public s-kaupat.fi API). The client
 * only forwards the scanned barcode plus the product name/brand used to
 * disambiguate the search, and receives the best known price.
 *
 * The returned price is always treated as a *suggestion*: the user can edit
 * it before saving. If the lookup fails, `found` is false and the UI falls
 * back to manual entry.
 */

const CACHE_TTL_MS = 30 * 60 * 1000; // in-memory client cache (minutes)

const memoryCache = new Map<string, { at: number; result: PriceLookupResult }>();

export async function fetchCoopPrice(
  barcode: string,
  productName?: string | null,
  brand?: string | null,
): Promise<PriceLookupResult> {
  const key = `${barcode}|${productName ?? ""}|${brand ?? ""}`;
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let result: PriceLookupResult;
  try {
    const { data, error } = await supabase.functions.invoke<PriceLookupResult>("coop-price", {
      body: { barcode, productName, brand },
    });
    if (error) throw error;
    result = data ?? { found: false, source: "unknown" };
  } catch {
    result = { found: false, source: "unknown" };
  }

  memoryCache.set(key, { at: Date.now(), result });
  return result;
}

/** Clears the in-memory price cache (e.g. after a manual correction). */
export function clearPriceCache(): void {
  memoryCache.clear();
}