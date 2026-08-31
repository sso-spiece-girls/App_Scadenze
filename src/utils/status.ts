import type { EffectiveStatus, Product, ProductStatus, ProductWithStatus } from "../types";
import { EXPIRY_WINDOW_DAYS, WASTE_GRACE_DAYS } from "../lib/constants";
import { daysUntil, todayLocal } from "./date";

/**
 * Computes the effective status of a product at display time.
 *
 * The database persists a status that is advanced asynchronously by the daily
 * maintenance Edge Function. To avoid a product briefly showing the wrong
 * state before the cron runs, this function derives the "truth" from the
 * dates themselves. The thresholds here MUST match supabase/functions/mark-expired:
 *
 *  - a product whose expiration date has passed (daysUntil < 0) is `expired`;
 *  - once `WASTE_GRACE_DAYS` have passed beyond the expiration date it is
 *    accounted as `wasted` (its price counts toward waste totals).
 */
export function computeEffectiveStatus(
  product: Pick<Product, "status" | "expiration_date" | "wasted_at">,
  today: Date = new Date(),
): EffectiveStatus {
  const d = daysUntil(product.expiration_date, today);
  if (product.status === "finished") return "finished";
  if (product.status === "wasted" || product.wasted_at) return "wasted";
  // Unknown expiry (null) → never auto-expires; the user decides manually.
  if (product.status === "expired" || (product.expiration_date && d < 0)) {
    return d <= -WASTE_GRACE_DAYS - 1 ? "wasted" : "expired";
  }
  return "active";
}

/**
 * True when a product counts toward waste totals (its value is lost).
 * Same thresholds as the maintenance function: expiration date reached and at
 * least WASTE_GRACE_DAYS passed beyond it.
 */
export function isWastedProduct(
  product: Pick<Product, "status" | "expiration_date" | "wasted_at">,
  today: Date = new Date(),
): boolean {
  const d = daysUntil(product.expiration_date, today);
  if (product.status === "finished") return false;
  if (product.status === "wasted" || product.wasted_at) return true;
  if (!product.expiration_date) return false; // unknown expiry → never auto-wasted
  return d <= -WASTE_GRACE_DAYS - 1;
}

/**
 * Value of the waste produced by a product (0 unless it is wasted).
 * Quantity-aware: only the units not yet consumed count toward the loss.
 * `price` is the unit price, so waste = price × remaining units.
 */
export function wasteValueOf(product: Product, today: Date = new Date()): number {
  if (!isWastedProduct(product, today)) return 0;
  const total = product.quantity_count ?? 1;
  const consumed = Math.min(product.consumed_count ?? 0, total);
  return product.price * Math.max(0, total - consumed);
}

export function isActiveStatus(status: ProductStatus): boolean {
  return status === "active";
}

// ---------------------------------------------------------------------------
// Render-time decoration + list filtering (used by the pages)
// ---------------------------------------------------------------------------

/** Filters available on the products list. */
export type ProductFilter = "all" | "active" | "expiring" | "expired" | "wasted" | "finished" | "noexpiry";

/** Adds the render-time effective status and days-until to a product. */
export function decorateProduct(product: Product, today: Date = todayLocal()): ProductWithStatus {
  return {
    ...product,
    effectiveStatus: computeEffectiveStatus(product, today),
    daysUntil: daysUntil(product.expiration_date, today),
  };
}

/** Maps a product list to its decorated (render-time) form. */
export function decorateProducts(products: Product[], today: Date = todayLocal()): ProductWithStatus[] {
  return products.map((p) => decorateProduct(p, today));
}

/**
 * Applies a status filter to decorated products. "expiring" means active and
 * falling within EXPIRY_WINDOW_DAYS (inclusive, 0 = today).
 */
export function filterProducts(products: ProductWithStatus[], filter: ProductFilter): ProductWithStatus[] {
  switch (filter) {
    case "active":
      return products.filter((p) => p.effectiveStatus === "active");
    case "expiring":
      return products.filter(
        (p) => p.effectiveStatus === "active" && p.daysUntil >= 0 && p.daysUntil <= EXPIRY_WINDOW_DAYS,
      );
    case "expired":
      return products.filter((p) => p.effectiveStatus === "expired");
    case "wasted":
      return products.filter((p) => p.effectiveStatus === "wasted");
    case "finished":
      return products.filter((p) => p.effectiveStatus === "finished");
    case "noexpiry":
      return products.filter((p) => !p.expiration_date && p.effectiveStatus !== "finished");
    default:
      return products;
  }
}