import type { Product, WasteStats } from "../types";
import { wasteValueOf } from "../utils/status";
import { toDateOnly, todayLocal } from "../utils/date";
import { roundMoney } from "../utils/money";

/**
 * wasteService — pure functions that compute waste aggregates from a product
 * list. Kept framework-free so it can be unit tested.
 *
 * Quantity-aware: `price` is the unit price, so the loss of a product row is
 * price × remaining units (quantity_count − consumed_count).
 */

const isSameMonth = (dateOnly: string, ref: Date) => {
  const [y, m] = dateOnly.split("-").map(Number);
  return y === ref.getFullYear() && m === ref.getMonth() + 1;
};

const isSameYear = (dateOnly: string, ref: Date) => {
  const y = Number(dateOnly.split("-")[0]);
  return y === ref.getFullYear();
};

/** Remaining (not consumed) units of a product. */
export function remainingUnits(p: Product): number {
  const total = p.quantity_count ?? 1;
  const consumed = Math.min(p.consumed_count ?? 0, total);
  return Math.max(0, total - consumed);
}

/** Compute waste stats for a list of products, relative to `ref` (default today). */
export function computeWasteStats(products: Product[], ref: Date = todayLocal()): WasteStats {
  const wasted = products.filter((p) => wasteValueOf(p, ref) > 0);

  const valueOf = (p: Product) => wasteValueOf(p, ref);
  const total = wasted.reduce((sum, p) => sum + valueOf(p), 0);
  const units = wasted.reduce((sum, p) => sum + remainingUnits(p), 0);

  // Attribution date: prefer the wasted_at date; fall back to the expiration
  // date, and finally to the creation date (products without expiry).
  const attribution = (p: Product): string => {
    if (p.wasted_at) return toDateOnly(new Date(p.wasted_at));
    if (p.expiration_date) return p.expiration_date;
    return toDateOnly(new Date(p.created_at));
  };

  const month = wasted
    .filter((p) => isSameMonth(attribution(p), ref))
    .reduce((sum, p) => sum + valueOf(p), 0);

  const year = wasted
    .filter((p) => isSameYear(attribution(p), ref))
    .reduce((sum, p) => sum + valueOf(p), 0);

  // Total registered spending (all products, any status, quantity-aware).
  const spent = products.reduce((sum, p) => sum + p.price * (p.quantity_count ?? 1), 0);

  // By category.
  const byCategoryMap = new Map<string, { value: number; count: number }>();
  for (const p of wasted) {
    const key = p.category ?? "Altro";
    const entry = byCategoryMap.get(key) ?? { value: 0, count: 0 };
    entry.value += valueOf(p);
    entry.count += remainingUnits(p);
    byCategoryMap.set(key, entry);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, v]) => ({ category, value: roundMoney(v.value), count: v.count }))
    .sort((a, b) => b.value - a.value);

  // Single product with the highest loss.
  let topProduct: WasteStats["topProduct"] = null;
  for (const p of wasted) {
    const v = roundMoney(valueOf(p));
    if (!topProduct || v > topProduct.value) {
      topProduct = { name: p.name, value: v };
    }
  }

  return {
    total: roundMoney(total),
    month: roundMoney(month),
    year: roundMoney(year),
    count: wasted.length,
    units,
    average: wasted.length > 0 ? roundMoney(total / wasted.length) : 0,
    percentOfSpent: spent > 0 ? (total / spent) * 100 : 0,
    byCategory,
    topProduct,
  };
}

/** Sorted list of wasted products (most recent attribution first). */
export function wastedProducts(products: Product[], ref: Date = todayLocal()): Product[] {
  return products
    .filter((p) => wasteValueOf(p, ref) > 0)
    .sort((a, b) => {
      const dateA = a.wasted_at ?? a.expiration_date ?? a.created_at;
      const dateB = b.wasted_at ?? b.expiration_date ?? b.created_at;
      return dateB.localeCompare(dateA);
    });
}

/** Total value of all registered purchases (for "% della spesa registrata"). */
export function totalSpent(products: Product[]): number {
  return roundMoney(products.reduce((sum, p) => sum + p.price * (p.quantity_count ?? 1), 0));
}