import { useState, type RefObject } from "react";
import { decodeRGBA, type ScanResult, type ScannerStats } from "../services/barcodeService";

export interface ScannerStatusProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  videoSize: { width: number; height: number } | null;
  stats: ScannerStats | null;
  /** Validation outcome of the last decoded value (computed by the page). */
  validation: "pending" | "valid" | "invalid" | null;
  /** Lookup outcome of the last validated code (computed by the page). */
  lookup: "pending" | "found" | "not-found" | null;
}

/** Active with `?debug=1` or when `scanner-debug=1` is in localStorage. */
export function isScannerDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("debug") === "1" ||
    window.localStorage.getItem("scanner-debug") === "1"
  );
}

const formatLabel: Record<string, string> = {
  ean_13: "EAN-13",
  ean_8: "EAN-8",
  upc_a: "UPC-A",
  upc_e: "UPC-E",
  code_128: "Code 128",
  unknown: "—",
};

/**
 * ScannerDebugPanel — temporary diagnostics for the camera → decoder
 * pipeline. Shows exactly which stage is failing:
 *
 *   - Last decoded: none        → decoder never read anything (camera/frames)
 *   - Last decoded: <code>
 *     Format: EAN-13
 *     Validation: VALID
 *     Lookup: NOT FOUND         → decoder works, product just not in the DB
 *
 * Also exposes a manual "decode current frame" button that runs the frozen
 * frame through ZXing directly, separating camera problems from decoder
 * problems on a real device.
 */
export function ScannerDebugPanel({
  videoRef,
  cameraReady,
  videoSize,
  stats,
  validation,
  lookup,
}: ScannerStatusProps) {
  const [snapshot, setSnapshot] = useState<ScanResult | null>(null);
  const [snapshotMs, setSnapshotMs] = useState<number | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const decodeCurrentFrame = () => {
    setSnapshotError(null);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setSnapshotError("video non pronto");
      return;
    }
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(vw, vh));
      canvas.width = Math.max(1, Math.round(vw * scale));
      canvas.height = Math.max(1, Math.round(vh * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setSnapshotError("canvas non disponibile");
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const t0 = performance.now();
      const result = decodeRGBA(data.data, canvas.width, canvas.height);
      setSnapshotMs(performance.now() - t0);
      setSnapshot(result);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : String(err));
    }
  };

  const row = (label: string, value: string | number | null | undefined, tone?: "ok" | "warn" | "err") => {
    const cls =
      tone === "ok" ? "text-green-600 dark:text-green-400"
        : tone === "warn" ? "text-amber-600 dark:text-amber-400"
          : tone === "err" ? "text-red-600 dark:text-red-400"
            : "text-ink-800 dark:text-ink-100";
    return (
      <div className="flex justify-between gap-3">
        <span className="text-ink-500 dark:text-ink-400">{label}</span>
        <span className={`font-mono font-semibold tabular-nums ${cls}`}>{value ?? "—"}</span>
      </div>
    );
  };

  const validationTone = validation === "valid" ? "ok" : validation === "invalid" ? "err" : undefined;
  const lookupTone = lookup === "found" ? "ok" : lookup === "not-found" ? "warn" : undefined;
  const cameraTone = cameraReady ? "ok" : "err";
  const decoderTone = stats ? "ok" : "warn";

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-ink-300 bg-white p-3 text-[11px] leading-5 dark:border-ink-700 dark:bg-ink-900">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-ink-400 dark:text-ink-500">
        Scanner status (debug)
      </p>
      <div className="space-y-0.5">
        {row("Camera", cameraReady ? "READY" : "—", cameraTone)}
        {row("Video", videoSize ? `${videoSize.width}×${videoSize.height}` : null)}
        {row("Decoder", stats ? stats.decoder.toUpperCase() : "IDLE", decoderTone)}
        {row("Frames", stats?.frames ?? 0)}
        {row("Attempts", stats?.attempts ?? 0)}
        {row("Frame (ZXing)", stats?.decoder === "zxing" ? `${stats.lastFrameWidth}×${stats.lastFrameHeight}` : stats ? "n/a (native)" : null)}
        {row("Decode ms", stats?.lastDecodeMs != null ? Math.round(stats.lastDecodeMs) : null)}
        {row("Frame errors", stats?.frameErrors ?? 0)}
        {row("Last decoded", stats?.lastRaw)}
        {row("Format", stats?.lastFormat ? formatLabel[stats.lastFormat] ?? stats.lastFormat : null)}
        {row("Validation", validation ? (validation === "valid" ? "VALID" : validation === "invalid" ? "INVALID" : "PENDING") : null, validationTone)}
        {row("Lookup", lookup ? (lookup === "found" ? "FOUND" : lookup === "not-found" ? "NOT FOUND" : "PENDING") : null, lookupTone)}
      </div>
      <div className="border-t border-ink-100 pt-2 dark:border-ink-800">
        <button
          type="button"
          onClick={decodeCurrentFrame}
          className="w-full rounded-xl bg-ink-900 px-3 py-2 text-[11px] font-bold text-white dark:bg-white dark:text-ink-900"
        >
          🔍 Decodifica frame corrente (ZXing diretto)
        </button>
        {snapshot && (
          <p className="mt-1.5 font-mono text-[11px] text-green-600 dark:text-green-400">
            ✓ {snapshot.text} · {formatLabel[snapshot.format]} · {snapshotMs != null ? `${Math.round(snapshotMs)}ms` : ""}
          </p>
        )}
        {!snapshot && snapshotMs !== null && !snapshotError && (
          <p className="mt-1.5 text-[11px] text-ink-500 dark:text-ink-400">
            Nessun barcode nel frame statico ({Math.round(snapshotMs)}ms).
          </p>
        )}
        {snapshotError && (
          <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{snapshotError}</p>
        )}
      </div>
    </div>
  );
}
