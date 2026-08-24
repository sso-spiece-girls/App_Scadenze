import { describe, expect, it } from "vitest";
import { computeCheckDigit, expandUpcE, normalizeBarcode, validateBarcode } from "./barcode";

describe("computeCheckDigit", () => {
  it("returns the correct EAN-13 check digit", () => {
    expect(computeCheckDigit("123456789012")).toBe(0);
  });

  it("returns -1 for non-digit payloads", () => {
    expect(computeCheckDigit("1234a6789012")).toBe(-1);
  });
});

describe("validateBarcode", () => {
  it("accepts a valid EAN-13", () => {
    const info = validateBarcode("1234567890120");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("EAN-13");
    expect(info.gtin).toBe("1234567890120");
  });

  it("rejects an EAN-13 with a wrong check digit", () => {
    expect(validateBarcode("1234567890121").valid).toBe(false);
  });

  it("accepts a valid EAN-8", () => {
    const info = validateBarcode("12345678");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("EAN-8");
  });

  it("accepts a valid UPC-A", () => {
    const info = validateBarcode("123456789014");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("UPC-A");
  });

  it("accepts a valid UPC-E and expands it to a 12-digit GTIN", () => {
    const info = validateBarcode("042526");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("UPC-E");
    expect(info.gtin).toHaveLength(12);
  });

  it("accepts Code 128 printable strings", () => {
    expect(validateBarcode("T4T-1234").valid).toBe(true);
    // All-digit strings of length >= 4 are also valid Code 128.
    expect(validateBarcode("12345").valid).toBe(true);
  });

  it("rejects garbage and empty strings", () => {
    expect(validateBarcode("").valid).toBe(false);
    expect(validateBarcode("12").valid).toBe(false);
  });
});

describe("expandUpcE", () => {
  it("expands a known example correctly (123456 → 012345000007)", () => {
    expect(expandUpcE("123456")).toBe("012345000007");
  });

  it("always produces a valid UPC-A (with correct check digit)", () => {
    for (const code of ["042526", "112233", "100001", "012345"]) {
      const expanded = expandUpcE(code);
      expect(expanded).toHaveLength(12);
      expect(validateBarcode(expanded).valid).toBe(true);
    }
  });
});

describe("normalizeBarcode", () => {
  it("strips leading zeroes from GTINs", () => {
    expect(normalizeBarcode("008001505005707")).toBe("8001505005707");
  });

  it("keeps short codes untouched", () => {
    expect(normalizeBarcode("123456")).toBe("123456");
  });
});