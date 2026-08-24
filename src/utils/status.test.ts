import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { parseDateOnly } from "./date";
import { computeEffectiveStatus, decorateProducts, filterProducts } from "./status";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    user_id: "u1",
    barcode: "1234567890123",
    name: "Prodotto di test",
    brand: null,
    category: null,
    image_url: null,
    quantity: null,
    unit: null,
    purchase_date: null,
    expiration_date: "2026-08-30",
    price: 2.5,
    price_source: "manual",
    price_fetched_at: null,
    price_was_manually_corrected: false,
    status: "active",
    notification_7_days_sent: false,
    finished_at: null,
    wasted_at: null,
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:00Z",
    ...overrides,
  };
}

// Fixed reference "today" so tests are deterministic.
const TODAY = parseDateOnly("2026-08-23");

describe("computeEffectiveStatus", () => {
  it("keeps finished products finished even past expiration", () => {
    const p = makeProduct({ status: "finished", expiration_date: "2026-08-01" });
    expect(computeEffectiveStatus(p, TODAY)).toBe("finished");
  });

  it("keeps products with a future expiration active", () => {
    const p = makeProduct({ expiration_date: "2026-08-30" });
    expect(computeEffectiveStatus(p, TODAY)).toBe("active");
  });

  it("marks a product as expired the day after expiration (inside grace)", () => {
    const p = makeProduct({ expiration_date: "2026-08-22" }); // yesterday
    expect(computeEffectiveStatus(p, TODAY)).toBe("expired");
  });

  it("accounts a product as wasted once the grace period is over", () => {
    // WASTE_GRACE_DAYS = 1 → wasted from expiration - 2 days.
    const p = makeProduct({ expiration_date: "2026-08-21" }); // 2 days ago
    expect(computeEffectiveStatus(p, TODAY)).toBe("wasted");
  });

  it("keeps an explicitly wasted product wasted regardless of dates", () => {
    const p = makeProduct({ status: "wasted", wasted_at: "2026-08-01T00:00:00Z", expiration_date: "2026-09-30" });
    expect(computeEffectiveStatus(p, TODAY)).toBe("wasted");
  });
});

describe("decorateProducts", () => {
  it("adds effectiveStatus and daysUntil", () => {
    const decorated = decorateProducts(
      [
        makeProduct({ expiration_date: "2026-08-30" }),
        makeProduct({ id: "p2", expiration_date: "2026-08-21" }),
      ],
      TODAY,
    );
    expect(decorated).toHaveLength(2);
    expect(decorated[0]).toMatchObject({ effectiveStatus: "active", daysUntil: 7 });
    expect(decorated[1]).toMatchObject({ effectiveStatus: "wasted", daysUntil: -2 });
  });
});

describe("filterProducts", () => {
  const decorated = decorateProducts(
    [
      makeProduct({ id: "a", expiration_date: "2026-08-23" }), // today → active, expiring
      makeProduct({ id: "b", expiration_date: "2026-08-30" }), // +7 → active, expiring
      makeProduct({ id: "c", expiration_date: "2026-08-31" }), // +8 → active, NOT expiring
      makeProduct({ id: "d", expiration_date: "2026-08-22" }), // expired
      makeProduct({ id: "e", expiration_date: "2026-08-21" }), // wasted
      makeProduct({ id: "f", status: "finished", expiration_date: "2026-08-01" }), // finished
    ],
    TODAY,
  );

  it("returns everything for 'all'", () => {
    expect(filterProducts(decorated, "all")).toHaveLength(6);
  });

  it("keeps only active products for 'active'", () => {
    const result = filterProducts(decorated, "active");
    expect(result.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps active products within the 7-day window for 'expiring' (inclusive)", () => {
    const result = filterProducts(decorated, "expiring");
    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps only expired (not yet wasted) products for 'expired'", () => {
    const result = filterProducts(decorated, "expired");
    expect(result.map((p) => p.id)).toEqual(["d"]);
  });

  it("keeps only wasted products for 'wasted'", () => {
    const result = filterProducts(decorated, "wasted");
    expect(result.map((p) => p.id)).toEqual(["e"]);
  });

  it("keeps only finished products for 'finished'", () => {
    const result = filterProducts(decorated, "finished");
    expect(result.map((p) => p.id)).toEqual(["f"]);
  });
});