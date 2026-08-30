import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseCredentialClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
export async function POST(request:Request){
  try{assertSameOrigin(request);const {email}=z.object({email:z.email()}).parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"password-reset",email),8,60*60_000);const origin=new URL(request.url).origin;const supabase=createSupabaseCredentialClient();const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${origin}/update-password`});if(error){if((error.status??500)>=500)console.error("auth.password_reset.provider_failure",{status:error.status??500});return NextResponse.json({errorCode:(error.status??500)===429?"TOO_MANY_ATTEMPTS":"AUTH_UNEXPECTED"},{status:(error.status??500)===429?429:503});}return NextResponse.json({messageCode:"RESET_EMAIL_SENT"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_EMAIL"},{status:400})}
}
