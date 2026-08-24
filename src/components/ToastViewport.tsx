import type { Toast } from "../hooks/useToast";

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`animate-toast-in pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-xl ${
            t.type === "success" ? "bg-brand-600" : t.type === "error" ? "bg-red-600" : "bg-ink-800"
          }`}
        >
          <span aria-hidden="true">{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  );
}