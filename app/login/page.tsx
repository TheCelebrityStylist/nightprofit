import { AuthForm } from "../auth-form";
import { getLocale } from "../../lib/i18n/server";
export default async function LoginPage(){return <AuthForm mode="login" locale={await getLocale()}/>}
