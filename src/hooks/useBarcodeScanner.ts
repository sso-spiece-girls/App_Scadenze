import { useCallback, useEffect, useRef, useState } from "react";
import { startScanner, type ScannerHandle } from "../services/barcodeService";

export type ScannerError = "no-camera" | "denied" | "unknown";

/**
 * useBarcodeScanner — starts/stops the camera scanner and reports decoded
 * barcodes. The scanner stops as soon as a code is detected (one-shot) and
 * must be restarted by the caller (e.g. by toggling `active`).
 */
export function useBarcodeScanner(active: boolean, onDetected: (barcode: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setIsScanning(false);
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

    // Ensure the camera stream is running before starting the decoder.
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
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
                  stream.getTracks().forEach((t) => t.stop());
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
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [active, stop]);

  return { videoRef, error, isScanning, stop };
}