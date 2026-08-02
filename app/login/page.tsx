import { AuthForm } from "../auth-form";
import { cookies } from "next/headers";
import { normalizeAuthLocale } from "../../lib/i18n/authenticated";
export default async function LoginPage(){return <AuthForm mode="login" locale={normalizeAuthLocale((await cookies()).get("nightprofit_locale")?.value)}/>}
