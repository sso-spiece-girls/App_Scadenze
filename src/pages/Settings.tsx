import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useToastContext } from "../context/ToastContext";
import { Spinner } from "../components/ui";

const THEMES = [
  { value: "light", label: "☀️ Chiaro" },
  { value: "dark", label: "🌙 Scuro" },
  { value: "system", label: "🖥 Sistema" },
] as const;

export function Settings() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const push = usePushNotifications();
  const { show } = useToastContext();

  const onTogglePush = async () => {
    if (push.permission === "granted") {
      await push.disable();
      show("Notifiche disattivate", "info");
    } else {
      const ok = await push.enable();
      show(ok ? "Notifiche attivate" : "Notifiche non abilitate", ok ? "success" : "info");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Impostazioni</h1>
      </header>

      {/* Account */}
      <section className="rounded-3xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <h2 className="mb-3 text-base font-bold">Account</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">Accesso con email (magic link).</p>
        <p className="mt-2 break-all text-sm font-semibold">{user?.email}</p>
        <button
          onClick={() => void signOut()}
          className="mt-4 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
        >
          Esci
        </button>
      </section>

      {/* Theme */}
      <section className="rounded-3xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <h2 className="mb-3 text-base font-bold">Aspetto</h2>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                theme === t.value
                  ? "border-brand-500 bg-brand-600/10 text-brand-700 dark:text-brand-300"
                  : "border-ink-200 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section className="rounded-3xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Notifiche</h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Ricevi un avviso quando un prodotto sta per scadere.
            </p>
          </div>
          {push.supported && (
            <button
              onClick={onTogglePush}
              disabled={push.busy}
              className={`flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-60 ${
                push.permission === "granted"
                  ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                  : "bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700"
              }`}
            >
              {push.busy ? <Spinner className="size-4" /> : null}
              {push.permission === "granted" ? "Disattiva" : "Attiva"}
            </button>
          )}
        </div>
        {!push.supported && (
          <p className="mt-3 text-sm text-ink-400 dark:text-ink-500">
            Le notifiche push non sono disponibili su questo browser (o il VAPID key non è configurato).
          </p>
        )}
      </section>

      <p className="pb-2 text-center text-xs text-ink-400 dark:text-ink-500">
        Scadenze &amp; Sprechi v1.0.0 — PWA
      </p>
    </div>
  );
}