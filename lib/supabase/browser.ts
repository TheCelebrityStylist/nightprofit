"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv, requireValue } from "../env";
import type { Database } from "./types";

export const createSupabaseBrowserClient = () => createBrowserClient<Database>(
  requireValue(publicEnv.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
  requireValue(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
);
