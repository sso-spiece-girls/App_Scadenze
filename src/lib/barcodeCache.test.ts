import { describe, expect, it } from "vitest";
import { BarcodeCache, BARCODE_CACHE_TTL_MS } from "./barcodeCache";

describe("BarcodeCache — session barcode resolution cache", () => {
  it("serves a cached resolution with zero network (hit)", () => {
    const cache = new BarcodeCache({ now: () => 1000 });
    cache.set("8001120666826", { lookup: { name: "Latte", source: "openfoodfacts" }, source: "openfoodfacts" });
    const hit = cache.get("8001120666826");
    expect(hit?.lookup?.name).toBe("Latte");
  });

  it("returns null for an unknown barcode (miss)", () => {
    const cache = new BarcodeCache();
    expect(cache.get("8001120666826")).toBeNull();
  });

  it("caches misses too, so unknown barcodes are not re-queried", () => {
    const cache = new BarcodeCache({ now: () => 1000 });
    cache.set("0000000000000", { lookup: null, source: "none" });
    const hit = cache.get("0000000000000");
    expect(hit).not.toBeNull();
    expect(hit?.lookup).toBeNull();
    expect(hit?.source).toBe("none");
  });

  it("expires entries after the TTL", () => {
    let clock = 1000;
    const cache = new BarcodeCache({ now: () => clock });
    cache.set("8001120666826", { lookup: { name: "Latte", source: "openfoodfacts" }, source: "openfoodfacts" });
    expect(cache.get("8001120666826")).not.toBeNull();
    clock += BARCODE_CACHE_TTL_MS + 1;
    expect(cache.get("8001120666826")).toBeNull();
  });

  it("clears on logout", () => {
    const cache = new BarcodeCache();
    cache.set("8001120666826", { lookup: { name: "Latte", source: "openfoodfacts" }, source: "openfoodfacts" });
    cache.clear();
    expect(cache.get("8001120666826")).toBeNull();
  });

  it("stays bounded (evicts oldest entries)", () => {
    const cache = new BarcodeCache({ now: () => 1000 });
    for (let i = 0; i < 600; i++) {
      cache.set(String(i).padStart(13, "0"), { lookup: null, source: "none" });
    }
    // The first inserted entry was evicted once the size cap was hit.
    expect(cache.get("0000000000000")).toBeNull();
  });
});