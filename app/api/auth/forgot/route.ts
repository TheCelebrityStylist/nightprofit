import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
export async function POST(request:Request){
  try{const {email}=z.object({email:z.email()}).parse(await request.json());const origin=new URL(request.url).origin;const supabase=await createSupabaseServerClient();await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${origin}/auth/callback?next=/update-password`});return NextResponse.json({message:"Als dit account bestaat, ontvang je een herstellink."});}
  catch{return NextResponse.json({error:"Voer een geldig e-mailadres in."},{status:400})}
}
