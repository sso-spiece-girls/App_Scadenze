import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { useToastContext } from "../context/ToastContext";
import { useProductActions, ProductActionDialogs } from "../components/ProductActions";
import { ProductCard } from "../components/ProductCard";
import { EmptyState, PageLoader } from "../components/ui";
import { decorateProducts, filterProducts, type ProductFilter } from "../utils/status";

const FILTERS: { value: ProductFilter; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "active", label: "Attivi" },
  { value: "expiring", label: "In scadenza" },
  { value: "expired", label: "Scaduti" },
  { value: "wasted", label: "Sprecati" },
  { value: "finished", label: "Finiti" },
];

function isProductFilter(value: string | null): value is ProductFilter {
  return FILTERS.some((f) => f.value === value);
}

export function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("filter");
  const filter: ProductFilter = isProductFilter(raw) ? raw : "all";

  const api = useProducts(true);
  const { show } = useToastContext();
  const actions = useProductActions(api, show);

  const [query, setQuery] = useState("");

  const decorated = useMemo(() => decorateProducts(api.products), [api.products]);
  const visible = useMemo(() => {
    const base = filterProducts(decorated, filter);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q),
    );
  }, [decorated, filter, query]);

  const counts = useMemo(() => {
    const map = new Map<ProductFilter, number>();
    for (const f of FILTERS) map.set(f.value, filterProducts(decorated, f.value).length);
    return map;
  }, [decorated]);

  const setFilter = (value: ProductFilter) => {
    setSearchParams(value === "all" ? {} : { filter: value }, { replace: true });
  };

  if (api.loading && decorated.length === 0) {
    return <PageLoader label="Caricamento prodotti…" />;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Prodotti</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{counts.get(filter) ?? 0} prodotti</p>
        </div>
        <Link
          to="/add"
          className="hidden items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 md:inline-flex"
        >
          ＋ Aggiungi
        </Link>
      </header>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true">
          🔍
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome o marca…"
          className="w-full rounded-2xl border border-ink-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-900"
        />
      </div>

      {/* Filter pills */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${
                f.value === filter
                  ? "bg-brand-600 text-white shadow-md shadow-brand-600/25"
                  : "bg-white text-ink-600 hover:bg-ink-100 dark:bg-ink-900 dark:text-ink-300 dark:hover:bg-ink-800"
              }`}
            >
              {f.label} <span className="opacity-70">{counts.get(f.value) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          emoji={filter === "finished" ? "⚫" : filter === "wasted" ? "💸" : filter === "expired" ? "🔴" : "📦"}
          title="Nessun prodotto qui"
          description={decorated.length === 0 ? "Aggiungi il tuo primo prodotto per iniziare." : "Prova a cambiare filtro."}
          action={
            <Link to="/add" className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700">
              ＋ Aggiungi prodotto
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((p) => (
            <ProductCard key={p.id} product={p} onAction={actions.handleAction} />
          ))}
        </div>
      )}

      <ProductActionDialogs actions={actions} />
    </div>
  );
}