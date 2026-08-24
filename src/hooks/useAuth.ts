import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/**
 * useAuth — session state + authentication actions.
 *
 * Primary flow: email + password. Two self-service helpers cover bootstrap
 * and recovery on a fresh deployment:
 *  - `signUp` auto-creates the account (only the whitelisted email passes the
 *    database allowlist trigger, see supabase/migrations/0002_allowlist.sql);
 *  - `resetPassword` / `sendMagicLink` recover an existing account.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<boolean> => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err) setError(err.message);
    return !err;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; requiresConfirmation: boolean }> => {
      setError(null);
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message);
        return { ok: false, requiresConfirmation: false };
      }
      // With email confirmation enabled the user must click the link first.
      return { ok: true, requiresConfirmation: Boolean(data.user && !data.session) };
    },
    [],
  );

  /** Email OTP (magic link) fallback — still restricted to allowed emails. */
  const sendMagicLink = useCallback(async (email: string): Promise<boolean> => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    if (err) setError(err.message);
    return !err;
  }, []);

  /** Sends a password-reset email for an existing account. */
  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (err) setError(err.message);
    return !err;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    loading,
    error,
    clearError,
    signInWithPassword,
    signUp,
    sendMagicLink,
    resetPassword,
    signOut,
  };
}