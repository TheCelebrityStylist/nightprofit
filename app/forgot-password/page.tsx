import { AuthForm } from "../auth-form";
import { getLocale } from "../../lib/i18n/server";
export default async function ForgotPage(){return <AuthForm mode="forgot" locale={await getLocale()}/>}
