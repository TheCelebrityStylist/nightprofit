import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { publicEnv } from "../../lib/env";
import { OnboardingForm } from "./onboarding-form";
export default async function OnboardingPage(){if(!publicEnv.NEXT_PUBLIC_SUPABASE_URL||!publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)redirect("/login?next=/onboarding");const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login?next=/onboarding");return <OnboardingForm/>}
