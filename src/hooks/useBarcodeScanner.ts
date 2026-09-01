import { useCallback, useEffect, useRef, useState } from "react";
import {
  startScanner,
  type ScanResult,
  type ScannerCallbacks,
  type ScannerHandle,
  type ScannerStats,
} from "../services/barcodeService";

export type ScannerError = "no-camera" | "denied" | "unknown";

export type CameraFacing = "environment" | "user";

/**
 * `focusMode` is not part of the TypeScript DOM typings yet, although Chrome
 * and Safari expose it. Declared here so continuous autofocus can be applied
 * without casting the whole constraint object to `any`.
 */
declare global {
  interface MediaTrackSupportedConstraints {
    focusMode?: boolean;
  }
  interface MediaTrackCapabilities {
    focusMode?: string[];
  }
  interface MediaTrackConstraintSet {
    focusMode?: string;
  }
}

/**
 * useBarcodeScanner — starts/stops the camera scanner and reports decoded
 * barcodes. The scanner stops as soon as a code is detected (one-shot) and
 * must be restarted by the caller (e.g. by toggling `active`).
 *
 * Camera constraints are soft (`ideal`), never rigid: the browser picks the
 * closest supported resolution. On smartphones the rear camera
 * (`facingMode: environment`) is preferred. Continuous autofocus is applied
 * when the device exposes it; everything here degrades silently.
 *
 * Error contract: `error` is set ONLY for real problems (permission denied,
 * no camera, stream/decoder init failure). A frame with no readable barcode
 * is a normal miss — the scanner keeps running and no error is surfaced.
 *
 * `stats` carries live per-frame telemetry (frames, attempts, last decoded
 * value/format, frame size) for the DEBUG overlay.
 */
export function useBarcodeScanner(
  active: boolean,
  onDetected: (result: ScanResult) => void,
  options?: { collectStats?: boolean },
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [stats, setStats] = useState<ScannerStats | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  // Per-frame telemetry causes a React re-render every tick (~11×/s). Only
  // collect it when the DEBUG overlay is active.
  const collectStats = options?.collectStats ?? false;

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setIsScanning(false);
  }, []);

  const toggleCamera = useCallback(() => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  /**
   * Best-effort continuous autofocus. Never fails the scanner: if the browser
   * or the device does not expose focusMode, this is a silent no-op.
   */
  const applyContinuousFocus = useCallback(async (stream: MediaStream) => {
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints?.();
      if (!supported?.focusMode) return;
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const modes = track.getCapabilities?.().focusMode;
      if (!modes || !modes.includes("continuous")) return;
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch {
      // Non-fatal: focus is an enhancement, scanning works without it.
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    setError(null);
    setCameraReady(false);
    setVideoSize(null);
    setStats(null);

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const callbacks: ScannerCallbacks = {
      onDetected: (result) => {
        if (!cancelled) {
          stop();
          stream?.getTracks().forEach((t) => t.stop());
          onDetectedRef.current(result);
        }
      },
      onError: (err) => {
        // Fatal decoder failures only (both engines unavailable, no canvas).
        console.error("[scanner] fatal error", err);
        if (!cancelled) setError("unknown");
      },
      onStats: collectStats
        ? (s) => {
            if (!cancelled) setStats(s);
          }
        : undefined,
    };

    // Soft constraints: ideal, never exact/rigid. The device picks its own
    // best supported resolution (a phone sensor is usually higher than 1280).
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        video.setAttribute("playsinline", "true");
        video.muted = true;

        const onLoaded = () => {
          if (cancelled) return;
          setCameraReady(true);
          setVideoSize({ width: video.videoWidth, height: video.videoHeight });
          try {
            handleRef.current = startScanner(video, callbacks);
            setIsScanning(true);
          } catch (err) {
            console.error("[scanner] init failed", err);
            if (!cancelled) setError("unknown");
          }
        };
        // Assign before play() and also handle the case where metadata has
        // already loaded, so the scanner can never be stuck waiting for an
        // event that already fired.
        video.onloadedmetadata = onLoaded;
        if (video.readyState >= 1) onLoaded();
        video.play().catch(() => undefined);
        void applyContinuousFocus(s);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(name === "NotAllowedError" ? "denied" : "no-camera");
      });

    return () => {
      cancelled = true;
      stop();
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [active, stop, facing, applyContinuousFocus, collectStats]);

  return { videoRef, error, isScanning, stop, toggleCamera, facing, cameraReady, videoSize, stats };
}
