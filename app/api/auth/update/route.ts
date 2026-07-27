import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
export async function POST(request:Request){
  try{const {password}=z.object({password:z.string().min(10)}).parse(await request.json());const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.updateUser({password});if(error)return NextResponse.json({error:"Wachtwoord kon niet worden bijgewerkt."},{status:400});return NextResponse.json({redirect:"/app/dashboard"});}
  catch{return NextResponse.json({error:"Gebruik minimaal 10 tekens."},{status:400})}
}
