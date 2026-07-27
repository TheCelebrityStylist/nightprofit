import { NightProfitApp } from "../nightprofit-app";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path=`/${slug.join("/")}`;
  if(path.startsWith("/app")){
    try{const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect(`/login?next=${encodeURIComponent(path)}`)}
    catch(error){if(error instanceof Error&&error.message.startsWith("Configuration required"))redirect("/login?configuration=required");throw error}
  }
  return <NightProfitApp initialPath={path} />;
}
