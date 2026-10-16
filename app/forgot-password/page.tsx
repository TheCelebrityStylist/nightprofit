import { cookies } from "next/headers";
import { AuthForm } from "../auth-form";
import { normalizeAuthLocale } from "../../lib/i18n/authenticated";

export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const error=(await searchParams).error;
  return <AuthForm mode="forgot" locale={normalizeAuthLocale((await cookies()).get("nightprofit_locale")?.value)} initialError={error==="link_invalid"?"LINK_INVALID":undefined}/>;
}
