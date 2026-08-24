/**
 * Domain types for the app. These mirror the Supabase schema (see
 * supabase/migrations) but stay independent from generated database types so
 * the frontend can run even before `supabase gen types` is executed.
 */

export type ProductStatus = "active" | "finished" | "expired" | "wasted";

/** Source of a price value. */
export type PriceSource = "s-kaupat" | "openfoodfacts" | "manual" | "none" | "unknown";

/** Effective (display) status computed for the UI. */
export type EffectiveStatus = ProductStatus;

export interface Product {
  id: string;
  user_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  /** Display quantity, e.g. "1 l", "500 g", "4x100 g" (from OFF / catalog). */
  quantity: string | null;
  /** Base unit, e.g. "l", "g", "kg", "pcs". */
  unit: string | null;
  purchase_date: string | null;
  expiration_date: string;
  price: number;
  price_source: PriceSource;
  price_fetched_at: string | null;
  price_was_manually_corrected: boolean;
  status: ProductStatus;
  notification_7_days_sent: boolean;
  finished_at: string | null;
  wasted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A product plus the effective status derived at render time. */
export interface ProductWithStatus extends Product {
  effectiveStatus: EffectiveStatus;
  /** Days until expiration (negative when past). */
  daysUntil: number;
}

/** Fields accepted when creating a product. */
export interface ProductInput {
  barcode: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  image_url?: string | null;
  quantity?: string | null;
  unit?: string | null;
  purchase_date?: string | null;
  expiration_date: string;
  price?: number;
  price_source?: PriceSource;
  price_fetched_at?: string | null;
  price_was_manually_corrected?: boolean;
}

/** A product variant found when scanning a barcode (Open Food Facts / local catalog). */
export interface ProductLookup {
  name: string;
  brand?: string | null;
  category?: string | null;
  image_url?: string | null;
  quantity?: string | null;
  unit?: string | null;
  source: "catalog" | "openfoodfacts";
}

/** Result of an automatic price lookup (Coop.fi / S-Kaupat). */
export interface PriceLookupResult {
  found: boolean;
  price?: number;
  currency?: string;
  name?: string;
  brand?: string | null;
  category?: string | null;
  image_url?: string | null;
  source: PriceSource;
  fetchedAt?: string;
  /** True when the value came from the local cache instead of a live lookup. */
  cached?: boolean;
}

/** Local user catalog entry (barcode → product identity). */
export interface ProductCatalogItem {
  id: string;
  user_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  quantity: string | null;
  unit: string | null;
  source: "openfoodfacts" | "manual";
  created_at: string;
  updated_at: string;
}

/** Web Push subscription row. */
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  notification_enabled: boolean;
  default_expiry_offset_days: number;
  created_at: string;
}

/** Aggregate waste statistics. */
export interface WasteStats {
  /** Total waste value across all time. */
  total: number;
  /** Waste value for the current calendar month. */
  month: number;
  /** Waste value for the current calendar year. */
  year: number;
  /** Total number of wasted items. */
  count: number;
  /** Average value per wasted item. */
  average: number;
  /** Waste as a percentage of all registered spending. */
  percentOfSpent: number;
  /** Wasted items grouped by category (sorted by value, desc). */
  byCategory: { category: string; value: number; count: number }[];
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
}