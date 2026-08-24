import type { ReactNode } from "react";
import type { EffectiveStatus } from "../../types";
import { STATUS_EMOJI, STATUS_LABELS } from "../../lib/constants";

const STATUS_STYLES: Record<EffectiveStatus, string> = {
  active: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  finished: "bg-ink-500/10 text-ink-600 dark:bg-ink-400/10 dark:text-ink-300",
  expired: "bg-red-500/10 text-red-600 dark:bg-red-400/10 dark:text-red-300",
  wasted: "bg-orange-500/10 text-orange-600 dark:bg-orange-400/10 dark:text-orange-300",
};

export function StatusBadge({ status }: { status: EffectiveStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      <span aria-hidden="true">{STATUS_EMOJI[status]}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StatCard({ label, value, icon, tone = "default" }: { label: string; value: ReactNode; icon: string; tone?: "default" | "amber" | "red" | "green" }) {
  const tones = {
    default: "bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-800",
    green: "bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800",
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    red: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-ink-400">
        <span aria-hidden="true">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}