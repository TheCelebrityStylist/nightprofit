import { AuthForm } from "../auth-form";
import { getLocale } from "../../lib/i18n/server";
export default async function UpdatePasswordPage(){return <AuthForm mode="update" locale={await getLocale()}/>}
