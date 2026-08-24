import type { ProductWithStatus } from "../types";
import { formatEuro } from "../utils/money";
import { expiryLabel, formatDate } from "../utils/date";
import { categoryEmoji } from "../utils/categories";
import { StatusBadge } from "./ui/misc";

export type ProductAction = "finish" | "waste" | "reactivate" | "delete";

interface ProductCardProps {
  product: ProductWithStatus;
  onAction: (action: ProductAction, product: ProductWithStatus) => void;
}

const DAY_DOT: Record<string, string> = {
  active: "bg-brand-500",
  finished: "bg-ink-400",
  expired: "bg-red-500",
  wasted: "bg-orange-500",
};

export function ProductCard({ product, onAction }: ProductCardProps) {
  const { effectiveStatus, daysUntil } = product;
  const expired = effectiveStatus === "expired" || effectiveStatus === "wasted";
  const expiringSoon = effectiveStatus === "active" && daysUntil <= 7;

  return (
    <article className="rounded-2xl border border-ink-200 bg-white p-4 transition hover:border-ink-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700">
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-100 dark:bg-ink-800">
          {product.image_url ? (
            <img src={product.image_url} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="text-2xl" aria-hidden="true">
              {categoryEmoji(product.category)}
            </span>
          )}
        </div>

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold">{product.name}</h3>
              {product.brand && <p className="truncate text-xs text-ink-500 dark:text-ink-400">{product.brand}</p>}
            </div>
            <StatusBadge status={effectiveStatus} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${DAY_DOT[effectiveStatus]}`} aria-hidden="true" />
              <span className={expired ? "font-semibold text-red-600 dark:text-red-400" : expiringSoon ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                {expiryLabel(daysUntil)} · {formatDate(product.expiration_date)}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatEuro(product.price)}</span>
            {product.quantity && <span>{product.quantity}</span>}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {effectiveStatus === "active" && (
          <>
            <button
              onClick={() => onAction("finish", product)}
              className="flex-1 rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700 active:scale-[0.98]"
            >
              ✓ Finito
            </button>
            <button
              onClick={() => onAction("waste", product)}
              className="flex-1 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-500/20 active:scale-[0.98] dark:text-red-400"
            >
              💸 Spreco
            </button>
          </>
        )}
        {(effectiveStatus === "expired" || effectiveStatus === "wasted") && (
          <>
            <button
              onClick={() => onAction("reactivate", product)}
              className="flex-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-600 transition hover:bg-amber-500/20 active:scale-[0.98] dark:text-amber-400"
            >
              ↺ Recupera
            </button>
            <button
              onClick={() => onAction("delete", product)}
              className="rounded-xl px-3 py-2 text-xs font-bold text-ink-400 transition hover:bg-ink-100 dark:hover:bg-ink-800"
              aria-label="Elimina"
            >
              🗑
            </button>
          </>
        )}
        {effectiveStatus === "finished" && (
          <button
            onClick={() => onAction("delete", product)}
            className="ml-auto rounded-xl px-3 py-2 text-xs font-bold text-ink-400 transition hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label="Elimina"
          >
            🗑 Elimina
          </button>
        )}
      </div>
    </article>
  );
}