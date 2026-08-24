import type { Product, ProductInput, ProductLookup } from "../types";
import { supabase } from "../lib/supabase";
import { mapOffCategory } from "../utils/categories";

/**
 * productService — CRUD for products and barcode → product identity lookup.
 *
 * Identity lookup strategy:
 *   1. the user's private catalog (fast, works offline after first scan);
 *   2. Open Food Facts public API (official, free, CORS-enabled);
 *   3. if the product is found, it is cached in the user's catalog so future
 *      scans are instant.
 *
 * Products manually entered by the user are saved to the catalog as well, so
 * they are recognized in future scans.
 */

const MAX_PRODUCTS = 1000;

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Utente non autenticato");
  return data.user.id;
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
  const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as Product;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Marks a product as consumed (zero waste). */
export async function markFinished(id: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ status: "finished", finished_at: new Date().toISOString(), wasted_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Marks a product as wasted (its price counts toward waste totals). */
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

    const lookup: ProductLookup = {
      name,
      brand: p.brands || null,
      category: mapOffCategories(p.categories),
      image_url: p.image_front_url || p.image_url || null,
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
 * Full barcode → product resolution. Returns the best known identity.
 * Saves the result to the user's catalog for future offline recognition.
 */
export async function lookupProduct(barcode: string): Promise<{ lookup: ProductLookup | null; source: "catalog" | "openfoodfacts" | "none" }> {
  try {
    const catalog = await lookupCatalog(barcode);
    if (catalog) return { lookup: catalog, source: "catalog" };
  } catch {
    // catalog unavailable (offline/auth) — continue to OFF
  }

  const off = await lookupOpenFoodFacts(barcode);
  if (off) {
    try {
      await saveToCatalog(barcode, off);
    } catch {
      // non fatal
    }
    return { lookup: off, source: "openfoodfacts" };
  }

  return { lookup: null, source: "none" };
}