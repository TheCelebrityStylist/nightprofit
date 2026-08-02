import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";
const schema=z.object({email:z.email(),password:z.string().min(10)});
export async function POST(request:Request){
  try{assertSameOrigin(request);const input=schema.parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"login",input.email),8,15*60_000);const supabase=await createSupabaseServerClient();const {error}=await supabase.auth.signInWithPassword(input);if(error)return NextResponse.json({errorCode:"INVALID_CREDENTIALS"},{status:400});return NextResponse.json({redirect:"/app/dashboard"});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"INVALID_AUTH_INPUT"},{status:400})}
}
