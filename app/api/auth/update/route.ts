import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
export async function POST(request:Request){
  try{assertSameOrigin(request);consumeRateLimit(await opaqueRateLimitKey(request,"password-update","session"),5,15*60_000);const {password}=z.object({password:z.string().min(10).max(256)}).parse(await request.json());const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.updateUser({password});if(error)return NextResponse.json({errorCode:"PASSWORD_UPDATE_FAILED"},{status:400});return NextResponse.json({redirect:"/app/dashboard"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_PASSWORD"},{status:400})}
}
