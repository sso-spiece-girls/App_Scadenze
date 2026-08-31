import type { ParsedReceipt, ReceiptLine } from "../types";
import { parseEuro } from "../utils/money";
import { toDateOnly } from "../utils/date";

/**
 * receiptParser — turns raw OCR text of a grocery receipt into structured
 * lines (name, quantity, unit price, line total) plus envelope data (store,
 * date, grand total).
 *
 * Targets Italian receipts (Unicoop Firenze / Coop.fi and other Italian
 * chains), e.g.:
 *
 *   UNICOOP FIRENZE
 *   P.IVA 00123456789
 *   29/08/2026 14:32
 *   LATTE GRANAROLO 1L           2    1,49    2,98
 *   PASTA BARILLA N.5            1    1,29    1,29
 *   MOZZARELLA GALBANI           2    1,99    3,98
 *   TOTALE                    8,25
 *
 * The result is always a *proposal*: the UI shows a confirmation screen where
 * every field can be edited before anything is saved.
 */

/** Amounts like "1,49", "2,98", "1.299,90", "12.90" (comma or dot decimals). */
const AMOUNT_RE = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/g;

/** Lines that never contain products (Italian receipts). */
const SKIP_KEYWORDS =
  /^(totale|total|importo|contanti|cash|visa|mastercard|master|maestro|debit|credit|bancomat|postepay|satispay|pagamento|pago|iva|sconto|arrotondamento|rounding|buono|buoni|punti|socio|soci|resto|vuoto|cauzione|deposit)/i;

/** Lines that are pure metadata (dates, times, store headers, numbers). */
const META_RE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\s*\d{0,2}[:.]\d{2}|^\d{2}[:.]\d{2}$|^[a-z]{2,5}\s*\d+$/i;

const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

const STORE_RE =
  /(coop|unicoop|conad|esselunga|pam|eurospin|despar|carrefour|aldi|lidl|tosano|sigma|crai|dico|il gigante|simply|punto semplicita|naturasi|basko|sisa|ipercoop)/i;

const QTY_PREFIX_RE = /^(\d{1,2})\s*(?:[xX×*]|pz|kpl|conf|pezzi?)\s+/;
const QTY_X_RE = /(\d{1,2})\s*[xX×*]\s*(?=\d{1,3}[,.]\d{2})/;

/**
 * Trailing standalone quantity: "LATTE ... 2 1,49 2,98" (1..9, preceded by
 * whitespace — so "N.5", "1L", "12", "2%" in product names never match).
 */
const QTY_TRAILING_RE = /(?<=\s)([1-9])\s*$/;

/** Normalizes "29/08/2026" / "29.08.2026" / "2026-08-29" → "2026-08-29". */
export function normalizeReceiptDate(raw: string): string | null {
  const m = raw.match(DATE_RE);
  if (!m) return null;
  let [, a, b, c] = m;
  const year = c.length === 2 ? `20${c}` : c;
  // dd/mm/yyyy, dd.mm.yyyy or dd-mm-yyyy (Italian & Finnish) — always day first.
  return toDateOnly(new Date(Number(year), Number(b) - 1, Number(a)));
}

function cleanLine(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[|_]{2,}/g, " ")
    .trim();
}

function extractName(raw: string): string {
  return raw
    // strip trailing barcode-ish digits and standalone quantities
    .replace(/\b\d{6,14}\b/g, " ")
    .replace(QTY_TRAILING_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses OCR text into a structured receipt proposal.
 * Best-effort: OCR noise yields wrong rows, never crashes — the confirm
 * screen exists precisely to fix those rows by hand.
 */
export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const receiptLines: ReceiptLine[] = [];
  let total: number | null = null;
  let purchaseDate: string | null = null;
  let store: string | null = null;

  for (const line of lines) {
    // Envelope data ----------------------------------------------------------
    const dateMatch = line.match(DATE_RE);
    if (dateMatch && !purchaseDate) {
      const normalized = normalizeReceiptDate(line);
      if (normalized) purchaseDate = normalized;
    }
    if (!store && STORE_RE.test(line) && !/^[a-z]{2,5}\s*\d+$/i.test(line)) {
      store = line.length > 60 ? line.slice(0, 60) : line;
    }

    // Total line -------------------------------------------------------------
    if (/(totale|total|importo)/i.test(line) && total === null) {
      const amounts = line.match(AMOUNT_RE);
      if (amounts && amounts.length > 0) {
        const parsed = parseEuro(amounts[amounts.length - 1]);
        if (parsed !== null) total = parsed;
      }
      continue;
    }

    // Metadata / payment / VAT lines → never products.
    if (SKIP_KEYWORDS.test(line) || META_RE.test(line) || line.length < 3) continue;

    // Product line -----------------------------------------------------------
    const amounts = line.match(AMOUNT_RE);
    if (!amounts || amounts.length === 0) continue;

    const lineTotal = parseEuro(amounts[amounts.length - 1]);
    if (lineTotal === null) continue;

    // Name part: everything before the first price token.
    const firstAmountIdx = line.indexOf(amounts[0]);
    let namePart = (firstAmountIdx > -1 ? line.slice(0, firstAmountIdx) : line).trim();

    // Quantity: "2 x 4,95" (raw line, prices still present) → "2 kpl" prefix →
    // trailing standalone digit ("LATTE ... 2 1,49 2,98").
    let quantity = 1;
    const qtyX = line.match(QTY_X_RE);
    if (qtyX) {
      quantity = parseInt(qtyX[1], 10);
      namePart = namePart.replace(qtyX[0].trim(), " ").replace(/\s+/g, " ").trim();
    } else {
      const qtyPrefix = namePart.match(QTY_PREFIX_RE);
      if (qtyPrefix) {
        quantity = parseInt(qtyPrefix[1], 10);
        namePart = namePart.slice(qtyPrefix[0].length).trim();
      } else {
        const trailing = namePart.match(QTY_TRAILING_RE);
        if (trailing) {
          quantity = Number(trailing[1]);
          namePart = namePart.replace(QTY_TRAILING_RE, " ").replace(/\s+/g, " ").trim();
        }
      }
    }

    // Unit price: with a quantity > 1 the trailing amount is the line total,
    // so unit = total / quantity. With a single unit and two amounts, the
    // second-to-last amount is the explicit unit price.
    let unitPrice = lineTotal;
    if (quantity > 1) {
      unitPrice = Math.round((lineTotal / quantity) * 100) / 100;
    } else if (amounts.length >= 2) {
      const second = parseEuro(amounts[amounts.length - 2]);
      if (second !== null && second > 0) unitPrice = second;
    }

    const name = extractName(namePart);
    if (!name) continue;

    receiptLines.push({
      name: name.slice(0, 80),
      quantity: Math.max(1, quantity),
      unitPrice,
      totalPrice: lineTotal,
      barcode: null,
    });
  }

  return { lines: receiptLines, total, purchaseDate, store };
}

/**
 * True when a parsed receipt is trustworthy enough to skip the "risultato
 * dubbio" warning. Pure heuristic: at least 2 product lines and a grand
 * total that matches the sum of the lines within 10%.
 */
export function receiptLooksReliable(parsed: ParsedReceipt): boolean {
  if (parsed.lines.length < 2) return false;
  if (parsed.total === null) return parsed.lines.length >= 4;
  const sum = parsed.lines.reduce((acc, l) => acc + l.totalPrice, 0);
  if (sum <= 0) return false;
  const diff = Math.abs(sum - parsed.total) / parsed.total;
  return diff <= 0.1;
}