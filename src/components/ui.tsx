import type { ReactNode } from "react";

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-current`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = "Caricamento…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-ink-500 dark:text-ink-400">
      <Spinner className="size-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-ink-300 bg-white px-6 py-14 text-center dark:border-ink-700 dark:bg-ink-900">
      <span className="text-5xl">{emoji}</span>
      <h3 className="mt-2 text-base font-bold">{title}</h3>
      {description && <p className="max-w-xs text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}