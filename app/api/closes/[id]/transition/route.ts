import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { assertSameOrigin, securityErrorResponse } from "../../../../../lib/http/security";

const schema=z.object({target:z.enum(["submitted","approved","locked","reopened"]),reason:z.string().trim().max(2000).nullable().optional()});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const {id}=await params;
    const input=schema.parse(await request.json());
    const supabase=await createSupabaseServerClient();
    const {data,error}=await supabase.rpc("transition_close",{target_close_id:id,target_status:input.target,reason:input.reason??null});
    if(error||!data)return NextResponse.json({errorCode:"CLOSE_TRANSITION_FORBIDDEN"},{status:403});
    return NextResponse.json({close:data});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_CLOSE_TRANSITION":"CLOSE_TRANSITION_FAILED"},{status:400});}
}
