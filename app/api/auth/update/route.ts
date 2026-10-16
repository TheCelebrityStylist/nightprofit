import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
export async function POST(request:Request){
  const correlationId=crypto.randomUUID();
  try{assertSameOrigin(request);consumeRateLimit(await opaqueRateLimitKey(request,"password-update","session"),5,15*60_000);const {password}=z.object({password:z.string().min(10).max(256)}).parse(await request.json());const supabase=await createSupabaseServerClient();const {data:{user},error:userError}=await supabase.auth.getUser();if(userError||!user)return NextResponse.json({errorCode:"RECOVERY_SESSION_MISSING",correlationId},{status:401});const {error}=await supabase.auth.updateUser({password});if(error){const status=error.status??400;const errorCode=status===429?"TOO_MANY_ATTEMPTS":status>=500?"AUTH_UNEXPECTED":status===422||/password/i.test(error.message)?"PASSWORD_POLICY":"PASSWORD_UPDATE_FAILED";if(status>=500)console.error("auth.password_update.provider_failure",{correlationId,status});return NextResponse.json({errorCode,correlationId},{status:status>=500?503:status===429?429:400});}return NextResponse.json({redirect:"/app/dashboard"});}
  catch(error){const response=securityErrorResponse(error);if(response)return response;return NextResponse.json({errorCode:error instanceof z.ZodError?"PASSWORD_POLICY":"AUTH_UNEXPECTED",correlationId},{status:error instanceof z.ZodError?400:500})}
}
