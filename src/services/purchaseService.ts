import type { ImportMethod, Product, Purchase, ReceiptLine } from "../types";
import { supabase } from "../lib/supabase";
import { getCurrentUserId } from "./productService";

/**
 * purchaseService — saves an imported shopping trip.
 *
 * One purchase row → N product rows (one per receipt line, quantity_count =
 * units bought, price = unit price) → N purchase_items (audit trail of the
 * receipt rows). Products keep `expiration_date = NULL` — the expiry is never
 * invented, the user sets it later from the product list.
 */

export interface PurchaseDraft {
  store: string | null;
  /** Receipt date (YYYY-MM-DD) when available, else today. */
  purchaseDate: string;
  /** Grand total from the receipt (may be null when OCR missed it). */
  total: number | null;
  importMethod: ImportMethod;
  /** Scanned receipt barcode / identifier when available. */
  receiptIdentifier: string | null;
  /** Confirmed lines (already edited by the user in the confirm screen). */
  lines: ReceiptLine[];
}

export async function savePurchase(
  draft: PurchaseDraft,
): Promise<{ purchase: Purchase; products: Product[] }> {
  const userId = await getCurrentUserId();

  // 1. Purchase row ---------------------------------------------------------
  const { data: purchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      user_id: userId,
      store: draft.store,
      purchase_date: draft.purchaseDate,
      total: draft.total,
      import_method: draft.importMethod,
      receipt_identifier: draft.receiptIdentifier,
    })
    .select()
    .single();
  if (purchaseError) throw new Error(purchaseError.message);

  // 2. Product rows (bulk) --------------------------------------------------
  const productRows = draft.lines.map((line) => ({
    user_id: userId,
    barcode: line.barcode ?? "",
    name: line.name,
    quantity_count: line.quantity,
    consumed_count: 0,
    price: line.unitPrice,
    price_source: "manual" as const,
    purchase_date: draft.purchaseDate,
    expiration_date: null,
    status: "active" as const,
    import_method: draft.importMethod,
    purchase_id: purchase.id,
  }));

  const { data: products, error: productsError } = await supabase
    .from("products")
    .insert(productRows)
    .select();
  if (productsError) throw new Error(productsError.message);

  // 3. Purchase items (bulk, audit of the receipt rows) ----------------------
  const itemRows = draft.lines.map((line, i) => ({
    purchase_id: purchase.id,
    product_id: (products?.[i]?.id as string | undefined) ?? null,
    barcode: line.barcode ?? null,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    total_price: line.totalPrice,
  }));
  const { error: itemsError } = await supabase.from("purchase_items").insert(itemRows);
  if (itemsError) throw new Error(itemsError.message);

  return { purchase, products: (products ?? []) as Product[] };
}