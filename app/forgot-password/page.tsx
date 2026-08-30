import { cookies } from "next/headers";
import { AuthForm } from "../auth-form";
import { normalizeAuthLocale } from "../../lib/i18n/authenticated";

export default async function ForgotPasswordPage() {
  return <AuthForm mode="forgot" locale={normalizeAuthLocale((await cookies()).get("nightprofit_locale")?.value)}/>;
}
