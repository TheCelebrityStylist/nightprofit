import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
const schema=z.object({email:z.email(),password:z.string().min(10)});
export async function POST(request:Request){
  try{const input=schema.parse(await request.json());const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signInWithPassword(input);if(error)return NextResponse.json({error:"E-mailadres of wachtwoord klopt niet."},{status:400});return NextResponse.json({redirect:"/app/dashboard"});}
  catch{return NextResponse.json({error:"Controleer de ingevoerde gegevens."},{status:400})}
}
