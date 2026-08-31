import BinaryBitmap from "@zxing/library/esm/core/BinaryBitmap";
import HybridBinarizer from "@zxing/library/esm/core/common/HybridBinarizer";
import RGBLuminanceSource from "@zxing/library/esm/core/RGBLuminanceSource";
import MultiFormatUPCEANReader from "@zxing/library/esm/core/oned/MultiFormatUPCEANReader";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";
import DecodeHintType from "@zxing/library/esm/core/DecodeHintType";
import BarcodeFormat from "@zxing/library/esm/core/BarcodeFormat";
import type Result from "@zxing/library/esm/core/Result";

/**
 * barcodeService — camera barcode scanning.
 *
 * Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128 (+ QR as bonus
 * through the native detector).
 *
 * Strategy:
 *   1. native `BarcodeDetector` API when available (Chrome/Android,
 *      hardware-accelerated, least CPU cost);
 *   2. fallback to a pure-JS ZXing decode loop (works everywhere, including
 *      iOS Safari and desktop).
 *
 * Bundle note: the stock `BrowserMultiFormatReader` drags in QR, DataMatrix,
 * Aztec and PDF417 decoders (~300 KB). This module instead decodes frames
 * manually with ONLY the readers this app needs (EAN/UPC via
 * MultiFormatUPCEANReader + Code 128), and downsizes each frame to ≤1280 px
 * before decoding to keep CPU usage low on high-resolution phone sensors.
 */

export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
] as const;

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => NativeDetector;
  }
}

export function isNativeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export interface ScannerHandle {
  stop(): void;
}

/** Longest frame edge used for ZXing decoding (keeps CPU low on 4K sensors). */
const MAX_FRAME_EDGE = 1280;

/**
 * Starts a scanning loop using the native BarcodeDetector on a `<video>`
 * element. The video stream must already be running.
 */
export function startNativeScanner(
  video: HTMLVideoElement,
  onDetected: (rawValue: string) => void,
  onError?: (err: unknown) => void,
): ScannerHandle {
  const DetectorCtor = window.BarcodeDetector;
  if (!DetectorCtor) throw new Error("BarcodeDetector non disponibile");

  const detector = new DetectorCtor({ formats: [...BARCODE_FORMATS] });
  let stopped = false;
  let busy = false;

  const tick = async () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    try {
      const codes = await detector.detect(video);
      if (!stopped && codes.length > 0) {
        const raw = codes[0]?.rawValue;
        if (raw) onDetected(raw.trim());
      }
    } catch (err) {
      if (!stopped) onError?.(err);
    } finally {
      busy = false;
      if (!stopped) setTimeout(tick, 120);
    }
  };

  setTimeout(tick, 300);
  return { stop: () => { stopped = true; } };
}

// ---------------------------------------------------------------------------
// ZXing fallback (custom decode loop, minimal decoder set)
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
 * Starts the ZXing fallback scanner on an already-running `<video>` stream.
 * Draws every frame onto a canvas (downscaled) and decodes it with the
 * minimal reader set. NotFoundException between frames is expected and
 * ignored; any other decoder error is surfaced through `onError`.
 */
export function startZxingScanner(
  video: HTMLVideoElement,
  onDetected: (rawValue: string) => void,
  onError?: (err: unknown) => void,
): ScannerHandle {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D non disponibile");

  const readers = minimalReaders();
  const hints = zxingHints();
  let stopped = false;
  let busy = false;

  const tick = () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) {
        // Downscale large sensors: decoding is O(pixels), quality is fine at 1280.
        const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(w, h));
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const source = new RGBLuminanceSource(imageData.data, canvas.width, canvas.height);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));

        for (const reader of readers) {
          try {
            const result = reader.decode(bitmap, hints);
            if (!stopped && result) {
              onDetected(result.getText().trim());
              break;
            }
          } catch {
            // NotFoundException (or any decode miss) → try the next reader.
          }
        }
      }
    } catch (err) {
      if (!stopped) onError?.(err);
    } finally {
      busy = false;
      if (!stopped) setTimeout(tick, 150);
    }
  };

  setTimeout(tick, 300);
  return { stop: () => { stopped = true; } };
}

/** High-level entry point: picks the best available scanner. */
export function startScanner(
  video: HTMLVideoElement,
  onDetected: (rawValue: string) => void,
  onError?: (err: unknown) => void,
): ScannerHandle {
  if (isNativeDetectorSupported()) {
    try {
      return startNativeScanner(video, onDetected, onError);
    } catch {
      // fall through to ZXing
    }
  }
  return startZxingScanner(video, onDetected, onError);
}