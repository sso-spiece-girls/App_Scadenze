import { describe, expect, it } from "vitest";
import { computeCheckDigit, expandUpcE, normalizeBarcode, validateBarcode } from "./barcode";

/**
 * All check digits in this file are computed with the GS1 algorithm
 * (rightmost digit ×3, alternating 3/1 from the right) and cross-checked
 * against known public examples (Wikipedia EAN-13 5901234123457,
 * UPC-A 036000291452, EAN-8 96385074).
 */

describe("computeCheckDigit", () => {
  it("returns the GS1 check digit for the reported EAN-13 (800112066682 → 6)", () => {
    expect(computeCheckDigit("800112066682")).toBe(6);
  });

  it("matches known GS1 examples", () => {
    expect(computeCheckDigit("590123412345")).toBe(7); // EAN-13 5901234123457
    expect(computeCheckDigit("9638507")).toBe(4); // EAN-8 96385074
    expect(computeCheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
  });

  it("returns -1 for non-digit payloads", () => {
    expect(computeCheckDigit("1234a6789012")).toBe(-1);
  });
});

describe("validateBarcode", () => {
  it("accepts 8001120666826 as a valid EAN-13 (the reported case)", () => {
    const info = validateBarcode("8001120666826");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("EAN-13");
    expect(info.gtin).toBe("8001120666826");
  });

  it("accepts the classic EAN-13 5901234123457", () => {
    expect(validateBarcode("5901234123457")).toMatchObject({ valid: true, format: "EAN-13" });
  });

  it("rejects an EAN-13 with a wrong check digit", () => {
    // Same payload as 8001120666826 but check digit 5 instead of 6.
    expect(validateBarcode("8001120666825").valid).toBe(false);
    expect(validateBarcode("5901234123458").valid).toBe(false);
  });

  it("accepts a valid EAN-13 that is NOT present in any database", () => {
    // Validator acceptance and product lookup are separate concerns: this
    // code passes validation; the "Prodotto non trovato" message comes from
    // the lookup flow (lookupProduct → source "none"), not from the validator.
    const info = validateBarcode("1234567890128");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("EAN-13");
  });

  it("accepts a valid EAN-8", () => {
    const info = validateBarcode("96385074");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("EAN-8");
    expect(validateBarcode("96385075").valid).toBe(false); // wrong check digit
  });

  it("accepts a valid UPC-A", () => {
    const info = validateBarcode("036000291452");
    expect(info.valid).toBe(true);
    expect(info.format).toBe("UPC-A");
    expect(validateBarcode("036000291453").valid).toBe(false); // wrong check digit
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

describe("leading zeros", () => {
  it("normalizes an EAN-13 with leading zero to its UPC-A form and validates it", () => {
    // "0036000291452" is the EAN-13 encoding of UPC-A 036000291452.
    const normalized = normalizeBarcode("0036000291452");
    expect(normalized).toBe("036000291452");
    expect(validateBarcode(normalized).valid).toBe(true);
    expect(validateBarcode(normalized).format).toBe("UPC-A");
  });

  it("keeps a barcode without leading zeros untouched", () => {
    expect(normalizeBarcode("8001120666826")).toBe("8001120666826");
    expect(validateBarcode(normalizeBarcode("8001120666826")).valid).toBe(true);
  });
});

describe("expandUpcE", () => {
  it("expands a known example correctly (123456 → 012345000003)", () => {
    expect(expandUpcE("123456")).toBe("012345000003");
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