import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
const schema=z.object({email:z.email(),password:z.string().min(10),fullName:z.string().min(2).max(100)});
export async function POST(request:Request){
  try{assertSameOrigin(request);const input=schema.parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"signup",input.email),4,60*60_000);const url=new URL(request.url);const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signUp({email:input.email,password:input.password,options:{emailRedirectTo:`${url.origin}/auth/callback?next=/onboarding`,data:{full_name:input.fullName}}});if(error)return NextResponse.json({errorCode:"SIGNUP_FAILED"},{status:400});return NextResponse.json({messageCode:"SIGNUP_CONFIRM_EMAIL"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_SIGNUP_INPUT"},{status:400})}
}
