import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Shared Supabase client. In the browser only the ANON key is used: all
 * security-critical operations go through Row Level Security + authenticated
 * requests. No secret key ever lives in the frontend.
 */
export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);

/** The configured VAPID public key used to subscribe for Web Push. */
export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;