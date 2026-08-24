import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

/** useToast — lightweight toast manager. */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: Toast["type"] = "info", duration = 3500) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return { toasts, show, dismiss };
}