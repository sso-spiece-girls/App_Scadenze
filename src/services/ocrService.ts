/**
 * ocrService — receipt OCR with on-device Tesseract.js (lazy loaded).
 *
 * Why local OCR: the photo never leaves the device (privacy), there is no per-
 * call cost, and it works offline. Trade-off: the first run downloads the
 * Tesseract worker + WASM core + the Italian language data (~2-3 MB) from the
 * jsDelivr CDN; subsequent runs reuse the cached worker.
 *
 * Language: `ita` only — the app targets Unicoop Firenze / Coop.fi receipts,
 * which are printed in Italian.
 *
 * Preprocessing is deliberately conservative — only steps that help thermal
 * receipts without hurting clean ones:
 *   - grayscale (removes color noise, halves memory);
 *   - mild contrast stretch (faded thermal ink);
 *   - upscale ×2 when the image is small (OCR accuracy drops below ~1200px
 *     width). No aggressive binarization/sharpening: Tesseract's own pipeline
 *     handles clean text better than our filters.
 */

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;
let currentLogger: ((progress: number, status: string) => void) | null = null;

async function getWorker(): Promise<import("tesseract.js").Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = (await import("tesseract.js")).default;
      const worker = await Tesseract.createWorker("ita", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && currentLogger) {
            currentLogger(m.progress, m.status);
          } else if (m.status === "loading language traineddata" && currentLogger) {
            currentLogger(m.progress, "download-lingua");
          }
        },
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** Terminates the worker and frees its memory (e.g. on sign out). */
export async function disposeOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

/**
 * Preprocesses a receipt image into a canvas ready for OCR:
 * grayscale → contrast stretch → upscale when too small.
 */
export function preprocessReceiptImage(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): HTMLCanvasElement {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  const MIN_WIDTH = 1400;
  const scale = width > 0 && width < MIN_WIDTH ? MIN_WIDTH / width : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Compute min/max luminance for the contrast stretch.
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const range = Math.max(1, max - min);
  const low = min;
  const stretch = 255 / range;

  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const out = Math.min(255, Math.max(0, Math.round((lum - low) * stretch)));
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Loads a photo file into an HTMLImageElement. */
export function loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossibile leggere l'immagine"));
    };
    img.src = url;
  });
}

export interface OcrProgress {
  /** 0..1 */
  progress: number;
  /** Human readable stage. */
  stage: string;
}

/**
 * Runs OCR on a receipt image (Blob/File or canvas). Returns the raw text.
 * Lazy: the heavy Tesseract code is only fetched on first use.
 */
export async function recognizeReceiptText(
  image: Blob | HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  currentLogger = (progress, status) => {
    const stage =
      status === "download-lingua"
        ? "download-lingua"
        : status === "loading tesseract core"
          ? "loading-core"
          : "ocr";
    onProgress?.({ progress, stage });
  };
  try {
    const worker = await getWorker();
    // Recognize from an object URL when given a Blob (works in all browsers).
    if (image instanceof Blob) {
      const url = URL.createObjectURL(image);
      try {
        const result = await worker.recognize(url);
        return result.data.text ?? "";
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const result = await worker.recognize(image);
    return result.data.text ?? "";
  } finally {
    currentLogger = null;
  }
}