import {
  BrowserMultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  type Result,
} from "@zxing/library";

/**
 * barcodeService — camera barcode scanning.
 *
 * Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128 (+ QR as bonus).
 *
 * Strategy:
 *   1. native `BarcodeDetector` API when available (Chrome/Android,
 *      hardware-accelerated, least CPU cost);
 *   2. fallback to the pure-JS ZXing `BrowserMultiFormatReader` (works
 *      everywhere, including iOS Safari and desktop).
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
// ZXing fallback
// ---------------------------------------------------------------------------

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

/**
 * Starts the ZXing fallback scanner. It drives the camera itself: pass a
 * `<video>` element to display the preview.
 */
export function startZxingScanner(
  video: HTMLVideoElement,
  onDetected: (rawValue: string) => void,
  onError?: (err: unknown) => void,
): ScannerHandle {
  const reader = new BrowserMultiFormatReader(zxingHints());
  let stopped = false;

  reader
    .decodeFromVideoDevice(null, video, (result: Result | null, err?: unknown) => {
      if (stopped) return;
      if (result) {
        onDetected(result.getText().trim());
      } else if (err) {
        // Ignore "NotFoundException" (normal between frames); surface the rest.
        const isNotFound =
          err instanceof Error &&
          (err.name === "NotFoundException" || err.message.includes("NotFound"));
        if (!isNotFound) onError?.(err);
      }
    })
    .catch((err: unknown) => {
      if (!stopped) onError?.(err);
    });

  return {
    stop: () => {
      stopped = true;
      void reader.reset();
    },
  };
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