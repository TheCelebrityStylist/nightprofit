import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireValue, serverEnv } from "../env";
import type { Database } from "./types";

export async function createSupabaseServerClient() {
  const store = await cookies();
  const env=serverEnv();
  return createServerClient<Database>(
    requireValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    requireValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          try { items.forEach(({ name, value, options }) => store.set(name, value, { ...options, secure: process.env.NODE_ENV === "production", sameSite: "lax" })); }
          catch { /* Server component cookie writes are refreshed by auth routes. */ }
        },
      },
    },
  );
}

/**
 * Credential verification must not inherit a possibly expired browser session.
 * The successful session is copied into the cookie-aware SSR client by the
 * login route only after Supabase accepts the credentials.
 */
export function createSupabaseCredentialClient() {
  const env = serverEnv();
  return createClient<Database>(
    requireValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    requireValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
