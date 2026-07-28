import { z } from "zod";

const optionalUrl = z.string().url().optional();
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
});
const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_DIAGNOSTIC_PRICE_ID: z.string().startsWith("price_").optional(),
  STRIPE_ESSENTIAL_MONTHLY_PRICE_ID: z.string().startsWith("price_").optional(),
  STRIPE_ESSENTIAL_ANNUAL_PRICE_ID: z.string().startsWith("price_").optional(),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().startsWith("price_").optional(),
  STRIPE_PRO_ANNUAL_PRICE_ID: z.string().startsWith("price_").optional(),
  APP_URL: optionalUrl,
  CRON_SECRET: z.string().min(24).optional(),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || undefined,
});
export function serverEnv() {
  // Bracket access preserves Sites runtime bindings in server bundles.
  const runtime=process.env;
  return serverSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: runtime["NEXT_PUBLIC_SUPABASE_URL"] || publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: runtime["NEXT_PUBLIC_SUPABASE_ANON_KEY"] || publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: runtime["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] || publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    STRIPE_DIAGNOSTIC_PRICE_ID: process.env.STRIPE_DIAGNOSTIC_PRICE_ID || undefined,
    STRIPE_ESSENTIAL_MONTHLY_PRICE_ID: process.env.STRIPE_ESSENTIAL_MONTHLY_PRICE_ID || undefined,
    STRIPE_ESSENTIAL_ANNUAL_PRICE_ID: process.env.STRIPE_ESSENTIAL_ANNUAL_PRICE_ID || undefined,
    STRIPE_PRO_MONTHLY_PRICE_ID: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || undefined,
    STRIPE_PRO_ANNUAL_PRICE_ID: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || undefined,
    APP_URL: process.env.APP_URL || undefined,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
  });
}
export function requireValue<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`Configuration required: ${name}`);
  return value;
}
