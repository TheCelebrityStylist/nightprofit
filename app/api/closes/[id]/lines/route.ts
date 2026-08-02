import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../../../lib/auth/require-membership";
import { decimalToMinor } from "../../../../../lib/imports/locale-number";
import { assertSameOrigin, securityErrorResponse } from "../../../../../lib/http/security";

const schema=z.object({
  organisationId:z.string().uuid(),
  lineType:z.enum(["pos_sales","pos_tender","terminal","cash","online_tickets","booking_deposit","house_account","refund","complimentary","tips","payout","safe_drop","opening_float","manual_correction"]),
  expected:z.string().max(32),
  actual:z.string().max(32),
  locale:z.enum(["nl-NL","en-US"]).default("nl-NL"),
  metadata:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({}),
  idempotencyKey:z.string().trim().min(8).max(200),
});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const {id}=await params;
    const input=schema.parse(await request.json());
    const {supabase,user}=await requireMembership(input.organisationId,"close.create");
    const {data:close}=await supabase.from("closing_sessions").select("id,venue_id,status").eq("id",id).eq("organisation_id",input.organisationId).single();
    if(!close||!["draft","reopened"].includes(close.status))throw new Error("FORBIDDEN");
    await requireMembership(input.organisationId,"close.create",close.venue_id);
    const expectedMinor=decimalToMinor(input.expected,input.locale).toString();
    const actualMinor=decimalToMinor(input.actual,input.locale).toString();
    const {data,error}=await supabase.rpc("add_close_line",{
      target_organisation_id:input.organisationId,
      target_close_id:id,
      target_line_type:input.lineType,
      target_expected_minor:expectedMinor,
      target_actual_minor:actualMinor,
      target_metadata:input.metadata,
      target_idempotency_key:input.idempotencyKey,
    });
    if(error||!data)throw new Error("INSERT_FAILED");
    await supabase.from("audit_logs").insert({
      organisation_id:input.organisationId,venue_id:close.venue_id,actor_id:user.id,
      action:"close.line_added",entity_type:"closing_session",entity_id:id,
      after_summary:{line_type:input.lineType,expected_minor:expectedMinor,actual_minor:actualMinor},
      correlation_id:crypto.randomUUID(),source:"api",
    });
    return NextResponse.json({id:data.id},{status:201});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_CLOSE_LINE":"CLOSE_LINE_FAILED"},{status:400});}
}
