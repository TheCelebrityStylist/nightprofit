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
    let learningState:"not_requested"|"ready"|"insufficient_comparables"|"evidence_not_ready"="not_requested";
    if(input.target==="locked"){
      const close=data as unknown as {organisation_id:string;venue_id:string;trading_date:string};
      const {data:operation}=await supabase.from("service_operations").select("id").eq("organisation_id",close.organisation_id).eq("venue_id",close.venue_id).eq("service_date",close.trading_date).not("status","in","(superseded)").order("version",{ascending:false}).limit(1).maybeSingle();
      if(operation?.id){
        await supabase.rpc("refresh_service_intelligence" as "clock_out",{target_organisation_id:close.organisation_id,target_service_operation_id:operation.id} as never);
        const {data:learning}=await supabase.rpc("calculate_workforce_learning" as "clock_out",{target_organisation_id:close.organisation_id,target_service_operation_id:operation.id} as never);
        learningState=learning?(learning as unknown as {evidence_state:"ready"|"insufficient_comparables"}).evidence_state:"evidence_not_ready";
      }else learningState="evidence_not_ready";
    }
    return NextResponse.json({close:data,learningState});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_CLOSE_TRANSITION":"CLOSE_TRANSITION_FAILED"},{status:400});}
}
