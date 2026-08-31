import { useState, type FormEvent } from "react";
import type { ProductInput, ProductLookup } from "../types";
import { useToastContext } from "../context/ToastContext";
import { addDays, toDateOnly, todayLocal } from "../utils/date";
import { formatNumber, parseEuro } from "../utils/money";
import { CATEGORIES } from "../utils/categories";

export interface ProductFormValues {
  name: string;
  brand: string;
  category: string;
  quantity: string;
  unit: string;
  /** Physical units bought, as text ("1", "3", …). */
  quantityCount: string;
  purchaseDate: string;
  expirationDate: string;
  priceText: string;
  notes: string;
  imageUrl: string | null;
}

export const DEFAULT_OFFSET_DAYS = 7;

export function defaultExpiration(): string {
  return toDateOnly(addDays(todayLocal(), DEFAULT_OFFSET_DAYS));
}

export function emptyFormValues(): ProductFormValues {
  return {
    name: "",
    brand: "",
    category: "",
    quantity: "",
    unit: "",
    quantityCount: "1",
    purchaseDate: "",
    expirationDate: defaultExpiration(),
    priceText: "",
    notes: "",
    imageUrl: null,
  };
}

export function formValuesFromProduct(p: {
  name: string;
  brand: string | null;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  quantity_count: number;
  purchase_date: string | null;
  expiration_date: string | null;
  price: number;
  notes: string | null;
  image_url: string | null;
}): ProductFormValues {
  return {
    name: p.name,
    brand: p.brand ?? "",
    category: p.category ?? "",
    quantity: p.quantity ?? "",
    unit: p.unit ?? "",
    quantityCount: String(p.quantity_count ?? 1),
    purchaseDate: p.purchase_date ?? "",
    expirationDate: p.expiration_date ?? "",
    priceText: p.price > 0 ? formatNumber(p.price) : "",
    notes: p.notes ?? "",
    imageUrl: p.image_url,
  };
}

export interface ProductFormProps {
  /** Seed values for the form (re-applied when `key` changes). */
  initial: ProductFormValues;
  /** Lookup banner to show above the fields ("Trovato su …"). */
  lookupBanner?: { source: ProductLookup["source"]; imageUrl: string | null } | null;
  lookupBusy?: boolean;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  /** The barcode is decided by the caller (kept unchanged in edit mode). */
  onSubmit: (input: Omit<ProductInput, "barcode">) => Promise<void>;
}

/**
 * Shared product form used by both "Aggiungi prodotto" and the edit modal.
 * Owns its field state (seeded from `initial`); the parent re-mounts it with
 * a new `key` to apply a different seed (e.g. after a barcode lookup).
 */
export function ProductForm({
  initial,
  lookupBanner,
  lookupBusy = false,
  saving,
  submitLabel,
  onCancel,
  onSubmit,
}: ProductFormProps) {
  const [name, setName] = useState(initial.name);
  const [brand, setBrand] = useState(initial.brand);
  const [category, setCategory] = useState(initial.category);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [unit, setUnit] = useState(initial.unit);
  const [quantityCount, setQuantityCount] = useState(initial.quantityCount);
  const [purchaseDate, setPurchaseDate] = useState(initial.purchaseDate);
  const [expirationDate, setExpirationDate] = useState(initial.expirationDate);
  const [priceText, setPriceText] = useState(initial.priceText);
  const [notes, setNotes] = useState(initial.notes);
  const { show } = useToastContext();

  const priceIsValid = priceText.trim() === "" || parseEuro(priceText) !== null;

  // -- save -----------------------------------------------------------------
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      show("Inserisci il nome del prodotto", "error");
      return;
    }
    if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
      show("Data di scadenza non valida", "error");
      return;
    }
    if (!priceIsValid) {
      show("Prezzo non valido (es. 2,99)", "error");
      return;
    }

    let price = 0;
    if (priceText.trim()) {
      const parsed = parseEuro(priceText);
      if (parsed === null) return;
      price = parsed;
    }

    const count = Math.max(1, parseInt(quantityCount, 10) || 1);

    try {
      await onSubmit({
        name: name.trim(),
        brand: brand.trim() || null,
        category: category || null,
        image_url: initial.imageUrl,
        quantity: quantity.trim() || null,
        unit: unit.trim() || null,
        quantity_count: count,
        notes: notes.trim() || null,
        purchase_date: purchaseDate || null,
        expiration_date: expirationDate,
        price,
        // The price is always entered/confirmed by the user (from the receipt
        // when imported, or from memory): no automatic catalog price exists.
        price_source: price > 0 ? "manual" : "none",
      });
    } catch (err) {
      show(err instanceof Error ? err.message : "Errore durante il salvataggio", "error");
    }
  };

  const sourceLabel =
    lookupBanner?.source === "catalog"
      ? "il tuo catalogo"
      : "Open Food Facts";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {lookupBanner && !lookupBusy && (
        <div className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          {lookupBanner.imageUrl ? (
            <img src={lookupBanner.imageUrl} alt="" className="size-12 rounded-xl object-cover" />
          ) : (
            <span className="grid size-12 place-items-center rounded-xl bg-ink-100 text-2xl dark:bg-ink-800">📦</span>
          )}
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Trovato su {sourceLabel}. Controlla i dati e aggiungi scadenza e prezzo.
          </p>
        </div>
      )}

      <div className="space-y-4 rounded-3xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div>
          <label htmlFor="pf-name" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
            Nome *
          </label>
          <input
            id="pf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Es. Yogurt alla fragola"
            className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-brand" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Marca
            </label>
            <input
              id="pf-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Es. Valio"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="pf-category" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Categoria
            </label>
            <select
              id="pf-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            >
              <option value="">— Seleziona —</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.emoji} {c.value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-quantity" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Quantità (formato)
            </label>
            <input
              id="pf-quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Es. 4x100 g"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="pf-unit" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Unità
            </label>
            <select
              id="pf-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            >
              <option value="">—</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">l</option>
              <option value="pcs">pz</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-count" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Confezioni acquistate
            </label>
            <input
              id="pf-count"
              type="number"
              min={1}
              step={1}
              value={quantityCount}
              onChange={(e) => setQuantityCount(e.target.value)}
              placeholder="1"
              inputMode="numeric"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
            <p className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
              Es. 3 latti uguali con la stessa scadenza.
            </p>
          </div>
          <div>
            <label htmlFor="pf-expiry" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Scadenza
            </label>
            <input
              id="pf-expiry"
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
            <p className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
              Puoi inserirla anche più tardi.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-purchase" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Data di acquisto
            </label>
            <input
              id="pf-purchase"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="pf-price" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Prezzo unitario (€)
            </label>
            <input
              id="pf-price"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm tabular-nums outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
            <p className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
              Se importi lo scontrino viene usato il prezzo realmente pagato.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="pf-notes" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
            Note
          </label>
          <textarea
            id="pf-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Es. Da consumare entro il weekend"
            className="mt-1 w-full resize-none rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-2xl bg-ink-100 px-4 py-3.5 text-sm font-bold text-ink-700 transition dark:bg-ink-800 dark:text-ink-200"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={saving || lookupBusy || !priceIsValid}
          className="flex-1 rounded-2xl bg-brand-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Salvataggio…" : submitLabel}
        </button>
      </div>
    </form>
  );
}