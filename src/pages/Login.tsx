import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { useToastContext } from "../context/ToastContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { isAllowedEmail } from "../lib/access";
import { Spinner } from "../components/ui";

type Notice = { kind: "info" | "error" | "success"; text: string } | null;

/** Email + password sign-in. Access is restricted to the allowed email. */
export function Login() {
  const { error, clearError, signInWithPassword, signUp, sendMagicLink, resetPassword } = useAuth();
  const { show } = useToastContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const allowed = isAllowedEmail(email);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!allowed) {
      setBlocked(true);
      setNotice(null);
      return;
    }
    setBlocked(false);
    setNotice(null);
    clearError();
    setBusy(true);
    const ok = await signInWithPassword(email, password);
    setBusy(false);
    if (!ok) await handlePasswordFailure();
  };

  /**
   * Password login failed. "Invalid login credentials" usually means the
   * account does not exist yet (fresh deployment) OR the password is wrong:
   * try to auto-create the account with the typed password.
   */
  const handlePasswordFailure = async () => {
    const message = (error ?? "").toLowerCase();
    if (!message.includes("invalid login credentials")) {
      setNotice({ kind: "error", text: error ?? "Accesso non riuscito" });
      return;
    }

    setBusy(true);
    const res = await signUp(email, password);
    setBusy(false);

    if (res.ok) {
      setNotice({
        kind: "success",
        text: res.requiresConfirmation
          ? "Account creato. Controlla la tua email per confermare, poi accedi."
          : "Account pronto, puoi accedere di nuovo.",
      });
      show("Account creato. Controlla la tua email.", "success");
    } else if ((error ?? "").toLowerCase().includes("already registered")) {
      setNotice({
        kind: "info",
        text: "L'account esiste già ma la password non è corretta. Usa 'Reimposta password' qui sotto.",
      });
    } else {
      setNotice({ kind: "error", text: error ?? "Impossibile creare l'account" });
    }
  };

  const onResetPassword = async () => {
    if (!allowed || busy) return;
    clearError();
    setBusy(true);
    const ok = await resetPassword(email);
    setBusy(false);
    setNotice(ok ? { kind: "info", text: "Controlla la tua email: link per reimpostare la password inviato." } : { kind: "error", text: error ?? "Errore" });
  };

  const onMagicLink = async () => {
    if (!allowed || busy) return;
    clearError();
    setBusy(true);
    const ok = await sendMagicLink(email);
    setBusy(false);
    setNotice(ok ? { kind: "info", text: "Controlla la tua email: link di accesso inviato." } : { kind: "error", text: error ?? "Errore" });
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink-50 px-6 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-3xl bg-brand-600 text-3xl text-white shadow-lg shadow-brand-600/30">
            🧾
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Scadenze &amp; Sprechi</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Scansiona, salva, consuma. Niente più cibo sprecato.
            </p>
          </div>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <strong>Configurazione mancante:</strong> crea un file <code>.env</code> con{" "}
            <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (vedi{" "}
            <code>.env.example</code>) per abilitare l'accesso.
          </div>
        )}

        {blocked ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
            <p className="text-3xl">🚫</p>
            <p className="mt-2 text-sm font-bold text-red-700 dark:text-red-300">Accesso riservato</p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              Questa applicazione è riservata a un utente specifico.
            </p>
            <button
              onClick={() => {
                setBlocked(false);
                setEmail("");
                setPassword("");
              }}
              className="mt-4 rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Ho sbagliato email
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
            <div>
              <label htmlFor="login-email" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
                La tua email
              </label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.it"
                className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-ink-500 dark:text-ink-400">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-800"
              />
            </div>

            {notice && (
              <p className={`rounded-2xl px-4 py-3 text-sm ${
                notice.kind === "error"
                  ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                  : notice.kind === "success"
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300"
                    : "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300"
              }`}>
                {notice.text}
              </p>
            )}

            {error && !notice && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy && <Spinner className="size-4" />}
              Accedi
            </button>

            {allowed && (
              <div className="flex flex-col gap-2 pt-1 text-center text-xs text-ink-500 dark:text-ink-400">
                <p>Hai dimenticato la password?</p>
                <div className="flex justify-center gap-4">
                  <button type="button" onClick={onResetPassword} disabled={busy} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    Reimposta password
                  </button>
                  <button type="button" onClick={onMagicLink} disabled={busy} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    Invia link magico
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}