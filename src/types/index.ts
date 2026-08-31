/**
 * Domain types for the app. These mirror the Supabase schema (see
 * supabase/migrations) but stay independent from generated database types so
 * the frontend can run even before `supabase gen types` is executed.
 */

export type ProductStatus = "active" | "finished" | "expired" | "wasted";

/**
 * Source of a price value.
 * `s-kaupat` is LEGACY: kept in the union only to read historical rows saved
 * before the S-Kaupat (Finnish) source was removed — never written anymore.
 */
export type PriceSource = "s-kaupat" | "openfoodfacts" | "manual" | "none" | "unknown";

/** How a product / purchase was entered into the app. */
export type ImportMethod = "barcode" | "receipt_barcode" | "ocr" | "manual";

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
  /** Physical units bought (3 milk cartons → 3). Waste is quantity-aware. */
  quantity_count: number;
  /** Units already consumed (0..quantity_count). */
  consumed_count: number;
  /** Free-text notes entered by the user. */
  notes: string | null;
  /** How the product was entered (barcode / receipt_barcode / ocr / manual). */
  import_method: ImportMethod;
  /** Purchase that produced this product, when imported from a receipt. */
  purchase_id: string | null;
  purchase_date: string | null;
  /** Null when the expiry is unknown (e.g. receipt imports) — never invented. */
  expiration_date: string | null;
  /** Unit price actually paid (€). */
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
  /** Physical units bought (default 1). */
  quantity_count?: number;
  /** Units already consumed (default 0). */
  consumed_count?: number;
  notes?: string | null;
  import_method?: ImportMethod;
  purchase_id?: string | null;
  purchase_date?: string | null;
  /** Null when unknown (receipt import): the user sets it later. */
  expiration_date: string | null;
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
  /** Total number of wasted product rows. */
  count: number;
  /** Total number of wasted physical units (quantity-aware). */
  units: number;
  /** Average value per wasted item. */
  average: number;
  /** Waste as a percentage of all registered spending. */
  percentOfSpent: number;
  /** Wasted items grouped by category (sorted by value, desc). */
  byCategory: { category: string; value: number; count: number }[];
  /** Single product with the highest waste value (by units remaining). */
  topProduct: { name: string; value: number } | null;
}

/** One shopping trip imported from a receipt or entered manually. */
export interface Purchase {
  id: string;
  user_id: string;
  store: string | null;
  purchase_date: string;
  total: number | null;
  import_method: ImportMethod;
  receipt_identifier: string | null;
  created_at: string;
  updated_at: string;
}

/** One line of a purchase (receipt row). */
export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
}

/** A single parsed receipt line (OCR output, pre-confirmation). */
export interface ReceiptLine {
  name: string;
  /** Number of units bought. */
  quantity: number;
  /** Unit price (€). */
  unitPrice: number;
  /** Line total (€) = quantity × unitPrice when both known. */
  totalPrice: number;
  barcode?: string | null;
}

/** Parsed receipt: lines + optional envelope data (date, store, total). */
export interface ParsedReceipt {
  lines: ReceiptLine[];
  total: number | null;
  purchaseDate: string | null;
  store: string | null;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
}