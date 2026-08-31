import { describe, expect, it } from "vitest";
import { normalizeReceiptDate, parseReceiptText, receiptLooksReliable } from "./receiptParser";

describe("parseReceiptText", () => {
  it("parses an Unicoop Firenze receipt with quantity + unit price + total", () => {
    const text = `UNICOOP FIRENZE
VIA ROMA 12
29/08/2026 14:32
LATTE GRANAROLO 1L        2    1,49    2,98
PASTA BARILLA N.5         1    1,29    1,29
MOZZARELLA GALBANI        2    1,99    3,98
TOTALE                    8,25
CONTANTI                  8,25
IVA 4%                    0,31`;

    const parsed = parseReceiptText(text);
    expect(parsed.store).toMatch(/UNICOOP/i);
    expect(parsed.purchaseDate).toBe("2026-08-29");
    expect(parsed.total).toBe(8.25);
    expect(parsed.lines).toHaveLength(3);

    const [latte, pasta, mozzarella] = parsed.lines;
    expect(latte).toMatchObject({ name: "LATTE GRANAROLO 1L", quantity: 2, unitPrice: 1.49, totalPrice: 2.98 });
    expect(pasta).toMatchObject({ name: "PASTA BARILLA N.5", quantity: 1, unitPrice: 1.29, totalPrice: 1.29 });
    expect(mozzarella).toMatchObject({ name: "MOZZARELLA GALBANI", quantity: 2, unitPrice: 1.99, totalPrice: 3.98 });
  });

  it("parses an Italian receipt with pack quantities ('2 x' and '2kpl 1+1')", () => {
    const text = `COOP.FI
P.IVA 00123456789
29.08.2026 18:07
LATTE GRANAROLO 1L              1,59    1,59
CAFFE' LAVAZZA 2x250G           2 x 4,95    9,90
ACQUA NATURALE 1,5L          2,85    2,85
TOTALE                14,34
BANCOMAT                 14,34`;

    const parsed = parseReceiptText(text);
    expect(parsed.store).toMatch(/COOP/i);
    expect(parsed.purchaseDate).toBe("2026-08-29");
    expect(parsed.total).toBe(14.34);
    expect(parsed.lines).toHaveLength(3);

    const [latte, caffe, acqua] = parsed.lines;
    expect(latte).toMatchObject({ name: "LATTE GRANAROLO 1L", quantity: 1, unitPrice: 1.59, totalPrice: 1.59 });
    expect(caffe).toMatchObject({ name: "CAFFE' LAVAZZA 2x250G", quantity: 2, unitPrice: 4.95, totalPrice: 9.9 });
    expect(acqua).toMatchObject({ name: "ACQUA NATURALE 1,5L", quantity: 1, unitPrice: 2.85, totalPrice: 2.85 });
  });

  it("skips payment / VAT / metadata lines", () => {
    const parsed = parseReceiptText(
      `TOTALE 12,00
CONTANTI 12,00
BANCOMAT 12,00
IVA 10 % 1,09
VUOTO A RENDERE 0,10
29.08.2026 18:07
SELLERI 42`,
    );
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.total).toBe(12);
  });

  it("handles OCR noise (garbled characters, extra spaces, missing prices)", () => {
    const text = `COOP FI RENZE
| 30/08/2026 11:05 |
PASTA BARILLA N.5 1,29
LATTE GRANAROLO 1 L 2 1,49 2,98
??? INVALIDA SENZA PREZZO
TOTALE 4,27`;

    const parsed = parseReceiptText(text);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.total).toBe(4.27);
  });

  it("handles a line with only one amount (unit price = total)", () => {
    const parsed = parseReceiptText("ACQUA NATURALE 1,50");
    expect(parsed.lines).toEqual([
      expect.objectContaining({ name: "ACQUA NATURALE", quantity: 1, unitPrice: 1.5, totalPrice: 1.5 }),
    ]);
  });

  it("falls back to total/quantity when unit price is not explicit", () => {
    const parsed = parseReceiptText("YOGURT MIRTILLO 3 3,60");
    expect(parsed.lines[0]).toMatchObject({ quantity: 3, unitPrice: 1.2, totalPrice: 3.6 });
  });
});

describe("normalizeReceiptDate", () => {
  it("parses dd/mm/yyyy, dd.mm.yyyy and dd-mm-yy", () => {
    expect(normalizeReceiptDate("29/08/2026")).toBe("2026-08-29");
    expect(normalizeReceiptDate("29.08.2026")).toBe("2026-08-29");
    expect(normalizeReceiptDate("29-08-26")).toBe("2026-08-29");
  });

  it("returns null for garbage", () => {
    expect(normalizeReceiptDate("niente data")).toBeNull();
  });
});

describe("receiptLooksReliable", () => {
  it("is true when the total matches the line sum", () => {
    const parsed = parseReceiptText(
      "A 1,00\nB 2,00\nC 3,00\nTOTALE 6,00",
    );
    expect(receiptLooksReliable(parsed)).toBe(true);
  });

  it("is false when the total is missing and there are few lines", () => {
    const parsed = parseReceiptText("A 1,00\nTOTALE 1,00");
    expect(receiptLooksReliable(parsed)).toBe(false);
  });

  it("is false when the total deviates a lot from the lines", () => {
    const parsed = parseReceiptText("A 1,00\nB 2,00\nTOTALE 12,00");
    expect(receiptLooksReliable(parsed)).toBe(false);
  });
});