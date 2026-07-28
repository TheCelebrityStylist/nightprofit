import { createSupabaseServerClient } from "../../lib/supabase/server";
import { AuthForm } from "../auth-form";
import { OnboardingForm } from "./onboarding-form";
export default async function OnboardingPage(){const supabase=await createSupabaseServerClient();const {data:{user},error}=await supabase.auth.getUser();if(error||!user)return <AuthForm mode="login"/>;return <OnboardingForm/>}
