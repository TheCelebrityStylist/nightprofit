import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { requireMembership } from "../../../lib/auth/require-membership";
import { assertSameOrigin, securityErrorResponse } from "../../../lib/http/security";

const schema=z.object({
  organisationId:z.string().uuid(),
  venueId:z.string().uuid(),
  tradingDate:z.iso.date(),
});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const membership=await requireMembership(input.organisationId,"close.create",input.venueId);
    const supabase=await createSupabaseServerClient();
    const {data,error}=await supabase.rpc("create_close_draft",{
      target_organisation_id:input.organisationId,
      target_venue_id:input.venueId,
      target_trading_date:input.tradingDate,
    });
    if(error||!data)return NextResponse.json({errorCode:"CLOSE_CREATE_FAILED"},{status:400});
    await supabase.from("audit_logs").insert({
      organisation_id:input.organisationId,actor_id:membership.user.id,action:"close.created",
      entity_type:"closing_session",entity_id:data.id,
      after_summary:{venue_id:input.venueId,trading_date:input.tradingDate,status:"draft"},
      correlation_id:crypto.randomUUID(),source:"api",
    });
    return NextResponse.json({id:data.id},{status:201});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_CLOSE_INPUT":"CLOSE_CREATE_FAILED"},{status:400});}
}
