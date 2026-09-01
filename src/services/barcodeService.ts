import BinaryBitmap from "@zxing/library/esm/core/BinaryBitmap";
import HybridBinarizer from "@zxing/library/esm/core/common/HybridBinarizer";
import InvertedLuminanceSource from "@zxing/library/esm/core/InvertedLuminanceSource";
import RGBLuminanceSource from "@zxing/library/esm/core/RGBLuminanceSource";
import MultiFormatUPCEANReader from "@zxing/library/esm/core/oned/MultiFormatUPCEANReader";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";
import DecodeHintType from "@zxing/library/esm/core/DecodeHintType";
import BarcodeFormat from "@zxing/library/esm/core/BarcodeFormat";
import type Result from "@zxing/library/esm/core/Result";

/**
 * barcodeService — camera barcode scanning.
 *
 * Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128.
 *
 * Strategy:
 *   1. native `BarcodeDetector` API when available (Chrome/Android) — if it
 *      keeps failing on live frames, the loop automatically hands off to ZXing
 *      (never blocks the scan with an error);
 *   2. pure-JS ZXing decode loop (works everywhere, including iOS Safari and
 *      desktop). Frames are decoded with ONLY the readers this app needs
 *      (MultiFormatUPCEANReader + Code128Reader).
 *
 * Error contract (critical):
 *   - a frame with no readable barcode (ZXing NotFound/Checksum/Format or a
 *     native detect() rejection) is a NORMAL miss → the loop continues;
 *   - `onError` is reserved for genuinely fatal conditions (no canvas, both
 *     decoders unavailable) and maps to the "Errore durante la scansione" UI.
 *
 * Decode strategy:
 *   - pass 1: full frame, longest edge ≤ 1280 px (fast, catches big codes);
 *   - pass 2 (only if pass 1 misses): a generous center region (70 % of the
 *     frame) rendered at up to native resolution, so small barcodes are not
 *     destroyed by the full-frame downscale.
 *
 * Pixel-layout note (the bug that made the decoder read nothing):
 *   `canvas.getImageData()` returns RGBA (4 bytes/pixel), but ZXing's
 *   `RGBLuminanceSource` treats its input as RGB (3 bytes/pixel) or as a flat
 *   luminance array. Passing RGBA straight to it shifts every pixel by one
 *   byte and corrupts the entire frame → every decode failed silently.
 *   `rgbaToLuminance()` converts RGBA → 1 byte/pixel luminance before ZXing.
 */

export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
] as const;

export type BarcodeFormatName = (typeof BARCODE_FORMATS)[number] | "unknown";

export interface ScanResult {
  /** Raw value returned by the decoder (not yet normalized/validated). */
  text: string;
  format: BarcodeFormatName;
}

export interface ScannerStats {
  decoder: "native" | "zxing";
  /** Video frames consumed by the scanner. */
  frames: number;
  /** Decode passes executed (pass 1 + pass 2 of the ZXing loop). */
  attempts: number;
  /** Consecutive frame-level failures (non-fatal, for diagnostics). */
  frameErrors: number;
  hits: number;
  /** Last decode pass duration, milliseconds. */
  lastDecodeMs: number | null;
  videoWidth: number;
  videoHeight: number;
  /** Actual canvas dimensions last handed to the decoder. */
  lastFrameWidth: number;
  lastFrameHeight: number;
  lastRaw: string | null;
  lastFormat: BarcodeFormatName | null;
}

export interface ScannerCallbacks {
  onDetected: (result: ScanResult) => void;
  /** Fatal failures only (decoder unavailable, canvas missing, …). */
  onError?: (err: unknown) => void;
  /** Per-frame telemetry; safe to call every tick. */
  onStats?: (stats: ScannerStats) => void;
}

export interface ScannerHandle {
  stop(): void;
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format?: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => NativeDetector;
  }
}

export function isNativeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Longest edge for the full-frame decode pass. */
const MAX_FRAME_EDGE = 1280;
/** Longest edge for the center-region pass (keeps small-barcode detail). */
const MAX_CROP_EDGE = 1920;
/** Generous center region: 70 % of the frame. */
const CROP_FRACTION = 0.7;
/** Delay between ticks → roughly 11 decode attempts/second. */
const TICK_DELAY_MS = 90;
/** Consecutive native detect() failures before handing off to ZXing. */
const MAX_NATIVE_ERRORS = 5;

// ---------------------------------------------------------------------------
// Decode core (deterministic, unit-testable)
// ---------------------------------------------------------------------------

interface MinimalReader {
  decode(image: BinaryBitmap, hints?: Map<DecodeHintType, unknown>): Result;
}

function zxingHints(): Map<DecodeHintType, unknown> {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

/** The readers this app actually scans: EAN-13/8, UPC-A/E and Code 128. */
function minimalReaders(): MinimalReader[] {
  return [new MultiFormatUPCEANReader(zxingHints()), new Code128Reader()];
}

/**
 * RGBA (canvas getImageData) → ZXing-compatible luminance array (1 byte/px).
 *
 * This is the fix for the "decoder never reads anything" bug: ZXing's
 * RGBLuminanceSource reads its buffer with a 1 byte/pixel stride, so passing
 * the 4 byte/pixel RGBA buffer directly scrambles every frame.
 */
export function rgbaToLuminance(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  let src = 0;
  for (let i = 0; i < out.length; i++) {
    // Green-favouring average, same cheap formula ZXing uses.
    out[i] = (data[src] + 2 * data[src + 1] + data[src + 2]) / 4;
    src += 4;
  }
  return out;
}

function formatToName(format: BarcodeFormat | undefined): BarcodeFormatName {
  switch (format) {
    case BarcodeFormat.EAN_13:
      return "ean_13";
    case BarcodeFormat.EAN_8:
      return "ean_8";
    case BarcodeFormat.UPC_A:
      return "upc_a";
    case BarcodeFormat.UPC_E:
      return "upc_e";
    case BarcodeFormat.CODE_128:
      return "code_128";
    default:
      return "unknown";
  }
}

function runReaders(
  bitmap: BinaryBitmap,
  readers: MinimalReader[],
  hints: Map<DecodeHintType, unknown>,
): ScanResult | null {
  for (const reader of readers) {
    try {
      const result = reader.decode(bitmap, hints);
      const text = result ? result.getText().trim() : "";
      if (text) return { text, format: formatToName(result.getBarcodeFormat()) };
    } catch {
      // NotFoundException / ChecksumException / FormatException / any other
      // per-frame miss: this is a normal "no barcode in this frame", never an
      // error. Keep scanning.
    }
  }
  return null;
}

/**
 * Decodes a luminance buffer with the ZXing readers. Normal binarization
 * first; optionally retries with an inverted source (light-on-dark codes).
 */
function decodeLuminance(
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
  readers: MinimalReader[],
  hints: Map<DecodeHintType, unknown>,
  tryInverted: boolean,
): ScanResult | null {
  const source = new RGBLuminanceSource(luminance, width, height);
  const hit = runReaders(new BinaryBitmap(new HybridBinarizer(source)), readers, hints);
  if (hit || !tryInverted) return hit;
  return runReaders(
    new BinaryBitmap(new HybridBinarizer(new InvertedLuminanceSource(source))),
    readers,
    hints,
  );
}

/**
 * Decodes a raw RGBA frame (as produced by `canvas.getImageData`) with the
 * real ZXing pipeline. Purely deterministic — used by the scanner loop and by
 * unit tests, and exposed so the DEBUG panel can decode a frozen frame
 * manually to separate "camera problem" from "decoder problem".
 */
export function decodeRGBA(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { tryInverted?: boolean },
): ScanResult | null {
  if (width < 1 || height < 1 || data.length < width * height * 4) return null;
  const luminance = rgbaToLuminance(data, width, height);
  return decodeLuminance(luminance, width, height, minimalReaders(), zxingHints(), options?.tryInverted ?? false);
}

// ---------------------------------------------------------------------------
// Native BarcodeDetector scanner
// ---------------------------------------------------------------------------

function createStats(decoder: ScannerStats["decoder"]): ScannerStats {
  return {
    decoder,
    frames: 0,
    attempts: 0,
    frameErrors: 0,
    hits: 0,
    lastDecodeMs: null,
    videoWidth: 0,
    videoHeight: 0,
    lastFrameWidth: 0,
    lastFrameHeight: 0,
    lastRaw: null,
    lastFormat: null,
  };
}

function nativeFormatName(format: string | undefined): BarcodeFormatName {
  const normalized = (format ?? "").toLowerCase();
  return (BARCODE_FORMATS as readonly string[]).includes(normalized)
    ? (normalized as BarcodeFormatName)
    : "unknown";
}

/** Fresh object each tick: React needs a new reference to re-render stats. */
function snapshotStats(stats: ScannerStats): ScannerStats {
  return { ...stats };
}

/**
 * Starts a scanning loop using the native BarcodeDetector on a `<video>`
 * element. The video stream must already be running.
 *
 * detect() rejections are treated as normal misses; after MAX_NATIVE_ERRORS
 * consecutive failures (some devices' BarcodeDetector rejects `<video>`
 * input) the loop hands off to the ZXing scanner instead of erroring out.
 */
export function startNativeScanner(
  video: HTMLVideoElement,
  callbacks: ScannerCallbacks,
): ScannerHandle {
  const DetectorCtor = window.BarcodeDetector;
  if (!DetectorCtor) throw new Error("BarcodeDetector non disponibile");
  let detector: NativeDetector;
  try {
    detector = new DetectorCtor({ formats: [...BARCODE_FORMATS] });
  } catch {
    // This device's BarcodeDetector rejected the requested format set:
    // let startScanner fall through to ZXing.
    throw new Error("BarcodeDetector: formati non supportati");
  }

  const stats = createStats("native");
  let stopped = false;
  let busy = false;
  let consecutiveErrors = 0;
  let fallback: ScannerHandle | null = null;

  const tick = async () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    const t0 = performance.now();
    try {
      const codes = await detector.detect(video);
      consecutiveErrors = 0;
      stats.videoWidth = video.videoWidth;
      stats.videoHeight = video.videoHeight;
      stats.frames++;
      stats.lastDecodeMs = performance.now() - t0;
      if (codes.length > 0) {
        const first = codes[0];
        const text = first?.rawValue?.trim() ?? "";
        if (text) {
          stats.hits++;
          stats.lastRaw = text;
          stats.lastFormat = nativeFormatName(first.format);
          stopped = true;
          callbacks.onDetected({ text, format: stats.lastFormat });
        }
      }
    } catch (err) {
      // A single native frame failure is NOT fatal. After a few consecutive
      // failures the BarcodeDetector is unusable on this device → fall back
      // to ZXing. The UI must never see an error for this.
      consecutiveErrors++;
      stats.frameErrors++;
      if (consecutiveErrors >= MAX_NATIVE_ERRORS && !stopped) {
        stopped = true;
        try {
          fallback = startZxingScanner(video, callbacks);
        } catch (zxErr) {
          // Both engines unavailable → this is a real, fatal failure.
          callbacks.onError?.(zxErr ?? err);
        }
      }
    } finally {
      busy = false;
      callbacks.onStats?.(snapshotStats(stats));
      if (!stopped) setTimeout(tick, TICK_DELAY_MS);
    }
  };

  setTimeout(tick, 120);
  return {
    stop: () => {
      stopped = true;
      fallback?.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// ZXing fallback scanner
// ---------------------------------------------------------------------------

/**
 * Starts the ZXing fallback scanner on an already-running `<video>` stream.
 * Every tick decodes the full frame (≤1280 px) and, if that misses, a
 * generous center region at higher resolution. NotFound/Checksum/Format are
 * normal misses and are silently skipped — the loop keeps going until a code
 * is found or `stop()` is called.
 */
export function startZxingScanner(
  video: HTMLVideoElement,
  callbacks: ScannerCallbacks,
): ScannerHandle {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D non disponibile");

  const readers = minimalReaders();
  const hints = zxingHints();
  const stats = createStats("zxing");
  let stopped = false;
  let busy = false;

  const tick = () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    const t0 = performance.now();
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      stats.videoWidth = vw;
      stats.videoHeight = vh;
      if (vw > 0 && vh > 0) {
        // Pass 1 — full frame, downscaled to ≤1280 px.
        const pass1 = decodeFramePass(ctx, video, 0, 0, vw, vh, MAX_FRAME_EDGE, readers, hints, stats);
        stats.attempts++;
        let hit = pass1;
        // Pass 2 — generous center region (70 % of the frame) at up to native
        // resolution: small barcodes survive here even if the full-frame
        // downscale destroyed them.
        if (!hit) {
          const cw = Math.round(vw * CROP_FRACTION);
          const ch = Math.round(vh * CROP_FRACTION);
          const cx = Math.round((vw - cw) / 2);
          const cy = Math.round((vh - ch) / 2);
          hit = decodeFramePass(ctx, video, cx, cy, cw, ch, MAX_CROP_EDGE, readers, hints, stats);
          stats.attempts++;
        }
        stats.frames++;
        stats.lastDecodeMs = performance.now() - t0;
        if (hit) {
          stats.hits++;
          stats.lastRaw = hit.text;
          stats.lastFormat = hit.format;
          stopped = true; // one-shot: stop as soon as a code is found
          callbacks.onDetected(hit);
        }
      }
    } catch {
      // A frame that cannot be drawn/read on this device must never be fatal:
      // count it and keep scanning. Only the decoder/init failures above call
      // onError.
      stats.frameErrors++;
    } finally {
      busy = false;
      callbacks.onStats?.(snapshotStats(stats));
      if (!stopped) setTimeout(tick, TICK_DELAY_MS);
    }
  };

  setTimeout(tick, 120);
  return { stop: () => { stopped = true; } };
}

/** Draws the given video region and decodes it (ZXing). */
function decodeFramePass(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxEdge: number,
  readers: MinimalReader[],
  hints: Map<DecodeHintType, unknown>,
  stats: ScannerStats,
): ScanResult | null {
  if (sw < 1 || sh < 1) return null;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  ctx.canvas.width = dw;
  ctx.canvas.height = dh;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  const imageData = ctx.getImageData(0, 0, dw, dh);
  stats.lastFrameWidth = dw;
  stats.lastFrameHeight = dh;
  const luminance = rgbaToLuminance(imageData.data, dw, dh);
  return decodeLuminance(luminance, dw, dh, readers, hints, false);
}

/** High-level entry point: picks the best available scanner. */
export function startScanner(
  video: HTMLVideoElement,
  callbacks: ScannerCallbacks,
): ScannerHandle {
  if (isNativeDetectorSupported()) {
    try {
      return startNativeScanner(video, callbacks);
    } catch {
      // BarcodeDetector unavailable or rejected our formats → ZXing fallback.
    }
  }
  return startZxingScanner(video, callbacks);
}
