import { AuthForm } from "../auth-form";
import { getLocale } from "../../lib/i18n/server";
export default async function SignupPage(){return <AuthForm mode="signup" locale={await getLocale()}/>}
