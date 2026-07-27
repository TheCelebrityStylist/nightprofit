import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
const schema=z.object({email:z.email(),password:z.string().min(10),fullName:z.string().min(2).max(100)});
export async function POST(request:Request){
  try{const input=schema.parse(await request.json());const url=new URL(request.url);const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signUp({email:input.email,password:input.password,options:{emailRedirectTo:`${url.origin}/auth/callback?next=/onboarding`,data:{full_name:input.fullName}}});if(error)return NextResponse.json({error:"Account kon niet worden gemaakt."},{status:400});return NextResponse.json({message:"Controleer je e-mail om je account te bevestigen."});}
  catch{return NextResponse.json({error:"Gebruik een geldig e-mailadres en minimaal 10 tekens."},{status:400})}
}
