import type { Product, WasteStats } from "../types";
import { wasteValueOf } from "../utils/status";
import { toDateOnly, todayLocal } from "../utils/date";
import { roundMoney } from "../utils/money";

/**
 * wasteService — pure functions that compute waste aggregates from a product
 * list. Kept framework-free so it can be unit tested.
 */

const isSameMonth = (dateOnly: string, ref: Date) => {
  const [y, m] = dateOnly.split("-").map(Number);
  return y === ref.getFullYear() && m === ref.getMonth() + 1;
};

const isSameYear = (dateOnly: string, ref: Date) => {
  const y = Number(dateOnly.split("-")[0]);
  return y === ref.getFullYear();
};

/** Compute waste stats for a list of products, relative to `ref` (default today). */
export function computeWasteStats(products: Product[], ref: Date = todayLocal()): WasteStats {
  const wasted = products.filter((p) => wasteValueOf(p, ref) > 0);
  const total = wasted.reduce((sum, p) => sum + p.price, 0);

  // Attribution date: prefer the wasted_at date; fall back to expiration date.
  const attribution = (p: Product): string => (p.wasted_at ? toDateOnly(new Date(p.wasted_at)) : p.expiration_date);

  const month = wasted
    .filter((p) => isSameMonth(attribution(p), ref))
    .reduce((sum, p) => sum + p.price, 0);

  const year = wasted
    .filter((p) => isSameYear(attribution(p), ref))
    .reduce((sum, p) => sum + p.price, 0);

  // Total registered spending (all products, any status).
  const spent = products.reduce((sum, p) => sum + p.price, 0);

  // By category.
  const byCategoryMap = new Map<string, { value: number; count: number }>();
  for (const p of wasted) {
    const key = p.category ?? "Altro";
    const entry = byCategoryMap.get(key) ?? { value: 0, count: 0 };
    entry.value += p.price;
    entry.count += 1;
    byCategoryMap.set(key, entry);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, v]) => ({ category, value: roundMoney(v.value), count: v.count }))
    .sort((a, b) => b.value - a.value);

  return {
    total: roundMoney(total),
    month: roundMoney(month),
    year: roundMoney(year),
    count: wasted.length,
    average: wasted.length > 0 ? roundMoney(total / wasted.length) : 0,
    percentOfSpent: spent > 0 ? (total / spent) * 100 : 0,
    byCategory,
  };
}

/** Sorted list of wasted products (most recent attribution first). */
export function wastedProducts(products: Product[], ref: Date = todayLocal()): Product[] {
  return products
    .filter((p) => wasteValueOf(p, ref) > 0)
    .sort((a, b) => {
      const dateA = a.wasted_at ?? a.expiration_date;
      const dateB = b.wasted_at ?? b.expiration_date;
      return dateB.localeCompare(dateA);
    });
}

/** Total value of all registered purchases (for "% della spesa registrata"). */
export function totalSpent(products: Product[]): number {
  return roundMoney(products.reduce((sum, p) => sum + p.price, 0));
}