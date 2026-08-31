import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AddMenuProvider, useAddMenu } from "./AddMenu";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "🏠", end: true },
  { to: "/products", label: "Prodotti", icon: "📦", end: false },
  { to: "/waste", label: "Sprechi", icon: "💸", end: false },
  { to: "/settings", label: "Impostazioni", icon: "⚙️", end: false },
] as const;

interface LayoutProps {
  children: ReactNode;
}

/** App shell: bottom navigation on mobile, sidebar on desktop. */
export function Layout({ children }: LayoutProps) {
  return (
    <AddMenuProvider>
      <LayoutInner>{children}</LayoutInner>
    </AddMenuProvider>
  );
}

function LayoutInner({ children }: LayoutProps) {
  const addMenu = useAddMenu();

  return (
    <div className="min-h-dvh bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-200 bg-white px-4 py-6 dark:border-ink-800 dark:bg-ink-900 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-lg text-white">🧾</span>
          <div className="leading-tight">
            <p className="text-sm font-bold">Scadenze</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">& Sprechi</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => addMenu.open()}
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700"
        >
          <span className="text-lg leading-none">＋</span> Aggiungi
        </button>
      </aside>

      {/* Main content */}
      <main className="pb-24 md:ml-60 md:pb-8">
        <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8">{children}</div>
      </main>

      {/* Mobile bottom nav: solid background (no backdrop-blur — backdrop
          filters are expensive on low-end phones and the nav sits over
          scrolling content, so the blur is invisible in practice). */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900 md:hidden">
        <div className="grid grid-cols-5 items-center px-2 pt-1">
          {NAV_ITEMS.slice(0, 2).map((item) => (
            <MobileNavItem key={item.to} item={item} />
          ))}

          {/* Center FAB */}
          <div className="relative flex justify-center">
            <button
              onClick={() => addMenu.open()}
              aria-label="Aggiungi"
              className="absolute -top-5 grid size-14 place-items-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow-lg shadow-brand-600/40 transition active:scale-95"
            >
              ＋
            </button>
          </div>

          {NAV_ITEMS.slice(2).map((item) => (
            <MobileNavItem key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function MobileNavItem({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
          isActive ? "text-brand-600 dark:text-brand-400" : "text-ink-500 dark:text-ink-400"
        }`
      }
    >
      <span className="text-lg leading-none">{item.icon}</span>
      {item.label}
    </NavLink>
  );
}