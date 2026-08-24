import { useState } from "react";
import type { ProductWithStatus } from "../types";
import { addDays, daysUntil, formatDateLong, toDateOnly, todayLocal } from "../utils/date";
import { ConfirmDialog, Modal } from "./Modal";
import type { ProductAction } from "./ProductCard";

/** Subset of the useProducts API needed by the product actions. */
export interface ProductsApi {
  finish(id: string): Promise<void>;
  waste(id: string): Promise<void>;
  reactivate(id: string, newExpiration?: string): Promise<void>;
  remove(id: string): Promise<void>;
}

type ShowToast = (message: string, type?: "success" | "error" | "info") => void;

/** Default expiration when recovering a product with no future date left. */
const REACTIVATE_DEFAULT_DAYS = 7;

export interface ProductActionsState {
  handleAction: (action: ProductAction, product: ProductWithStatus) => void;
  deleteTarget: ProductWithStatus | null;
  reactivateTarget: ProductWithStatus | null;
  confirmDelete: () => void;
  confirmReactivate: (newExpiration: string) => void;
  close: () => void;
}

/**
 * Shared behavior for the ProductCard actions across pages:
 * finish / waste run immediately, reactivate and delete open dialogs.
 */
export function useProductActions(api: ProductsApi, show: ShowToast): ProductActionsState {
  const [deleteTarget, setDeleteTarget] = useState<ProductWithStatus | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<ProductWithStatus | null>(null);

  const handleAction = (action: ProductAction, product: ProductWithStatus) => {
    switch (action) {
      case "finish":
        void api.finish(product.id);
        show(`"${product.name}" consumato`, "success");
        break;
      case "waste":
        void api.waste(product.id);
        show(`"${product.name}" segnato come spreco`, "info");
        break;
      case "reactivate":
        setReactivateTarget(product);
        break;
      case "delete":
        setDeleteTarget(product);
        break;
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    void api.remove(deleteTarget.id);
    show(`"${deleteTarget.name}" eliminato`, "info");
    setDeleteTarget(null);
  };

  const confirmReactivate = (newExpiration: string) => {
    if (!reactivateTarget) return;
    void api.reactivate(reactivateTarget.id, newExpiration);
    show(`"${reactivateTarget.name}" recuperato`, "success");
    setReactivateTarget(null);
  };

  const close = () => {
    setDeleteTarget(null);
    setReactivateTarget(null);
  };

  return { handleAction, deleteTarget, reactivateTarget, confirmDelete, confirmReactivate, close };
}

/** Suggested expiration when recovering: keep the future date, else today + 7 days. */
export function reactivateDefaultDate(expirationDate: string): string {
  return daysUntil(expirationDate) > 0
    ? expirationDate
    : toDateOnly(addDays(todayLocal(), REACTIVATE_DEFAULT_DAYS));
}

/** Renders the confirm-delete and reactivate dialogs for a page using useProductActions. */
export function ProductActionDialogs({ actions }: { actions: ProductActionsState }) {
  const { deleteTarget, reactivateTarget, confirmDelete, confirmReactivate, close } = actions;

  return (
    <>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminare il prodotto?"
        message={`"${deleteTarget?.name ?? ""}" verrà rimosso definitivamente.`}
        confirmLabel="Elimina"
        onConfirm={confirmDelete}
        onClose={close}
      />
      <ReactivateDialog
        open={Boolean(reactivateTarget)}
        product={reactivateTarget}
        onConfirm={confirmReactivate}
        onClose={close}
      />
    </>
  );
}

function ReactivateDialog({
  open,
  product,
  onConfirm,
  onClose,
}: {
  open: boolean;
  product: ProductWithStatus | null;
  onConfirm: (newExpiration: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");

  // Reset the suggested date every time the dialog opens for a product.
  const key = product ? `${product.id}-${open}` : "closed";
  const defaultDate = product ? reactivateDefaultDate(product.expiration_date) : "";
  const effectiveOpen = open && Boolean(product);

  return (
    <Modal open={effectiveOpen} onClose={onClose} title="Recupera prodotto">
      {product && (
        <>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            Il prodotto "{product.name}" torna in dispensa. La scadenza era il {formatDateLong(product.expiration_date)}.
          </p>
          <label className="mt-4 block text-xs font-bold text-ink-500 dark:text-ink-400" htmlFor="reactivate-date">
            Nuova data di scadenza
          </label>
          <input
            key={key}
            id="reactivate-date"
            type="date"
            defaultValue={defaultDate}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm dark:border-ink-700 dark:bg-ink-800"
          />
          <div className="mt-6 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-2xl bg-ink-100 px-4 py-3 text-sm font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
            >
              Annulla
            </button>
            <button
              onClick={() => onConfirm(date || defaultDate)}
              className="flex-1 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700"
            >
              Recupera
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}