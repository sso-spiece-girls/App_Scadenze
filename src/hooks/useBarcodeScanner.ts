import { useCallback, useEffect, useRef, useState } from "react";
import { startScanner, type ScannerHandle } from "../services/barcodeService";

export type ScannerError = "no-camera" | "denied" | "unknown";

export type CameraFacing = "environment" | "user";

/**
 * useBarcodeScanner — starts/stops the camera scanner and reports decoded
 * barcodes. The scanner stops as soon as a code is detected (one-shot) and
 * must be restarted by the caller (e.g. by toggling `active`).
 *
 * Defaults to the rear camera (`environment`) on smartphones; the caller can
 * toggle front/back via `toggleCamera`. All camera/stream errors are mapped
 * to a typed `error` so the UI can offer a retry or a manual fallback.
 */
export function useBarcodeScanner(active: boolean, onDetected: (barcode: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setIsScanning(false);
  }, []);

  const toggleCamera = useCallback(() => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    setError(null);

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    // Ensure the camera stream is running before starting the decoder.
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
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
        video.play().catch(() => undefined);

        video.onloadedmetadata = () => {
          if (cancelled) return;
          try {
            handleRef.current = startScanner(
              video,
              (barcode) => {
                if (!cancelled) {
                  stop();
                  stream?.getTracks().forEach((t) => t.stop());
                  onDetectedRef.current(barcode);
                }
              },
              (err) => {
                console.error("scanner error", err);
                setError("unknown");
              },
            );
            setIsScanning(true);
          } catch (err) {
            console.error("scanner start failed", err);
            setError("unknown");
          }
        };
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
  }, [active, stop, facing]);

  return { videoRef, error, isScanning, stop, toggleCamera, facing };
}