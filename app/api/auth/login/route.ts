import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseCredentialClient, createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
const schema=z.object({email:z.string().trim().toLowerCase().pipe(z.email()),password:z.string().min(10)});
export async function POST(request:Request){
  const correlationId=crypto.randomUUID();
  try{assertSameOrigin(request);const input=schema.parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"login",input.email),8,15*60_000);const credentialClient=createSupabaseCredentialClient();const {data,error}=await credentialClient.auth.signInWithPassword(input);if(error||!data.session){if((error?.status??0)>=500)console.error("auth.login.provider_failure",{correlationId,status:error?.status??null});return NextResponse.json({errorCode:error&&(error.status??0)>=500?"AUTH_PROVIDER_UNAVAILABLE":"INVALID_CREDENTIALS",correlationId},{status:error&&(error.status??0)>=500?503:400});}const supabase=await createSupabaseServerClient();const {error:sessionError}=await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});if(sessionError){console.error("auth.login.session_failure",{correlationId,status:sessionError.status??null});return NextResponse.json({errorCode:"AUTH_SESSION_FAILED",correlationId},{status:503});}return NextResponse.json({redirect:"/app/dashboard"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_AUTH_INPUT"},{status:400})}
}
