import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
export async function POST(request:Request){
  try{assertSameOrigin(request);const {email}=z.object({email:z.email()}).parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"password-reset",email),4,60*60_000);const origin=new URL(request.url).origin;const supabase=await createSupabaseServerClient();await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${origin}/auth/callback?next=/update-password`});return NextResponse.json({messageCode:"RESET_EMAIL_SENT"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_EMAIL"},{status:400})}
}
