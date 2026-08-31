import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { lookupProduct, saveToCatalog } from "../services/productService";
import { validateBarcode, normalizeBarcode } from "../utils/barcode";
import { formatDate } from "../utils/date";
import { Spinner } from "../components/ui";
import { ProductForm, emptyFormValues, type ProductFormValues } from "../components/ProductForm";
import type { Product, ProductLookup } from "../types";

type LookupSource = ProductLookup["source"] | "none";

export function AddProduct() {
  const api = useProducts(true);
  const { show } = useToastContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // -- capture state -------------------------------------------------------
  const [barcode, setBarcode] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(() => searchParams.get("mode") === "manual");
  const [scanActive, setScanActive] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [existing, setExisting] = useState<Product[]>([]);
  const [invalidCode, setInvalidCode] = useState<string | null>(null);
  const [lookupSource, setLookupSource] = useState<LookupSource>("none");
  const [formSeed, setFormSeed] = useState<ProductFormValues>(() => emptyFormValues());
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleDetected = (raw: string) => {
    setScanActive(false);
    const code = normalizeBarcode(raw);
    const info = validateBarcode(code);
    if (!info.valid) {
      setInvalidCode(raw);
      show(`Codice non valido (${raw})`, "error");
      return;
    }
    setInvalidCode(null);
    void applyCode(code);
  };

  const { videoRef, error: scanError, isScanning, toggleCamera, facing } = useBarcodeScanner(scanActive, handleDetected);

  // -- barcode handling -----------------------------------------------------
  async function applyCode(code: string) {
    setBarcode(code);
    setLookupBusy(true);
    try {
      // "Already in pantry" comes from the global store (zero network); the
      // lookup chain reuses the same in-memory list for its level-2 check and
      // the session barcode cache for repeated scans.
      const found = api.products.filter((p) => p.barcode === code && p.status !== "finished");
      const { lookup, source } = await lookupProduct(code, { pantry: api.products });
      setExisting(found);
      setLookupSource(source);

      if (lookup) {
        setFormSeed({
          name: lookup.name,
          brand: lookup.brand ?? "",
          category: lookup.category ?? "",
          quantity: lookup.quantity ?? "",
          unit: lookup.unit ?? "",
          quantityCount: "1",
          purchaseDate: "",
          expirationDate: emptyFormValues().expirationDate,
          priceText: "",
          notes: "",
          imageUrl: lookup.image_url ?? null,
        });
        setFormKey((k) => k + 1);
      } else {
        setFormSeed(emptyFormValues());
        setFormKey((k) => k + 1);
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

  // -- save -----------------------------------------------------------------
  const onSave = async (input: Omit<Parameters<typeof api.add>[0], "barcode">) => {
    setSaving(true);
    try {
      const source = lookupSource;
      await api.add({
        ...input,
        barcode: barcode ?? `manual-${Date.now()}`,
        import_method: barcode ? "barcode" : "manual",
      });
      show("Prodotto aggiunto alla dispensa", "success");
      navigate("/products");

      // Remember manually-entered identities so future scans are instant.
      if (barcode && source === "none") {
        try {
          await saveToCatalog(
            barcode,
            {
              name: input.name,
              brand: input.brand ?? null,
              category: input.category ?? null,
              image_url: input.image_url ?? null,
              quantity: input.quantity ?? null,
              unit: input.unit ?? null,
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
  };

  const resetCapture = () => {
    setBarcode(null);
    setManualMode(false);
    setScanActive(false);
    setCodeInput("");
    setInvalidCode(null);
    setLookupSource("none");
    setExisting([]);
    setFormSeed(emptyFormValues());
    setFormKey((k) => k + 1);
  };

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
            <button
              type="button"
              onClick={toggleCamera}
              className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-2 text-xs font-bold text-white"
            >
              🔄 {facing === "environment" ? "Posteriore" : "Frontale"}
            </button>
          </div>
        )}

        {scanError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {scanError === "denied"
              ? "Permesso fotocamera negato. Abilitalo dalle impostazioni del browser."
              : scanError === "no-camera"
                ? "Nessuna fotocamera disponibile."
                : "Errore durante la scansione."}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setScanActive(true)}
                className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-ink-900"
              >
                Riprova
              </button>
              <button
                onClick={() => setManualMode(true)}
                className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
              >
                Inserisci manualmente
              </button>
            </div>
          </div>
        )}

        {invalidCode && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            Codice non riconosciuto ({invalidCode}).
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setInvalidCode(null);
                  setScanActive(true);
                }}
                className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-ink-900"
              >
                🔄 Riprova
              </button>
              <button
                onClick={() => {
                  setInvalidCode(null);
                  setCodeInput(invalidCode);
                  setManualMode(true);
                }}
                className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
              >
                Usa questo codice
              </button>
            </div>
          </div>
        )}

        {!scanActive && !scanError && !invalidCode && (
          <button
            onClick={() => setScanActive(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-4 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700"
          >
            📷 Scansiona codice
          </button>
        )}

        {scanActive && (
          <button
            onClick={() => setScanActive(false)}
            className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
          >
            Chiudi scanner
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
  const hasLookup = lookupSource !== "none";

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Aggiungi prodotto</h1>
          {barcode && <p className="mt-0.5 break-all text-sm text-ink-500 dark:text-ink-400">Codice: {barcode}</p>}
        </div>
        <button onClick={resetCapture} className="rounded-2xl px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
          ← Cambia
        </button>
      </header>

      {lookupBusy && (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          <Spinner className="size-4" /> Cerco il prodotto…
        </div>
      )}

      {!hasLookup && !lookupBusy && barcode && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-bold">Prodotto non trovato.</p>
          <p className="mt-1">
            Nessuna fonte conosce questo codice. Inserisci i dati manualmente: verranno ricordati per le prossime scansioni.
          </p>
        </div>
      )}

      {existing.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-bold">Questo prodotto è già presente.</p>
          <p className="mt-1">
            Hai {existing.length} confezion{existing.length > 1 ? "i" : "e"} in dispensa (scadenz
            {existing.length > 1 ? "e" : "a"}: {existing.map((p) => formatDate(p.expiration_date)).join(", ")}).
            Puoi aggiungere una nuova confezione con una scadenza diversa.
          </p>
        </div>
      )}

      <ProductForm
        key={formKey}
        initial={formSeed}
        lookupBanner={hasLookup ? { source: lookupSource as ProductLookup["source"], imageUrl: formSeed.imageUrl } : null}
        lookupBusy={lookupBusy}
        saving={saving}
        submitLabel="Salva in dispensa"
        onCancel={resetCapture}
        onSubmit={onSave}
      />
    </div>
  );
}