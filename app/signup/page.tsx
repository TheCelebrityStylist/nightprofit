import { AuthForm } from "../auth-form";
import { cookies } from "next/headers";
import { normalizeAuthLocale } from "../../lib/i18n/authenticated";
export default async function SignupPage(){return <AuthForm mode="signup" locale={normalizeAuthLocale((await cookies()).get("nightprofit_locale")?.value)}/>}
