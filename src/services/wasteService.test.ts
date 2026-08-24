import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { parseDateOnly } from "../utils/date";
import { wasteValueOf } from "../utils/status";
import { computeWasteStats, totalSpent, wastedProducts } from "./wasteService";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p",
    user_id: "u1",
    barcode: "1234567890123",
    name: "Prodotto",
    brand: null,
    category: null,
    image_url: null,
    quantity: null,
    unit: null,
    purchase_date: null,
    expiration_date: "2026-08-30",
    price: 2,
    price_source: "manual",
    price_fetched_at: null,
    price_was_manually_corrected: false,
    status: "active",
    notification_7_days_sent: false,
    finished_at: null,
    wasted_at: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

const REF = parseDateOnly("2026-08-23");

describe("wasteValueOf", () => {
  it("counts nothing for finished or active products", () => {
    expect(wasteValueOf(makeProduct({ status: "finished", price: 3 }), REF)).toBe(0);
    expect(wasteValueOf(makeProduct({ status: "active", expiration_date: "2026-09-01", price: 3 }), REF)).toBe(0);
  });

  it("counts the full price of an explicitly wasted product", () => {
    const p = makeProduct({ status: "wasted", wasted_at: "2026-08-10T00:00:00Z", price: 1.5 });
    expect(wasteValueOf(p, REF)).toBe(1.5);
  });

  it("counts an expired product once the grace period is over", () => {
    // expiration 2026-08-21 → daysUntil -2 → beyond the 1-day grace.
    const p = makeProduct({ status: "expired", expiration_date: "2026-08-21", price: 2.2 });
    expect(wasteValueOf(p, REF)).toBe(2.2);
  });

  it("does NOT count an expired product still inside the grace period", () => {
    const p = makeProduct({ status: "expired", expiration_date: "2026-08-22", price: 4 });
    expect(wasteValueOf(p, REF)).toBe(0);
  });
});

describe("computeWasteStats", () => {
  const products = [
    makeProduct({ id: "a", status: "finished", price: 2, category: "Latticini e uova" }),
    makeProduct({ id: "b", status: "active", expiration_date: "2026-09-01", price: 3 }),
    makeProduct({ id: "c", status: "wasted", wasted_at: "2026-08-10T00:00:00Z", price: 1.5, category: "Latticini e uova" }),
    makeProduct({ id: "d", status: "expired", expiration_date: "2026-08-21", price: 2.2, category: "Carne" }),
    makeProduct({ id: "e", status: "expired", expiration_date: "2026-08-22", price: 4, category: "Carne" }),
  ];

  const stats = computeWasteStats(products, REF);

  it("totals only wasted values", () => {
    expect(stats.total).toBe(3.7); // 1.5 + 2.2
    expect(stats.count).toBe(2);
  });

  it("attributes to the current month and year", () => {
    expect(stats.month).toBe(3.7);
    expect(stats.year).toBe(3.7);
  });

  it("computes the average per wasted product", () => {
    expect(stats.average).toBe(1.85);
  });

  it("computes the waste percentage over all registered spending", () => {
    const spent = 2 + 3 + 1.5 + 2.2 + 4;
    expect(totalSpent(products)).toBe(spent);
    expect(stats.percentOfSpent).toBeCloseTo((3.7 / spent) * 100, 1);
  });

  it("groups by category, sorted by value descending", () => {
    expect(stats.byCategory).toEqual([
      { category: "Carne", value: 2.2, count: 1 },
      { category: "Latticini e uova", value: 1.5, count: 1 },
    ]);
  });
});

describe("wastedProducts", () => {
  it("returns only wasted products sorted by attribution date (most recent first)", () => {
    const products = [
      makeProduct({ id: "old", status: "wasted", wasted_at: "2026-08-10T00:00:00Z", expiration_date: "2026-08-10", price: 1 }),
      makeProduct({ id: "recent", status: "expired", expiration_date: "2026-08-21", price: 2 }),
      makeProduct({ id: "active", status: "active", expiration_date: "2026-09-01", price: 3 }),
    ];
    const list = wastedProducts(products, REF);
    expect(list.map((p) => p.id)).toEqual(["recent", "old"]);
  });
});