import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";

const schema=z.object({accessToken:z.string().min(20).max(8192),refreshToken:z.string().min(1).max(8192)});

export async function POST(request:Request){
  const correlationId=crypto.randomUUID();
  try{assertSameOrigin(request);consumeRateLimit(await opaqueRateLimitKey(request,"recovery-session","browser"),4,15*60_000);const {accessToken,refreshToken}=schema.parse(await request.json());const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken});if(error)return NextResponse.json({errorCode:"LINK_INVALID",correlationId},{status:401});const {data:{user},error:userError}=await supabase.auth.getUser();if(userError||!user)return NextResponse.json({errorCode:"RECOVERY_SESSION_MISSING",correlationId},{status:401});return NextResponse.json({redirect:"/update-password"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"LINK_INVALID":"AUTH_UNEXPECTED",correlationId},{status:error instanceof z.ZodError?400:500})}
}
