import type { Product, ProductInput, ProductLookup } from "../types";
import { supabase } from "../lib/supabase";
import { mapOffCategory } from "../utils/categories";

/**
 * productService — CRUD for products and barcode → product identity lookup.
 *
 * Identity lookup strategy (multi-level, stops at the first reliable hit):
 *   1. the user's private catalog (fast, works offline after first scan);
 *   2. an existing (non-finished) product of the user with the same barcode —
 *      "I already know this product", no network needed;
 *   3. Open Food Facts public API (official, free, CORS-enabled);
 *   4. nothing → the caller falls back to manual entry.
 *
 * NOTE on prices: there is NO public, documented API for the Unicoop Firenze
 * / Coop.fi catalog (neither for products nor prices). The price of a product
 * therefore comes from the receipt (OCR import — the price really paid) or is
 * entered manually by the user. No third-party catalog price is fetched.
 *
 * Every successful external lookup is cached in the user's catalog so future
 * scans are instant. Manually entered products are saved to the catalog too.
 */

const MAX_PRODUCTS = 1000;

// The auth user id is stable for the whole session: resolve it once and
// refresh it only when the session changes. This avoids one network round
// trip (`getUser()`) on every product fetch / realtime reload.
let cachedUserId: string | null = null;

export function setCachedUserId(id: string | null): void {
  cachedUserId = id;
}

/** Resolves (and caches) the current auth user id. */
export async function getCurrentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Utente non autenticato");
  cachedUserId = data.user.id;
  return data.user.id;
}

async function currentUserId(): Promise<string> {
  return getCurrentUserId();
}

export async function fetchProducts(): Promise<Product[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .order("expiration_date", { ascending: true })
    .limit(MAX_PRODUCTS);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchActiveProducts(): Promise<Product[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "finished")
    .order("expiration_date", { ascending: true })
    .limit(MAX_PRODUCTS);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("products")
    .insert([{ ...input, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Product;
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Product;
}

/**
 * Updates a product and, in the background, keeps the user's catalog entry in
 * sync when identity fields (name/brand/category/image/quantity) changed, so
 * the next scan of the same barcode shows the corrected data.
 */
export async function updateProductWithCatalogSync(
  id: string,
  patch: Partial<Product>,
): Promise<Product> {
  const updated = await updateProduct(id, patch);
  const identityChanged =
    patch.name !== undefined ||
    patch.brand !== undefined ||
    patch.category !== undefined ||
    patch.image_url !== undefined ||
    patch.quantity !== undefined ||
    patch.unit !== undefined;

  if (identityChanged && updated.barcode && !updated.barcode.startsWith("manual-")) {
    try {
      await saveToCatalog(
        updated.barcode,
        {
          name: updated.name,
          brand: updated.brand,
          category: updated.category,
          image_url: updated.image_url,
          quantity: updated.quantity,
          unit: updated.unit,
        },
        "manual",
      );
    } catch {
      // non fatal — catalog is only a cache
    }
  }
  return updated;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Marks a product as fully consumed (zero waste). Quantity-aware. */
export async function markFinished(id: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ status: "finished", finished_at: new Date().toISOString(), wasted_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Consumes one physical unit of a multi-unit product. When the last unit is
 * consumed the product becomes `finished` (zero waste).
 * Returns the updated product, or null when nothing changed.
 */
export async function consumeOne(id: string): Promise<Product | null> {
  const { data: current, error: fetchErr } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!current) return null;

  const consumed = Math.min((current.consumed_count ?? 0) + 1, current.quantity_count ?? 1);
  const finished = consumed >= (current.quantity_count ?? 1);

  const patch: Partial<Product> = { consumed_count: consumed };
  if (finished) {
    patch.status = "finished";
    patch.finished_at = new Date().toISOString();
    patch.wasted_at = null;
  }

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Product;
}

/** Marks a product as wasted (its value counts toward waste totals). */
export async function markWasted(id: string): Promise<void> {
  const { error } = await supabase.from("products").update({ status: "wasted" }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Brings a wasted/expired product back to active (user "saved" it). */
export async function reactivateProduct(id: string, newExpiration?: string): Promise<void> {
  const patch: Partial<Product> = { status: "active", wasted_at: null };
  if (newExpiration) patch.expiration_date = newExpiration;
  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Products with the same barcode already in the user's pantry. */
export async function findExistingByBarcode(barcode: string): Promise<Product[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .eq("barcode", barcode)
    .neq("status", "finished")
    .order("expiration_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function lookupCatalog(barcode: string): Promise<ProductLookup | null> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("product_catalog")
    .select("*")
    .eq("user_id", userId)
    .eq("barcode", barcode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    name: data.name,
    brand: data.brand,
    category: data.category,
    image_url: data.image_url,
    quantity: data.quantity,
    unit: data.unit,
    source: "catalog",
  };
}

export async function saveToCatalog(
  barcode: string,
  lookup: Omit<ProductLookup, "source">,
  source: "openfoodfacts" | "manual" = "openfoodfacts",
): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from("product_catalog").upsert(
    {
      user_id: userId,
      barcode,
      name: lookup.name,
      brand: lookup.brand ?? null,
      category: lookup.category ?? null,
      image_url: lookup.image_url ?? null,
      quantity: lookup.quantity ?? null,
      unit: lookup.unit ?? null,
      source,
    },
    { onConflict: "user_id,barcode" },
  );
  if (error) console.warn("catalog save failed", error.message);
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

const OFF_API = "https://world.openfoodfacts.org/api/v2/product";

interface OffResponse {
  status: number;
  code?: string;
  product?: {
    product_name?: string;
    product_name_it?: string;
    brands?: string;
    categories?: string;
    image_url?: string;
    image_front_url?: string;
    image_front_small_url?: string;
    quantity?: string;
  };
}

/**
 * Best-effort mapping of an Open Food Facts `categories` field (a
 * comma-separated list of e.g. "en:yogurts,it:yogurt") to our localized
 * category. Uses the first category token we recognize.
 */
function mapOffCategories(categories: string | null | undefined): string | null {
  if (!categories) return null;
  for (const raw of categories.split(",")) {
    const token = raw.trim().replace(/^[a-z]{2,3}:/, "");
    const mapped = mapOffCategory(token);
    if (mapped) return mapped;
  }
  return null;
}

/** Looks a barcode up on Open Food Facts. */
export async function lookupOpenFoodFacts(barcode: string): Promise<ProductLookup | null> {
  try {
    const res = await fetch(`${OFF_API}/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": "ScadenzeSprechi/1.0 (personal pantry app)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OffResponse;
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const name = p.product_name_it || p.product_name;
    if (!name) return null;

    // Prefer the small thumbnail (much lighter) for list/scan UIs.
    const image = p.image_front_small_url || p.image_front_url || p.image_url;

    const lookup: ProductLookup = {
      name,
      brand: p.brands || null,
      category: mapOffCategories(p.categories),
      image_url: image || null,
      quantity: p.quantity || null,
      unit: null,
      source: "openfoodfacts",
    };
    return lookup;
  } catch {
    return null;
  }
}

/**
 * Level 2 of the lookup chain: a product with the same barcode already in the
 * user's pantry (not finished). Reusing its identity means zero network calls
 * and consistent data ("I already know this product").
 */
export async function lookupExistingProduct(barcode: string): Promise<ProductLookup | null> {
  try {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("products")
      .select("name, brand, category, image_url, quantity, unit")
      .eq("user_id", userId)
      .eq("barcode", barcode)
      .neq("status", "finished")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      name: data.name,
      brand: data.brand,
      category: data.category,
      image_url: data.image_url,
      quantity: data.quantity,
      unit: data.unit,
      source: "catalog",
    };
  } catch {
    return null;
  }
}

/**
 * Full barcode → product resolution. Multi-level, stops at the first reliable
 * hit. Saves external results to the user's catalog for offline recognition.
 */
export async function lookupProduct(
  barcode: string,
): Promise<{ lookup: ProductLookup | null; source: "catalog" | "openfoodfacts" | "none" }> {
  // Level 1: private catalog (instant, offline-friendly).
  try {
    const catalog = await lookupCatalog(barcode);
    if (catalog) return { lookup: catalog, source: "catalog" };
  } catch {
    // catalog unavailable (offline/auth) — continue
  }

  // Level 2: same barcode already in the user's pantry (no network).
  const existing = await lookupExistingProduct(barcode);
  if (existing) return { lookup: existing, source: "catalog" };

  // Level 3: Open Food Facts.
  const off = await lookupOpenFoodFacts(barcode);
  if (off) {
    try {
      await saveToCatalog(barcode, off);
    } catch {
      // non fatal
    }
    return { lookup: off, source: "openfoodfacts" };
  }

  // Level 4: nothing → caller falls back to manual entry.
  return { lookup: null, source: "none" };
}