import { useMemo } from "react";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useProductActions, ProductActionDialogs } from "../components/ProductActions";
import { ProductCard } from "../components/ProductCard";
import { EmptyState, PageLoader } from "../components/ui";
import { StatCard } from "../components/ui/misc";
import { computeWasteStats, wastedProducts } from "../services/wasteService";
import { decorateProducts } from "../utils/status";
import { formatEuro } from "../utils/money";

export function Waste() {
  const api = useProducts(true);
  const { show } = useToastContext();
  const actions = useProductActions(api, show);

  const stats = useMemo(() => computeWasteStats(api.products), [api.products]);
  const wasted = useMemo(() => decorateProducts(wastedProducts(api.products)), [api.products]);

  const maxCategoryValue = stats.byCategory[0]?.value ?? 0;

  if (api.loading && api.products.length === 0) {
    return <PageLoader label="Calcolo sprechi…" />;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Sprechi</h1>
        <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
          Quanto denaro hai perso con il cibo non consumato.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Sprechi totali" icon="💸" value={formatEuro(stats.total)} tone="red" />
        <StatCard label="Questo mese" icon="📅" value={formatEuro(stats.month)} tone="amber" />
        <StatCard label="Quest'anno" icon="🗓" value={formatEuro(stats.year)} />
        <StatCard label="% della spesa" icon="📊" value={`${stats.percentOfSpent.toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Prodotti sprecati" icon="🧾" value={stats.count} />
        <StatCard label="Media per prodotto" icon="⚖️" value={formatEuro(stats.average)} />
      </div>

      {stats.byCategory.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-bold">Per categoria</h2>
          <div className="space-y-2 rounded-3xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            {stats.byCategory.map((c) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.category}</span>
                  <span className="tabular-nums text-ink-500 dark:text-ink-400">
                    {formatEuro(c.value)} · {c.count} pz
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-ink-100 dark:bg-ink-800">
                  <div
                    className="h-2 rounded-full bg-red-500"
                    style={{ width: maxCategoryValue > 0 ? `${Math.max(8, (c.value / maxCategoryValue) * 100)}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-bold">Prodotti sprecati</h2>
        {wasted.length === 0 ? (
          <EmptyState
            emoji="🌱"
            title="Zero sprechi"
            description="Non hai ancora sprecato nulla. Continua così!"
          />
        ) : (
          <div className="space-y-3">
            {wasted.map((p) => (
              <ProductCard key={p.id} product={p} onAction={actions.handleAction} />
            ))}
          </div>
        )}
      </section>

      <ProductActionDialogs actions={actions} />
    </div>
  );
}