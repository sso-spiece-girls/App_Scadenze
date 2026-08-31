import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";

/**
 * AddMenu — the "+ Aggiungi" action sheet available from the layout FAB and
 * the dashboard button. Three primary ways to add products:
 *   1. 📷 Scansiona prodotto (barcode camera);
 *   2. 🧾 Importa spesa (receipt barcode → OCR → confirm);
 *   3. ✍️ Inserisci manualmente.
 */

interface AddMenuContextValue {
  open: () => void;
  close: () => void;
}

const AddMenuContext = createContext<AddMenuContextValue | null>(null);

export function useAddMenu(): AddMenuContextValue {
  const ctx = useContext(AddMenuContext);
  if (!ctx) throw new Error("useAddMenu deve essere usato dentro AddMenuProvider");
  return ctx;
}

export function AddMenuProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [openState, setOpenState] = useState(false);

  const open = useCallback(() => setOpenState(true), []);
  const close = useCallback(() => setOpenState(false), []);

  const go = (to: string) => {
    setOpenState(false);
    navigate(to);
  };

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <AddMenuContext.Provider value={value}>
      {children}
      <Modal open={openState} onClose={close} title="Aggiungi">
        <div className="space-y-3">
          <button
            onClick={() => go("/add")}
            className="flex w-full items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left transition hover:border-brand-400 dark:border-ink-700 dark:bg-ink-800"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-600/10 text-2xl">📷</span>
            <span>
              <span className="block text-sm font-bold">Scansiona prodotto</span>
              <span className="block text-xs text-ink-500 dark:text-ink-400">Inquadra il codice a barre con la fotocamera</span>
            </span>
          </button>

          <button
            onClick={() => go("/import")}
            className="flex w-full items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left transition hover:border-brand-400 dark:border-ink-700 dark:bg-ink-800"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-600/10 text-2xl">🧾</span>
            <span>
              <span className="block text-sm font-bold">Importa spesa</span>
              <span className="block text-xs text-ink-500 dark:text-ink-400">Barcode o foto dello scontrino: prodotti, quantità e prezzi</span>
            </span>
          </button>

          <button
            onClick={() => go("/add?mode=manual")}
            className="flex w-full items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left transition hover:border-brand-400 dark:border-ink-700 dark:bg-ink-800"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-600/10 text-2xl">✍️</span>
            <span>
              <span className="block text-sm font-bold">Inserisci manualmente</span>
              <span className="block text-xs text-ink-500 dark:text-ink-400">Aggiungi un prodotto senza codice a barre</span>
            </span>
          </button>
        </div>
      </Modal>
    </AddMenuContext.Provider>
  );
}