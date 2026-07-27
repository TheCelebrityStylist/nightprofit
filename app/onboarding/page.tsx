import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";
export default async function OnboardingPage(){const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login?next=/onboarding");return <OnboardingForm/>}
