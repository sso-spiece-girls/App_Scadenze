import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { recognizeReceiptText, preprocessReceiptImage, loadImageFromFile, type OcrProgress } from "../services/ocrService";
import { parseReceiptText, receiptLooksReliable } from "../services/receiptParser";
import { savePurchase } from "../services/purchaseService";
import { formatEuro, parseEuro, roundMoney } from "../utils/money";
import { todayLocal, toDateOnly } from "../utils/date";
import { Spinner } from "../components/ui";
import type { ParsedReceipt, ReceiptLine } from "../types";

type Step = "start" | "scan" | "photo" | "ocr" | "confirm" | "done";

interface EditableLine extends ReceiptLine {
  selected: boolean;
}

/**
 * Importa spesa.
 *
 * The Unicoop Firenze / Coop.fi receipt barcode (a long store-internal code,
 * 999…) has no public resolution service, so the flow is:
 *
 *   scan receipt barcode → honest explanation → photo of the receipt
 *     → OCR (on-device Tesseract, Italian) → confirm screen (every field
 *     editable) → save purchase + products.
 *
 * Nothing is ever saved without the user's confirmation, and expiration
 * dates are never invented (products keep `expiration_date = null` and the
 * user sets them later). The price used is the one printed on the receipt
 * (the price really paid), never a catalog price.
 */
export function Import() {
  const api = useProducts(true);
  const { show } = useToastContext();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("start");
  const [receiptCode, setReceiptCode] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // -- parsed + editable state ----------------------------------------------
  const [store, setStore] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState<string>(() => toDateOnly(todayLocal()));
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [saving, setSaving] = useState(false);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const handleDetected = (raw: string) => {
    setReceiptCode(raw);
    setStep("photo");
  };
  const { videoRef, error: scanError, isScanning, stop, toggleCamera, facing } = useBarcodeScanner(step === "scan", handleDetected);

  // Photo preview cleanup.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const onPhotoChosen = (file: File | null) => {
    if (!file) return;
    setPhoto(file);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setOcrError(null);
  };

  // -- OCR ------------------------------------------------------------------
  const runOcr = async () => {
    if (!photo) return;
    setStep("ocr");
    setOcrProgress(null);
    setOcrError(null);
    try {
      const img = await loadImageFromFile(photo);
      const preprocessed = preprocessReceiptImage(img);
      const text = await recognizeReceiptText(preprocessed, setOcrProgress);
      const parsed = parseReceiptText(text);
      applyParsed(parsed);
      setStep("confirm");
      show(receiptLooksReliable(parsed) ? "Scontrino riconosciuto" : "Riconoscimento parziale: controlla i dati", parsed.lines.length ? "success" : "error");
    } catch (err) {
      console.error("ocr failed", err);
      setOcrError(err instanceof Error ? err.message : "Errore durante il riconoscimento");
      setStep("photo");
    }
  };

  const applyParsed = (parsed: ParsedReceipt) => {
    setStore(parsed.store ?? "");
    if (parsed.purchaseDate) setPurchaseDate(parsed.purchaseDate);
    setReceiptTotal(parsed.total);
    setLines(
      parsed.lines.map((l) => ({
        ...l,
        selected: true,
      })),
    );
  };

  // -- confirm screen editing ------------------------------------------------
  const updateLine = (index: number, patch: Partial<EditableLine>) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        // Keep total consistent: editing the unit price recomputes the total.
        if (patch.unitPrice !== undefined || patch.quantity !== undefined) {
          next.totalPrice = roundMoney(next.unitPrice * next.quantity);
        }
        return next;
      }),
    );
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { name: "", quantity: 1, unitPrice: 0, totalPrice: 0, barcode: null, selected: true },
    ]);
  };

  const selectedLines = useMemo(() => lines.filter((l) => l.selected), [lines]);
  const selectedTotal = useMemo(
    () => roundMoney(selectedLines.reduce((sum, l) => sum + l.totalPrice, 0)),
    [selectedLines],
  );
  const needsExpiryCount = selectedLines.length;

  // -- save ------------------------------------------------------------------
  const confirmPurchase = async () => {
    const valid = selectedLines.filter((l) => l.name.trim() && l.totalPrice > 0);
    if (valid.length === 0) {
      show("Nessuna riga valida da salvare", "error");
      return;
    }
    setSaving(true);
    try {
      const { products } = await savePurchase({
        store: store.trim() || null,
        purchaseDate: purchaseDate || toDateOnly(todayLocal()),
        total: receiptTotal ?? selectedTotal,
        importMethod: receiptCode ? "receipt_barcode" : "ocr",
        receiptIdentifier: receiptCode,
        lines: valid.map((l) => ({
          name: l.name.trim(),
          quantity: Math.max(1, l.quantity),
          unitPrice: l.unitPrice,
          totalPrice: l.totalPrice,
          barcode: l.barcode ?? null,
        })),
      });
      api.mergeCreated(products);
      setStep("done");
    } catch (err) {
      show(err instanceof Error ? err.message : "Errore durante il salvataggio", "error");
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    stop();
    setStep("start");
    setReceiptCode(null);
    setPhoto(null);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLines([]);
    setReceiptTotal(null);
    setStore("");
    setPurchaseDate(toDateOnly(todayLocal()));
    setOcrError(null);
  };

  // -- render ----------------------------------------------------------------
  if (step === "done") {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-extrabold tracking-tight">Importa spesa</h1>
        </header>
        <div className="rounded-3xl border border-ink-200 bg-white p-6 text-center dark:border-ink-800 dark:bg-ink-900">
          <p className="text-4xl">🎉</p>
          <h2 className="mt-3 text-lg font-extrabold">Spesa importata</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {selectedLines.length} prodotti aggiunti alla dispensa con quantità e prezzi reali.
          </p>
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            ⚠️ {needsExpiryCount} prodott{needsExpiryCount === 1 ? "o" : "i"} richiedono una data di scadenza.
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Link
              to="/products?filter=noexpiry"
              className="rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700"
            >
              Imposta le scadenze ora
            </Link>
            <button onClick={() => navigate("/products")} className="rounded-2xl bg-ink-100 px-4 py-3 text-sm font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200">
              Vai alla dispensa
            </button>
            <button onClick={resetAll} className="rounded-2xl px-4 py-2 text-sm font-semibold text-ink-500 dark:text-ink-400">
              Importa un'altra spesa
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Conferma spesa</h1>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
              Controlla e correggi le righe prima di salvare.
            </p>
          </div>
          <button onClick={() => setStep("photo")} className="rounded-2xl px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
            ← Indietro
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-ink-500 dark:text-ink-400" htmlFor="imp-store">
              Negozio
            </label>
            <input
              id="imp-store"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="Coop.fi"
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-500 dark:text-ink-400" htmlFor="imp-date">
              Data acquisto
            </label>
            <input
              id="imp-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-800"
            />
          </div>
        </div>

        {receiptTotal !== null && Math.abs(receiptTotal - selectedTotal) > 0.01 && (
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Totale scontrino: {formatEuro(receiptTotal)} · righe selezionate: {formatEuro(selectedTotal)}
          </p>
        )}

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="rounded-2xl border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={line.selected}
                  onChange={(e) => updateLine(i, { selected: e.target.checked })}
                  className="mt-3 size-5 shrink-0 accent-brand-600"
                  aria-label="Includi riga"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    value={line.name}
                    onChange={(e) => updateLine(i, { name: e.target.value })}
                    placeholder="Nome prodotto"
                    className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-ink-400" htmlFor={`q-${i}`}>
                        Qtà
                      </label>
                      <input
                        id={`q-${i}`}
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(i, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-ink-400" htmlFor={`u-${i}`}>
                        Prezzo unit.
                      </label>
                      <input
                        id={`u-${i}`}
                        inputMode="decimal"
                        value={line.unitPrice > 0 ? line.unitPrice.toFixed(2).replace(".", ",") : ""}
                        onChange={(e) => {
                          const v = parseEuro(e.target.value);
                          updateLine(i, { unitPrice: v ?? 0 });
                        }}
                        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-ink-400" htmlFor={`t-${i}`}>
                        Totale riga
                      </label>
                      <input
                        id={`t-${i}`}
                        inputMode="decimal"
                        value={line.totalPrice > 0 ? line.totalPrice.toFixed(2).replace(".", ",") : ""}
                        onChange={(e) => {
                          const v = parseEuro(e.target.value);
                          updateLine(i, {
                            totalPrice: v ?? 0,
                            unitPrice: line.quantity > 0 ? roundMoney((v ?? 0) / line.quantity) : 0,
                          });
                        }}
                        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => removeLine(i)}
                  className="mt-3 rounded-xl px-2 py-2 text-sm text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                  aria-label="Elimina riga"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addLine} className="w-full rounded-2xl border border-dashed border-ink-300 px-4 py-3 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800">
          ＋ Aggiungi riga manuale
        </button>

        <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-ink-500 dark:text-ink-400">
              {selectedLines.length} righe · {selectedLines.reduce((s, l) => s + l.quantity, 0)} unità
            </span>
            <span className="text-base font-extrabold tabular-nums">{formatEuro(selectedTotal)}</span>
          </div>
        </div>

        <button
          onClick={() => void confirmPurchase()}
          disabled={saving || selectedLines.length === 0}
          className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? <Spinner className="mx-auto size-5" /> : "Conferma spesa"}
        </button>
        <p className="text-center text-xs text-ink-400 dark:text-ink-500">
          I prodotti saranno salvati senza data di scadenza: potrai impostarla subito dopo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">🧾 Importa spesa</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            Da scontrino a dispensa in pochi passi.
          </p>
        </div>
        {step !== "start" && (
          <button onClick={resetAll} className="rounded-2xl px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
            ← Annulla
          </button>
        )}
      </header>

      {step === "start" && (
        <div className="space-y-3">
          <button
            onClick={() => setStep("scan")}
            className="flex w-full items-center gap-4 rounded-3xl border border-ink-200 bg-white p-5 text-left transition hover:border-brand-400 dark:border-ink-800 dark:bg-ink-900"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-600/10 text-3xl">📷</span>
            <span>
              <span className="block text-sm font-bold">Scansiona il barcode dello scontrino</span>
              <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">
                Il grande codice in fondo alla ricevuta Coop.fi
              </span>
            </span>
          </button>

          <button
            onClick={() => setStep("photo")}
            className="flex w-full items-center gap-4 rounded-3xl border border-ink-200 bg-white p-5 text-left transition hover:border-brand-400 dark:border-ink-800 dark:bg-ink-900"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-600/10 text-3xl">🧾</span>
            <span>
              <span className="block text-sm font-bold">Fotografa lo scontrino</span>
              <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">
                Riconoscimento automatico di prodotti, quantità e prezzi
              </span>
            </span>
          </button>

          <div className="rounded-2xl border border-ink-200 bg-white p-4 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
            <p className="font-bold text-ink-700 dark:text-ink-200">Nota sul barcode dello scontrino</p>
            <p className="mt-1">
              Il codice in fondo alle ricevute Coop.fi (es. 99900107…) è un codice interno del punto vendita:
              non esistono servizi pubblici o autorizzati per risalire ai prodotti acquistati da quel numero
              (l'archivio scontrini è consultabile solo dentro l'app ufficiale Coop.fi, con accesso personale).
              L'app quindi usa la foto dello scontrino (OCR eseguita sul tuo dispositivo, in italiano) come
              metodo di importazione: prodotti, quantità e prezzi reali dello scontrino.
            </p>
          </div>
        </div>
      )}

      {step === "scan" && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-3xl bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 inset-y-6 rounded-2xl border-2 border-brand-400 scan-frame" />
            {isScanning && (
              <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white">
                Inquadra il barcode in fondo allo scontrino…
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
          {scanError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {scanError === "denied"
                ? "Permesso fotocamera negato. Puoi comunque fotografare lo scontrino."
                : scanError === "no-camera"
                  ? "Nessuna fotocamera disponibile."
                  : "Errore durante la scansione."}
              <div className="mt-3 flex gap-2">
                <button onClick={() => setStep("photo")} className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-ink-900">
                  🧾 Vai alla foto
                </button>
                <button onClick={() => setStep("start")} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                  Indietro
                </button>
              </div>
            </div>
          )}
          <button onClick={() => setStep("start")} className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
            ← Chiudi scanner
          </button>
        </div>
      )}

      {step === "photo" && (
        <div className="space-y-4">
          {receiptCode && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <p className="font-bold">Codice scontrino letto: {receiptCode}</p>
              <p className="mt-1">
                È un codice interno del punto vendita e non esiste un servizio pubblico per recuperare la spesa da
                esso. Procediamo con la foto dello scontrino: il codice verrà salvato come riferimento della ricevuta.
              </p>
            </div>
          )}

          {photoUrl ? (
            <img src={photoUrl} alt="Scontrino" className="w-full rounded-3xl border border-ink-200 object-contain dark:border-ink-800" />
          ) : (
            <div className="grid place-items-center rounded-3xl border-2 border-dashed border-ink-300 bg-white p-10 text-center dark:border-ink-700 dark:bg-ink-900">
              <span className="text-4xl">🧾</span>
              <p className="mt-2 text-sm font-semibold">Scontrino non ancora fotografato</p>
              <p className="text-xs text-ink-500 dark:text-ink-400">Inquadra l'intero scontrino, meglio con luce uniforme.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => photoInputRef.current?.click()}
              className="rounded-2xl bg-brand-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700"
            >
              📷 Scatta foto
            </button>
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="rounded-2xl bg-ink-100 px-4 py-3.5 text-sm font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
            >
              🖼 Galleria
            </button>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPhotoChosen(e.target.files?.[0] ?? null)}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPhotoChosen(e.target.files?.[0] ?? null)}
          />

          {ocrError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {ocrError}. Riprova con una foto più nitida.
            </div>
          )}

          {photo && (
            <button
              onClick={() => void runOcr()}
              className="w-full rounded-2xl bg-ink-900 px-4 py-4 text-sm font-bold text-white transition hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100"
            >
              🔍 Riconosci testo (OCR)
            </button>
          )}
          <p className="text-center text-xs text-ink-400 dark:text-ink-500">
            L'OCR gira sul tuo dispositivo: la foto non viene inviata a nessun server.
          </p>
        </div>
      )}

      {step === "ocr" && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-ink-200 bg-white p-6 text-center dark:border-ink-800 dark:bg-ink-900">
            <Spinner className="mx-auto size-8" />
            <p className="mt-3 text-sm font-bold">
              {ocrProgress?.stage === "download-lingua"
                ? "Scarico il modello di lingua (prima volta)…"
                : "Riconoscimento testo…"}
            </p>
            {ocrProgress && (
              <div className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${Math.round(ocrProgress.progress * 100)}%` }} />
              </div>
            )}
            <p className="mt-3 text-xs text-ink-400 dark:text-ink-500">
              Inquadra lo scontrino intero, senza pieghe e con luce uniforme.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}