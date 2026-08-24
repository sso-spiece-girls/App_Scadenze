import { useAuth } from "../hooks/useAuth";

/** Shown when a signed-in session does not belong to an allowed email. */
export function AccessDenied() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink-50 px-6 text-center dark:bg-ink-950">
      <span className="text-5xl" aria-hidden="true">🚫</span>
      <h1 className="mt-4 text-xl font-extrabold tracking-tight">Accesso negato</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-500 dark:text-ink-400">
        Questa applicazione è riservata. Se pensi sia un errore, contatta il proprietario.
      </p>
      <button
        onClick={() => void signOut()}
        className="mt-6 rounded-2xl bg-ink-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100"
      >
        Torna al login
      </button>
    </div>
  );
}