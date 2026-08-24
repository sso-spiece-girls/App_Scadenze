import { createContext, useContext, type ReactNode } from "react";
import { useToast, type Toast } from "../hooks/useToast";
import { ToastViewport } from "../components/ToastViewport";

interface ToastContextValue {
  show: (message: string, type?: Toast["type"], duration?: number) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Provides a single toast stack for the whole app (cross-route). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, show, dismiss } = useToast();
  return (
    <ToastContext.Provider value={{ toasts, show, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext deve essere usato dentro <ToastProvider>");
  return ctx;
}