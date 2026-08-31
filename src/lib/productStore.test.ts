import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { ProductStore, shouldRefresh, PRODUCTS_TTL_MS } from "./productStore";

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    user_id: "u1",
    barcode: "8001120666826",
    name: `Prodotto ${id}`,
    brand: null,
    category: null,
    image_url: null,
    quantity: null,
    unit: null,
    quantity_count: 1,
    consumed_count: 0,
    notes: null,
    import_method: "manual",
    purchase_id: null,
    purchase_date: null,
    expiration_date: "2026-09-01",
    price: 1.5,
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

describe("ProductStore — session cache semantics", () => {
  it("renders cached data immediately after a load (no refetch on 'navigation')", () => {
    const store = new ProductStore({ now: () => 1000 });
    const p = makeProduct("a");
    store.replaceAll("u1", [p], 1000);
    // A second "mount" reads the snapshot without touching the data.
    expect(store.getSnapshot().products).toEqual([p]);
    expect(store.getSnapshot().loadedAt).toBe(1000);
    expect(store.isStale(PRODUCTS_TTL_MS)).toBe(false);
  });

  it("is stale when the TTL elapsed (background refresh trigger)", () => {
    let clock = 1000;
    const store = new ProductStore({ now: () => clock });
    store.replaceAll("u1", [makeProduct("a")], clock);
    expect(store.isStale(PRODUCTS_TTL_MS)).toBe(false);
    clock += PRODUCTS_TTL_MS + 1;
    expect(store.isStale(PRODUCTS_TTL_MS)).toBe(true);
  });

  it("clears the cache when the session changes (per-user isolation)", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.setSession("u2");
    expect(store.getSnapshot().products).toHaveLength(0);
    expect(store.getSnapshot().userId).toBe("u2");
    expect(store.getSnapshot().loadedAt).toBeNull();
  });

  it("clears everything on logout", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.clear();
    expect(store.getSnapshot()).toMatchObject({ products: [], userId: null, loadedAt: null, error: null });
  });

  it("notifies listeners so mounted pages re-render", () => {
    const store = new ProductStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.upsertLocal(makeProduct("b"));
    expect(calls).toBe(2);
  });

  it("sorts by expiration with unknown expiries last", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [
      makeProduct("late", { expiration_date: null }),
      makeProduct("soon", { expiration_date: "2026-08-30" }),
      makeProduct("later", { expiration_date: "2026-09-10" }),
    ], 1000);
    expect(store.getSnapshot().products.map((p) => p.id)).toEqual(["soon", "later", "late"]);
  });
});

describe("ProductStore — realtime events applied directly (no refetch)", () => {
  it("INSERT adds the row", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.applyEvent({ eventType: "INSERT", newRow: makeProduct("b") }, "u1");
    expect(store.getSnapshot().products.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("INSERT with an existing id upserts (dedupe)", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a", { price: 1 })], 1000);
    store.applyEvent({ eventType: "INSERT", newRow: makeProduct("a", { price: 9 }) }, "u1");
    expect(store.getSnapshot().products).toHaveLength(1);
    expect(store.getSnapshot().products[0].price).toBe(9);
  });

  it("UPDATE merges the row (server truth reconciliation)", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a", { status: "active" })], 1000);
    store.applyEvent({ eventType: "UPDATE", newRow: makeProduct("a", { status: "wasted" }), oldRow: makeProduct("a") }, "u1");
    expect(store.getSnapshot().products[0].status).toBe("wasted");
  });

  it("DELETE removes the row", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a"), makeProduct("b")], 1000);
    store.applyEvent({ eventType: "DELETE", oldRow: { id: "a" } }, "u1");
    expect(store.getSnapshot().products.map((p) => p.id)).toEqual(["b"]);
  });

  it("ignores events for other users", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.applyEvent({ eventType: "INSERT", newRow: makeProduct("b", { user_id: "u2" }) }, "u1");
    expect(store.getSnapshot().products.map((p) => p.id)).toEqual(["a"]);
  });

  it("does not trigger a full reload: loadedAt stays untouched", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.applyEvent({ eventType: "UPDATE", newRow: makeProduct("a", { price: 5 }), oldRow: makeProduct("a") }, "u1");
    expect(store.getSnapshot().loadedAt).toBe(1000);
  });
});

describe("ProductStore — optimistic mutations", () => {
  it("upsertLocal / updateLocal / removeLocal keep the UI instant", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [makeProduct("a")], 1000);
    store.updateLocal("a", { status: "finished", consumed_count: 1 });
    expect(store.getSnapshot().products[0].status).toBe("finished");
    store.removeLocal("a");
    expect(store.getSnapshot().products).toHaveLength(0);
  });

  it("findExistingByBarcode excludes finished products", () => {
    const store = new ProductStore();
    store.replaceAll("u1", [
      makeProduct("a", { barcode: "X" }),
      makeProduct("b", { barcode: "X", status: "finished" }),
    ], 1000);
    expect(store.findExistingByBarcode("X").map((p) => p.id)).toEqual(["a"]);
  });
});

describe("shouldRefresh", () => {
  it("returns true when there is no data yet", () => {
    expect(shouldRefresh({ loadedAt: null, products: [] }, PRODUCTS_TTL_MS, Date.now())).toBe(true);
  });

  it("returns false for a fresh cache", () => {
    expect(shouldRefresh({ loadedAt: 1000, products: [{ id: "x" } as Product] }, PRODUCTS_TTL_MS, 1000 + PRODUCTS_TTL_MS)).toBe(false);
  });

  it("returns true after the TTL", () => {
    expect(shouldRefresh({ loadedAt: 1000, products: [{ id: "x" } as Product] }, PRODUCTS_TTL_MS, 1000 + PRODUCTS_TTL_MS + 1)).toBe(true);
  });
});