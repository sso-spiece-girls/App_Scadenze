import { useEffect, useState } from "react";
import type { Product, ProductStatus, ProductWithStatus } from "../types";
import { addDays, daysUntil, formatDateLong, isoNow, toDateOnly, todayLocal } from "../utils/date";
import { ConfirmDialog, Modal } from "./Modal";
import { ProductForm, formValuesFromProduct } from "./ProductForm";
import { useToastContext } from "../context/ToastContext";
import type { ProductAction } from "./ProductCard";

/** Subset of the useProducts API needed by the product actions. */
export interface ProductsApi {
  finish(id: string): Promise<void>;
  consume(id: string): Promise<Product | null>;
  waste(id: string): Promise<void>;
  reactivate(id: string, newExpiration?: string): Promise<void>;
  remove(id: string): Promise<void>;
  update(id: string, patch: Partial<Product>): Promise<Product>;
}

type ShowToast = (message: string, type?: "success" | "error" | "info") => void;

/** Default expiration when recovering a product with no future date left. */
const REACTIVATE_DEFAULT_DAYS = 7;

export interface ProductActionsState {
  handleAction: (action: ProductAction, product: ProductWithStatus) => void;
  deleteTarget: ProductWithStatus | null;
  reactivateTarget: ProductWithStatus | null;
  editTarget: ProductWithStatus | null;
  confirmDelete: () => void;
  confirmReactivate: (newExpiration: string) => void;
  close: () => void;
}

/**
 * Shared behavior for the ProductCard actions across pages:
 * finish / consume / waste run immediately, edit / reactivate / delete open
 * dialogs.
 */
export function useProductActions(api: ProductsApi, show: ShowToast): ProductActionsState {
  const [deleteTarget, setDeleteTarget] = useState<ProductWithStatus | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<ProductWithStatus | null>(null);
  const [editTarget, setEditTarget] = useState<ProductWithStatus | null>(null);

  const handleAction = (action: ProductAction, product: ProductWithStatus) => {
    switch (action) {
      case "finish":
        void api.finish(product.id);
        show(`"${product.name}" consumato`, "success");
        break;
      case "consume":
        void api.consume(product.id).then((updated) => {
          if (updated?.status === "finished") {
            show(`"${product.name}" finito`, "success");
          } else {
            show(`Consumata 1 unità di "${product.name}"`, "info");
          }
        });
        break;
      case "waste":
        void api.waste(product.id);
        show(`"${product.name}" segnato come spreco`, "info");
        break;
      case "edit":
        setEditTarget(product);
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
    setEditTarget(null);
  };

  return { handleAction, deleteTarget, reactivateTarget, editTarget, confirmDelete, confirmReactivate, close };
}

/** Suggested expiration when recovering: keep the future date, else today + 7 days. */
export function reactivateDefaultDate(expirationDate: string | null): string {
  return expirationDate && daysUntil(expirationDate) > 0
    ? expirationDate
    : toDateOnly(addDays(todayLocal(), REACTIVATE_DEFAULT_DAYS));
}

/** Renders the confirm-delete / reactivate / edit dialogs for a page using useProductActions. */
export function ProductActionDialogs({ actions, api }: { actions: ProductActionsState; api: ProductsApi }) {
  const { deleteTarget, reactivateTarget, editTarget, confirmDelete, confirmReactivate, close } = actions;

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
      <EditProductDialog open={Boolean(editTarget)} product={editTarget} api={api} onClose={close} />
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

const STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: "active", label: "🟢 Attivo (in dispensa)" },
  { value: "finished", label: "⚫ Finito (consumato)" },
  { value: "expired", label: "🔴 Scaduto" },
  { value: "wasted", label: "💸 Sprecato" },
];

/**
 * Edit dialog: full product form pre-filled with the current values, plus the
 * status selector. Saving updates the DB and the local store immediately
 * (optimistic) — no duplicates are ever created (update by id).
 */
function EditProductDialog({
  open,
  product,
  api,
  onClose,
}: {
  open: boolean;
  product: ProductWithStatus | null;
  api: { update(id: string, patch: Partial<Product>): Promise<Product> };
  onClose: () => void;
}) {
  const { show } = useToastContext();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ProductStatus>("active");

  // Reset the status selector every time the dialog opens for a product.
  useEffect(() => {
    if (product) setStatus(product.status);
  }, [product?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (input: Omit<Parameters<typeof api.update>[1], "barcode">) => {
    if (!product) return;
    setSaving(true);
    try {
      const patch: Partial<Product> = { ...input };
      if (status !== product.status) {
        patch.status = status;
        patch.finished_at = status === "finished" ? isoNow() : null;
        patch.wasted_at = status === "wasted" ? product.expiration_date : null;
        if (status === "finished") patch.consumed_count = product.quantity_count ?? 1;
      }
      await api.update(product.id, patch);
      show(`"${product.name}" aggiornato`, "success");
      onClose();
    } catch (err) {
      show(err instanceof Error ? err.message : "Errore durante la modifica", "error");
    } finally {
      setSaving(false);
    }
  };

  const effectiveOpen = open && Boolean(product);

  return (
    <Modal open={effectiveOpen} onClose={onClose} title="Modifica prodotto">
      {product && (
        <div className="space-y-4">
          <div>
            <label htmlFor="ep-status" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Stato
            </label>
            <select
              id="ep-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <ProductForm
            key={product.id}
            initial={formValuesFromProduct(product)}
            saving={saving}
            submitLabel="Salva modifiche"
            onCancel={onClose}
            onSubmit={onSubmit}
          />
        </div>
      )}
    </Modal>
  );
}