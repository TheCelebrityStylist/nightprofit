import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv, requireValue } from "../env";
import type { Database } from "./types";

export async function createSupabaseServerClient() {
  const store = await cookies();
  return createServerClient<Database>(
    requireValue(publicEnv.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    requireValue(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
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
