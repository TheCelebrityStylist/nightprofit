import { cookies } from "next/headers";
import { AuthForm } from "../auth-form";
import { normalizeAuthLocale } from "../../lib/i18n/authenticated";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export default async function UpdatePasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const cookieStore=await cookies();
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  const error=(await searchParams).error;
  return <AuthForm mode="update" locale={normalizeAuthLocale(cookieStore.get("nightprofit_locale")?.value)} initialError={error==="link_invalid"?"LINK_INVALID":user?undefined:"RECOVERY_SESSION_MISSING"}/>;
}
