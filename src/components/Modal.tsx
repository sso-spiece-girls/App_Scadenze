import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Bottom sheet modal (mobile-first). */
export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
      <button
        aria-label="Chiudi"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="animate-sheet-up relative w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-ink-900 md:rounded-3xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-200 dark:bg-ink-700 md:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-100">{title}</h2>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Conferma", tone = "danger", onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink-600 dark:text-ink-300">{message}</p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 rounded-2xl bg-ink-100 px-4 py-3 text-sm font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
        >
          Annulla
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-bold text-white ${
            tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}