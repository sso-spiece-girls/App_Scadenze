import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { lookupProduct, findExistingByBarcode, saveToCatalog } from "../services/productService";
import { fetchCoopPrice } from "../services/priceService";
import { validateBarcode, normalizeBarcode } from "../utils/barcode";
import { addDays, formatDate, toDateOnly, todayLocal } from "../utils/date";
import { formatEuro, formatNumber, parseEuro } from "../utils/money";
import { CATEGORIES } from "../utils/categories";
import type { PriceLookupResult, Product } from "../types";
import { Spinner } from "../components/ui";

const DEFAULT_OFFSET_DAYS = 7;

export function AddProduct() {
  const api = useProducts(true);
  const { show } = useToastContext();
  const navigate = useNavigate();

  // -- capture state -------------------------------------------------------
  const [barcode, setBarcode] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [scanActive, setScanActive] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [existing, setExisting] = useState<Product[]>([]);

  // -- form state ----------------------------------------------------------
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [expirationDate, setExpirationDate] = useState(() => toDateOnly(addDays(todayLocal(), DEFAULT_OFFSET_DAYS)));
  const [priceText, setPriceText] = useState("");
  const [priceLookup, setPriceLookup] = useState<PriceLookupResult | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const [lookupSource, setLookupSource] = useState<"catalog" | "openfoodfacts" | "none">("none");

  const { videoRef, error: scanError, isScanning } = useBarcodeScanner(scanActive, handleDetected);

  const hasLookup = lookupSource !== "none";

  // -- barcode handling -----------------------------------------------------
  async function handleDetected(raw: string) {
    setScanActive(false);
    const code = normalizeBarcode(raw);
    const info = validateBarcode(code);
    if (!info.valid) {
      show(`Codice non valido (${raw})`, "error");
      return;
    }
    await applyCode(code);
  }

  async function applyCode(code: string) {
    setBarcode(code);
    setLookupBusy(true);
    try {
      const { lookup, source } = await lookupProduct(code);
      if (lookup) {
        setName(lookup.name);
        setBrand(lookup.brand ?? "");
        setCategory(lookup.category ?? "");
        setQuantity(lookup.quantity ?? "");
        setUnit(lookup.unit ?? "");
        setImageUrl(lookup.image_url ?? null);
      }
      setLookupSource(source);
      try {
        const found = await findExistingByBarcode(code);
        setExisting(found);
      } catch {
        setExisting([]);
      }

      // The price is fetched automatically as soon as the product is known:
      // the user only confirms or corrects it (never forced to type it).
      if (lookup) {
        void runPriceLookup(code, lookup.name, lookup.brand ?? null);
      }
    } catch {
      setLookupSource("none");
      setExisting([]);
    } finally {
      setLookupBusy(false);
    }
  }

  const onManualCode = async (e: FormEvent) => {
    e.preventDefault();
    const info = validateBarcode(codeInput);
    if (!info.valid) {
      show("Inserisci un codice a barre valido (EAN/UPC/Code 128)", "error");
      return;
    }
    await applyCode(normalizeBarcode(codeInput));
  };

  // -- price lookup ---------------------------------------------------------
  /** Looks up the price (auto after scan, or on demand). Fills the field only as a suggestion. */
  async function runPriceLookup(code: string, productName: string, productBrand: string | null) {
    if (priceBusy) return;
    setPriceBusy(true);
    const result = await fetchCoopPrice(code, productName, productBrand);
    setPriceLookup(result);
    if (result.found && result.price != null) {
      setPriceText(formatNumber(result.price));
      setPriceTouched(false);
    }
    setPriceBusy(false);
  }

  function onPriceLookup() {
    if (!barcode || priceBusy) return;
    void runPriceLookup(barcode, name, brand);
  }

  // -- save -----------------------------------------------------------------
  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      show("Inserisci il nome del prodotto", "error");
      return;
    }
    if (!expirationDate) {
      show("Inserisci la data di scadenza", "error");
      return;
    }
    let price = 0;
    if (priceText.trim()) {
      const parsed = parseEuro(priceText);
      if (parsed === null) {
        show("Prezzo non valido (es. 2,99)", "error");
        return;
      }
      price = parsed;
    }

    setSaving(true);
    try {
      await api.add({
        barcode: barcode ?? `manual-${Date.now()}`,
        name: name.trim(),
        brand: brand.trim() || null,
        category: category || null,
        image_url: imageUrl,
        quantity: quantity.trim() || null,
        unit: unit.trim() || null,
        purchase_date: purchaseDate || null,
        expiration_date: expirationDate,
        price,
        price_source: priceLookup?.found ? priceLookup.source : "manual",
        price_fetched_at: priceLookup?.fetchedAt ?? null,
        price_was_manually_corrected: priceLookup?.found ? priceTouched : false,
      });
      show("Prodotto aggiunto alla dispensa", "success");
      navigate("/products");

      // Remember manually-entered identities so future scans are instant.
      // (OFF/catalog lookups are already saved inside lookupProduct.)
      if (barcode && lookupSource === "none") {
        try {
          await saveToCatalog(
            barcode,
            {
              name: name.trim(),
              brand: brand.trim() || null,
              category: category || null,
              image_url: imageUrl,
              quantity: quantity.trim() || null,
              unit: unit.trim() || null,
            },
            "manual",
          );
        } catch {
          // non fatal
        }
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Errore durante il salvataggio", "error");
    } finally {
      setSaving(false);
    }
  }

  const resetCapture = () => {
    setBarcode(null);
    setManualMode(false);
    setScanActive(false);
    setCodeInput("");
    setLookupSource("none");
    setExisting([]);
    setPriceLookup(null);
    setPriceText("");
    setPriceTouched(false);
    setName("");
    setBrand("");
    setCategory("");
    setQuantity("");
    setUnit("");
    setImageUrl(null);
    setPurchaseDate("");
    setExpirationDate(toDateOnly(addDays(todayLocal(), DEFAULT_OFFSET_DAYS)));
  };

  const cameraErrorLabel = useMemo(() => {
    if (scanError === "denied") return "Permesso fotocamera negato";
    if (scanError === "no-camera") return "Nessuna fotocamera disponibile";
    if (scanError === "unknown") return "Errore durante la scansione";
    return null;
  }, [scanError]);

  // -- render ---------------------------------------------------------------
  if (!barcode && !manualMode) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-extrabold tracking-tight">Aggiungi prodotto</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">Scansiona il codice a barre o inseriscilo a mano.</p>
        </header>

        {scanActive && (
          <div className="relative overflow-hidden rounded-3xl bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 inset-y-6 rounded-2xl border-2 border-brand-400 scan-frame" />
            {isScanning && (
              <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white">
                Inquadra il codice a barre…
              </p>
            )}
          </div>
        )}

        {cameraErrorLabel && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {cameraErrorLabel}. Puoi comunque inserire il codice manualmente.
          </div>
        )}

        {!scanActive && !cameraErrorLabel && (
          <button
            onClick={() => setScanActive(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-4 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700"
          >
            📷 Scansiona codice
          </button>
        )}

        <form onSubmit={onManualCode} className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <label htmlFor="manual-barcode" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
            Oppure inserisci il codice a barre
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="manual-barcode"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Es. 8012345678901"
              inputMode="numeric"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
            <button
              type="submit"
              className="rounded-2xl bg-ink-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100"
            >
              Cerca
            </button>
          </div>
        </form>

        <button onClick={() => setManualMode(true)} className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
          Inserisci manualmente senza codice →
        </button>
      </div>
    );
  }

  // -- form view -------------------------------------------------------------
  return (
    <form onSubmit={onSave} className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Aggiungi prodotto</h1>
          {barcode && <p className="mt-0.5 break-all text-sm text-ink-500 dark:text-ink-400">Codice: {barcode}</p>}
        </div>
        <button type="button" onClick={resetCapture} className="rounded-2xl px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
          ← Cambia
        </button>
      </header>

      {lookupBusy && (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          <Spinner className="size-4" /> Cerco il prodotto…
        </div>
      )}

      {existing.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-bold">Questo prodotto è già presente.</p>
          <p className="mt-1">
            Hai {existing.length} confezion{existing.length > 1 ? "i" : "e"} in dispensa
            {existing.length > 0 && (
              <>
                {" "}(scadenz{existing.length > 1 ? "e" : "a"}: {existing.map((p) => formatDate(p.expiration_date)).join(", ")})
              </>
            )}
            . Puoi aggiungere una nuova confezione con una scadenza diversa.
          </p>
        </div>
      )}

      {hasLookup && !lookupBusy && (
        <div className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="size-12 rounded-xl object-cover" />
          ) : (
            <span className="grid size-12 place-items-center rounded-xl bg-ink-100 text-2xl dark:bg-ink-800">📦</span>
          )}
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Trovato su {lookupSource === "catalog" ? "il tuo catalogo" : "Open Food Facts"}. Controlla i dati e aggiungi scadenza e prezzo.
          </p>
        </div>
      )}

      <div className="space-y-4 rounded-3xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div>
          <label htmlFor="f-name" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
            Nome *
          </label>
          <input
            id="f-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Es. Yogurt alla fragola"
            className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-brand" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Marca
            </label>
            <input
              id="f-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Es. Valio"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="f-category" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Categoria
            </label>
            <select
              id="f-category"
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
            <label htmlFor="f-quantity" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Quantità
            </label>
            <input
              id="f-quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Es. 4x100 g"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="f-unit" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Unità
            </label>
            <select
              id="f-unit"
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
            <label htmlFor="f-purchase" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Data di acquisto
            </label>
            <input
              id="f-purchase"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label htmlFor="f-expiry" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
              Scadenza *
            </label>
            <input
              id="f-expiry"
              type="date"
              required
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
        </div>

        <div>
          <label htmlFor="f-price" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
            Prezzo (€)
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="f-price"
              value={priceText}
              onChange={(e) => {
                setPriceText(e.target.value);
                setPriceTouched(true);
              }}
              placeholder="0,00"
              inputMode="decimal"
              className="min-w-0 flex-1 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm tabular-nums outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
            />
            <button
              type="button"
              onClick={onPriceLookup}
              disabled={!barcode || priceBusy}
              className="flex items-center gap-1.5 rounded-2xl bg-ink-900 px-4 py-3 text-xs font-bold text-white transition hover:bg-ink-800 disabled:opacity-50 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100"
            >
              {priceBusy ? <Spinner className="size-4" /> : "🔍"} Cerca prezzo
            </button>
          </div>
          {priceLookup?.found && parseEuro(priceText) !== null && (
            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
              Prezzo da {priceLookup.source === "s-kaupat" ? "S-Kaupat/Coop" : priceLookup.source}
              {priceLookup.cached ? " (cache)" : ""}: {formatEuro(parseEuro(priceText) ?? 0)}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetCapture}
          className="flex-1 rounded-2xl bg-ink-100 px-4 py-3.5 text-sm font-bold text-ink-700 transition dark:bg-ink-800 dark:text-ink-200"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={saving || lookupBusy}
          className="flex-1 rounded-2xl bg-brand-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Salvataggio…" : "Salva in dispensa"}
        </button>
      </div>
    </form>
  );
}