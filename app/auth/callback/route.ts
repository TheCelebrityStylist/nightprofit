import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { safeInternalPath } from "../../../lib/http/security";

const otpTypes = new Set<EmailOtpType>([
  "email", "email_change", "invite", "magiclink", "recovery", "signup",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const requestedType = url.searchParams.get("type") as EmailOtpType | null;
  const isPasswordFlow = requestedType === "invite" || requestedType === "recovery";
  const next = safeInternalPath(url.searchParams.get("next") ?? (isPasswordFlow ? "/update-password" : "/app/dashboard"));
  const correlationId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && requestedType && otpTypes.has(requestedType)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: requestedType })
      : { error: new Error("AUTH_CALLBACK_PARAMETERS_MISSING") };
  if (!result.error) return NextResponse.redirect(new URL(next, url.origin));
  const flow = code ? "pkce" : tokenHash ? "otp" : "missing";
  console.warn("auth.callback.invalid", { correlationId, flow });
  const target = isPasswordFlow ? "/update-password?error=link_invalid" : "/login?error=callback";
  return NextResponse.redirect(new URL(target, url.origin));
}
