import { describe, expect, it } from "vitest";
import BinaryBitmap from "@zxing/library/esm/core/BinaryBitmap";
import HybridBinarizer from "@zxing/library/esm/core/common/HybridBinarizer";
import RGBLuminanceSource from "@zxing/library/esm/core/RGBLuminanceSource";
import MultiFormatUPCEANReader from "@zxing/library/esm/core/oned/MultiFormatUPCEANReader";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";
import DecodeHintType from "@zxing/library/esm/core/DecodeHintType";
import BarcodeFormat from "@zxing/library/esm/core/BarcodeFormat";
import { decodeRGBA } from "./barcodeService";
import { normalizeBarcode, validateBarcode } from "../utils/barcode";

/**
 * Unit tests for the real ZXing decode pipeline (`decodeRGBA`).
 *
 * These are DETERMINISTIC tests: they synthesize barcode images (EAN-13,
 * EAN-8, UPC-A, Code 128) as raw RGBA buffers — exactly what
 * `canvas.getImageData()` produces — and push them through the same code path
 * used by the live camera loop.
 *
 * They exist to catch regressions in the *decode* stage (pixel layout,
 * reader configuration, formats). They are NOT a substitute for on-device
 * camera tests: the camera → frame → canvas stage can only be verified on a
 * real device (see the DEBUG panel in the app).
 */

// ---------------------------------------------------------------------------
// Synthetic barcode encoders (widths copied from the ZXing reader tables)
// ---------------------------------------------------------------------------

type Run = { color: 0 | 1; width: number };

/** [bar, space, bar, space] widths for UPC/EAN digits — AbstractUPCEANReader.L_PATTERNS. */
const L_PATTERNS: number[][] = [
  [3, 2, 1, 1],
  [2, 2, 2, 1],
  [2, 1, 2, 2],
  [1, 4, 1, 1],
  [1, 1, 3, 2],
  [1, 2, 3, 1],
  [1, 1, 1, 4],
  [1, 3, 1, 2],
  [1, 2, 1, 3],
  [3, 1, 1, 2],
];

/** L/G parity of the 6 left digits for each EAN-13 first digit — EAN13Reader.FIRST_DIGIT_ENCODINGS. */
const FIRST_DIGIT_PARITY: string[] = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

/** Code 128 patterns (values 0-102, start A/B/C 103-105, stop 106) — Code128Reader.CODE_PATTERNS. */
const CODE128_PATTERNS: number[][] = [
  [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1], [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1], [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2], [2, 3, 3, 1, 1, 1, 2],
];

function pushRun(runs: Run[], color: 0 | 1, width: number) {
  const last = runs[runs.length - 1];
  if (last && last.color === color) {
    last.width += width;
  } else {
    runs.push({ color, width });
  }
}

/** EAN-13 run layout: start 101, 6 left digits (L/G), middle 01010, 6 right digits (R), end 101. */
function ean13Runs(code: string): Run[] {
  const runs: Run[] = [];
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  const parity = FIRST_DIGIT_PARITY[Number(code[0])];
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    // L digits: widths L(d), colours space→bar→space→bar. G digits: same
    // colours, widths reversed (that is exactly how ZXing decodes them).
    const widths = parity[i - 1] === "G" ? [...L_PATTERNS[d]].reverse() : L_PATTERNS[d];
    let color: 0 | 1 = 0;
    for (const w of widths) {
      pushRun(runs, color, w);
      color = color === 0 ? 1 : 0;
    }
  }
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  for (let i = 7; i <= 12; i++) {
    const d = Number(code[i]);
    // R digits have the same widths as L but start with a bar.
    let color: 0 | 1 = 1;
    for (const w of L_PATTERNS[d]) {
      pushRun(runs, color, w);
      color = color === 0 ? 1 : 0;
    }
  }
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  return runs;
}

/** EAN-8 run layout (4 left L digits, 4 right R digits). */
function ean8Runs(code: string): Run[] {
  const runs: Run[] = [];
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  for (let i = 0; i <= 3; i++) {
    const d = Number(code[i]);
    let color: 0 | 1 = 0;
    for (const w of L_PATTERNS[d]) {
      pushRun(runs, color, w);
      color = color === 0 ? 1 : 0;
    }
  }
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  for (let i = 4; i <= 7; i++) {
    const d = Number(code[i]);
    let color: 0 | 1 = 1;
    for (const w of L_PATTERNS[d]) {
      pushRun(runs, color, w);
      color = color === 0 ? 1 : 0;
    }
  }
  pushRun(runs, 1, 1);
  pushRun(runs, 0, 1);
  pushRun(runs, 1, 1);
  return runs;
}

/** Code 128 in Code Set B: start 104, data, modulo-103 check, stop 106. */
function code128Runs(text: string): Run[] {
  const values = [...text].map((c) => c.charCodeAt(0) - 32); // ' '=0 … '~'=94
  if (values.some((v) => v < 0 || v > 94)) throw new Error("Code B range");
  let sum = 104; // Start B
  values.forEach((v, i) => {
    sum += v * (i + 1);
  });
  const check = sum % 103;
  const symbols = [104, ...values, check, 106];
  const runs: Run[] = [];
  let color: 0 | 1 = 1;
  for (const s of symbols) {
    for (const w of CODE128_PATTERNS[s]) {
      pushRun(runs, color, w);
      color = color === 0 ? 1 : 0;
    }
  }
  return runs;
}

/** Renders runs into an RGBA buffer exactly as canvas.getImageData() would. */
function renderRgba(
  runs: Run[],
  scale: number,
  heightPx: number,
  quietModules = 11,
  inverted = false,
): { data: Uint8ClampedArray; width: number; height: number } {
  const totalModules = runs.reduce((s, r) => s + r.width, 0) + quietModules * 2;
  const width = totalModules * scale;
  const height = heightPx;
  const data = new Uint8ClampedArray(width * height * 4);
  const background = inverted ? [0, 0, 0] : [255, 255, 255];
  const bar = inverted ? [255, 255, 255] : [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = 255;
  }
  let modulePos = quietModules;
  for (const run of runs) {
    if (run.color === 1) {
      const x0 = modulePos * scale;
      const x1 = (modulePos + run.width) * scale;
      for (let y = 0; y < height; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = bar[0];
          data[idx + 1] = bar[1];
          data[idx + 2] = bar[2];
        }
      }
    }
    modulePos += run.width;
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decodeRGBA — ZXing pipeline on real pixel data", () => {
  it("decodes the reported EAN-13 8001120666826 (regression: RGBA byte layout)", () => {
    const { data, width, height } = renderRgba(ean13Runs("8001120666826"), 3, 60);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "8001120666826", format: "ean_13" });
  });

  it("decodes a classic EAN-13 (5901234123457)", () => {
    const { data, width, height } = renderRgba(ean13Runs("5901234123457"), 3, 60);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "5901234123457", format: "ean_13" });
  });

  it("decodes an EAN-8", () => {
    const { data, width, height } = renderRgba(ean8Runs("96385074"), 3, 60);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "96385074", format: "ean_8" });
  });

  it("decodes a UPC-A (encoded as EAN-13 with leading 0) and reports upc_a", () => {
    // UPC-A 036000291452 physically equals EAN-13 0036000291452.
    const { data, width, height } = renderRgba(ean13Runs("0036000291452"), 3, 60);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "036000291452", format: "upc_a" });
  });

  it("decodes a Code 128", () => {
    const { data, width, height } = renderRgba(code128Runs("12345"), 3, 60);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "12345", format: "code_128" });
  });

  it("still decodes a small (low-scale) EAN-13", () => {
    // 2 px/module ≈ the pixel density of a small barcode after downscale.
    const { data, width, height } = renderRgba(ean13Runs("8001120666826"), 2, 50);
    expect(decodeRGBA(data, width, height)).toEqual({ text: "8001120666826", format: "ean_13" });
  });

  it("decodes an inverted (light-on-dark) barcode only when inversion is enabled", () => {
    const { data, width, height } = renderRgba(ean13Runs("8001120666826"), 3, 60, 11, true);
    expect(decodeRGBA(data, width, height)).toBeNull();
    expect(decodeRGBA(data, width, height, { tryInverted: true })).toEqual({
      text: "8001120666826",
      format: "ean_13",
    });
  });

  it("returns null for a frame without a barcode instead of throwing", () => {
    const data = new Uint8ClampedArray(200 * 100 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    expect(decodeRGBA(data, 200, 100)).toBeNull();
  });

  it("documents the old bug: RGBA fed straight to RGBLuminanceSource never decodes", () => {
    // Replicate the previous implementation: the 4 B/px RGBA buffer was passed
    // directly as the luminance source, which ZXing reads with a 1 B/px stride.
    const { data, width, height } = renderRgba(ean13Runs("8001120666826"), 3, 60);
    const hints = () => {
      const h = new Map<DecodeHintType, unknown>();
      h.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      h.set(DecodeHintType.TRY_HARDER, true);
      return h;
    };
    const source = new RGBLuminanceSource(data, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    let decoded = false;
    for (const reader of [new MultiFormatUPCEANReader(hints()), new Code128Reader()]) {
      try {
        if (reader.decode(bitmap, hints())) decoded = true;
      } catch {
        // NotFoundException — expected with the corrupted buffer.
      }
    }
    expect(decoded).toBe(false);
  });

  it("integrates with normalizeBarcode/validateBarcode (camera → validator chain)", () => {
    const { data, width, height } = renderRgba(ean13Runs("8001120666826"), 3, 60);
    const result = decodeRGBA(data, width, height);
    expect(result).not.toBeNull();
    const code = normalizeBarcode(result!.text);
    expect(code).toBe("8001120666826");
    expect(validateBarcode(code)).toMatchObject({ valid: true, format: "EAN-13" });
  });
});