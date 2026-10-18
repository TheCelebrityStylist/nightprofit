import {createClient} from "@supabase/supabase-js";
import {NextResponse} from "next/server";
import {z} from "zod";
import {serverEnv} from "../../../../lib/env";
import type {Database} from "../../../../lib/supabase/types";
import {hashAvailabilityToken} from "../../../../lib/workforce/availability";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";

const schema=z.object({
  token:z.string(),
  entries:z.array(z.object({date:z.iso.date(),availability:z.enum(["available","preferably_not","unavailable"]),note:z.string().trim().max(300).optional()})).max(62),
});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const env=serverEnv();
    if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error("CONFIGURATION_REQUIRED");
    const supabase=createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await supabase.rpc("submit_availability_request_v3" as "submit_availability_request",{target_token_hash:hashAvailabilityToken(input.token),target_entries:input.entries} as never);
    if(error){
      const message=String(error.message??"");
      const code=message.includes("deadline_passed")||message.includes("token_expired")?"DEADLINE_PASSED":message.includes("night_not_requested")?"NIGHT_NOT_REQUESTED":message.includes("revoked")||message.includes("request_closed")?"REQUEST_CLOSED":"AVAILABILITY_RESPONSE_FAILED";
      return NextResponse.json({errorCode:code},{status:409});
    }
    return NextResponse.json({result:data});
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"AVAILABILITY_RESPONSE_FAILED"},{status:400});
  }
}
