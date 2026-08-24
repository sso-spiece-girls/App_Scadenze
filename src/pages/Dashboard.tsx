import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useProductActions, ProductActionDialogs } from "../components/ProductActions";
import { ProductCard } from "../components/ProductCard";
import { EmptyState, PageLoader } from "../components/ui";
import { StatCard } from "../components/ui/misc";
import { computeWasteStats } from "../services/wasteService";
import { decorateProducts } from "../utils/status";
import { formatEuro } from "../utils/money";
import { EXPIRY_WINDOW_DAYS } from "../lib/constants";

export function Dashboard() {
  const api = useProducts(true);
  const { show } = useToastContext();
  const actions = useProductActions(api, show);

  const products = useMemo(() => decorateProducts(api.products), [api.products]);
  const waste = useMemo(() => computeWasteStats(api.products), [api.products]);

  const active = products.filter((p) => p.effectiveStatus === "active");
  const expiring = products.filter((p) => p.effectiveStatus === "active" && p.daysUntil >= 0 && p.daysUntil <= EXPIRY_WINDOW_DAYS);
  const expired = products.filter((p) => p.effectiveStatus === "expired");

  // Prioritized "consume soon" list: expired first, then soonest-to-expire.
  const priority = useMemo(() => {
    return products
      .filter((p) => p.effectiveStatus === "expired" || (p.effectiveStatus === "active" && p.daysUntil <= EXPIRY_WINDOW_DAYS))
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 8);
  }, [products]);

  if (api.loading && products.length === 0) {
    return <PageLoader label="Caricamento prodotti…" />;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">La tua dispensa in un colpo d'occhio.</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="In dispensa" icon="📦" value={active.length} tone="green" />
        <StatCard label="In scadenza (7 gg)" icon="⏰" value={expiring.length} tone="amber" />
        <StatCard label="Scaduti" icon="🔴" value={expired.length} tone="red" />
        <StatCard label="Spreco del mese" icon="💸" value={formatEuro(waste.month)} tone="red" />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Da consumare al più presto</h2>
          <Link to="/products?filter=expiring" className="text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Vedi tutti →
          </Link>
        </div>

        {priority.length === 0 ? (
          <EmptyState
            emoji="🎉"
            title="Nessuna scadenza in vista"
            description="Nessun prodotto sta per scadere. Ottimo lavoro!"
            action={
              <Link to="/add" className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700">
                ＋ Aggiungi prodotto
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {priority.map((p) => (
              <ProductCard key={p.id} product={p} onAction={actions.handleAction} />
            ))}
          </div>
        )}
      </section>

      <ProductActionDialogs actions={actions} />
    </div>
  );
}