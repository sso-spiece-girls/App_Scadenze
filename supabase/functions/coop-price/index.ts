/**
 * coop-price — automatic price lookup from Coop.fi / S-Kaupat.
 *
 * There is no official public API for Coop.fi (now S-Kaupat, the S-Group
 * online store). This function performs a *server-side* search against the
 * same GraphQL persisted-query endpoint used by the s-kaupat.fi web app
 * (publicly served data), the same technique used by the open-source
 * projects `sokpy` and `mcp-ruoka`. It is deliberately NOT done in the
 * browser (no fragile scraping, no CORS issues, single point of change).
 *
 * Flow:
 *   1. check the global `price_cache` table (fresh lookups are reused);
 *   2. resolve the Coop store id (env SKAUPAT_STORE_ID or store search);
 *   3. search S-Kaupat by the product name (and brand) and match the result
 *      whose EAN equals the scanned barcode;
 *   4. cache the price and return it to the client.
 *
 * Returns  { found, price, name, brand, category, imageUrl, source, fetchedAt, cached }.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, fetchJson } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SKAUPAT_API = "https://api.s-kaupat.fi/";
const SKAUPAT_ORIGIN = "https://www.s-kaupat.fi";

// Persisted GraphQL query hashes (extracted from the public s-kaupat.fi app by
// the sokpy / mcp-ruoka projects). Overridable via env if S-Group rotates them.
const HASH_PRODUCT_SEARCH =
  Deno.env.get("SKAUPAT_HASH_PRODUCT_SEARCH") ??
  "48756d592aa8fe6f1c9f560440bbdf8ce390ec3110fa34fc89b298c7d7a3bd4f";
const HASH_STORE_SEARCH =
  Deno.env.get("SKAUPAT_HASH_STORE_SEARCH") ??
  "e49317e01c3a57b286fadd6f3ea47fd1d64adebb483943ba0e229307d15763b5";

const STORE_ID = Deno.env.get("SKAUPAT_STORE_ID") ?? "";
const STORE_NAME = Deno.env.get("SKAUPAT_STORE_NAME") ?? "Coop";

/** How long a cached price stays valid (hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_HEADERS = {
  Origin: SKAUPAT_ORIGIN,
  Referer: `${SKAUPAT_ORIGIN}/`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

interface LookupInput {
  barcode?: string;
  productName?: string | null;
  brand?: string | null;
  skipCache?: boolean;
}

interface PriceResult {
  found: boolean;
  price?: number;
  currency?: string;
  name?: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  source: "s-kaupat";
  fetchedAt?: string;
  cached?: boolean;
}

function makeApiUrl(operationName: string, variables: Record<string, unknown>, hash: string): string {
  const url = new URL(SKAUPAT_API);
  url.searchParams.set("operationName", operationName);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
  return url.toString();
}

/** Resolves a Coop store id. Falls back to the first store found by name. */
async function resolveStoreId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  if (STORE_ID) return STORE_ID;

  // First try a cached value.
  const { data: cached } = await supabase
    .from("price_cache")
    .select("raw")
    .eq("barcode", "__store__")
    .maybeSingle();
  if (cached?.raw && typeof cached.raw === "object" && "storeId" in cached.raw) {
    return (cached.raw as { storeId: string }).storeId;
  }

  try {
    const url = makeApiUrl(
      "RemoteStoreSearch",
      { query: STORE_NAME, brand: null, cursor: null },
      HASH_STORE_SEARCH,
    );
    const raw = (await fetchJson(url, { headers: DEFAULT_HEADERS })) as {
      data?: { searchStores?: { stores?: { id: string }[] } };
    };
    const store = raw?.data?.searchStores?.stores?.[0];
    if (!store?.id) return null;
    await supabase
      .from("price_cache")
      .upsert({ barcode: "__store__", raw: { storeId: store.id } }, { onConflict: "barcode" });
    return store.id;
  } catch {
    return null;
  }
}

function buildImageUrl(urlTemplate: string): string {
  return urlTemplate.replace("{MODIFIERS}", "w_200,h_200").replace("{EXTENSION}", "png");
}

/** Normalizes a barcode for comparison (strips leading zeroes). */
function normBarcode(value: string): string {
  return value.replace(/^0+/, "");
}

interface SKaupatItem {
  product: {
    name: string;
    ean: string;
    price: number | null;
    brandName: string | null;
    pricing: {
      currentPrice: number | null;
      comparisonPrice: number | null;
      comparisonUnit: string | null;
      campaignPrice: number | null;
      regularPrice: number | null;
    } | null;
    productDetails?: {
      productImages?: { mainImage?: { urlTemplate?: string } | null } | null;
    } | null;
    hierarchyPath?: { name: string }[] | null;
  };
}

/** Performs the S-Kaupat search for a given query string. */
async function searchSKaupat(query: string, storeId: string): Promise<SKaupatItem[]> {
  const url = makeApiUrl(
    "RemoteFilteredProducts",
    { queryString: query, storeId, from: 0, limit: 25 },
    HASH_PRODUCT_SEARCH,
  );
  const raw = (await fetchJson(url, { headers: DEFAULT_HEADERS })) as {
    data?: { store?: { products?: { productListItems?: SKaupatItem[] } } };
  };
  return raw?.data?.store?.products?.productListItems ?? [];
}

async function lookupPrice(
  supabase: ReturnType<typeof createClient>,
  barcode: string,
  productName?: string | null,
  brand?: string | null,
): Promise<PriceResult> {
  const storeId = await resolveStoreId(supabase);
  if (!storeId) {
    return { found: false, source: "s-kaupat" };
  }

  // Candidate queries, most specific first. Also tries the barcode itself in
  // case the catalogue indexes EANs.
  const queries: string[] = [];
  if (productName?.trim()) queries.push(productName.trim());
  if (brand?.trim() && productName?.trim()) queries.push(`${brand.trim()} ${productName.trim()}`);
  queries.push(barcode);

  for (const query of queries) {
    try {
      const items = await searchSKaupat(query, storeId);
      const match = items.find(
        (i) => i.product?.ean && normBarcode(i.product.ean) === normBarcode(barcode),
      );
      if (!match) continue;

      const p = match.product;
      const price = p.pricing?.currentPrice ?? p.price;
      if (price == null) continue;

      const result: PriceResult = {
        found: true,
        price: Number(price.toFixed(2)),
        currency: "EUR",
        name: p.name,
        brand: p.brandName,
        category: p.hierarchyPath?.[0]?.name ?? null,
        imageUrl: p.productDetails?.productImages?.mainImage?.urlTemplate
          ? buildImageUrl(p.productDetails.productImages.mainImage.urlTemplate)
          : null,
        source: "s-kaupat",
        fetchedAt: new Date().toISOString(),
      };
      await supabase
        .from("price_cache")
        .upsert(
          {
            barcode,
            name: result.name,
            brand: result.brand,
            category: result.category,
            image_url: result.imageUrl,
            price: result.price,
            currency: "EUR",
            price_source: "s-kaupat",
            fetched_at: result.fetchedAt,
            raw: { ean: p.ean },
          },
          { onConflict: "barcode" },
        );
      return result;
    } catch {
      // try next query candidate
    }
  }

  return { found: false, source: "s-kaupat" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = (await req.json()) as LookupInput;
    const barcode = (body.barcode ?? "").trim();
    if (!barcode) return json({ found: false, error: "barcode mancante" }, 400);

    const now = Date.now();

    if (!body.skipCache) {
      const { data: cached } = await supabase
        .from("price_cache")
        .select("*")
        .eq("barcode", barcode)
        .maybeSingle();
      if (cached?.price != null) {
        const fetchedAt = cached.fetched_at ? new Date(cached.fetched_at).getTime() : 0;
        if (now - fetchedAt < CACHE_TTL_MS) {
          return json({
            found: true,
            price: Number(cached.price),
            currency: cached.currency ?? "EUR",
            name: cached.name ?? undefined,
            brand: cached.brand ?? undefined,
            category: cached.category ?? undefined,
            imageUrl: cached.image_url ?? undefined,
            source: cached.price_source ?? "s-kaupat",
            fetchedAt: cached.fetched_at,
            cached: true,
          });
        }
      }
    }

    const result = await lookupPrice(supabase, barcode, body.productName, body.brand);
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "errore sconosciuto";
    return json({ found: false, source: "s-kaupat", error: message }, 500);
  }
});