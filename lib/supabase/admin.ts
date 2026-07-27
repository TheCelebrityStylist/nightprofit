import { createClient } from "@supabase/supabase-js";
import { publicEnv, requireValue, serverEnv } from "../env";
import type { Database } from "./types";

export function createSupabaseAdminClient() {
  const env = serverEnv();
  return createClient<Database>(
    requireValue(publicEnv.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    requireValue(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
