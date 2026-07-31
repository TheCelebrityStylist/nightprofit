import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { requireMembership } from "../../../lib/auth/require-membership";

const schema=z.object({
  organisationId:z.string().uuid(),
  venueId:z.string().uuid(),
  tradingDate:z.iso.date(),
});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());
    const membership=await requireMembership(input.organisationId,"close.create",input.venueId);
    const supabase=await createSupabaseServerClient();
    const {data,error}=await supabase.from("closing_sessions").insert({
      organisation_id:input.organisationId,venue_id:input.venueId,trading_date:input.tradingDate,
      created_by:membership.user.id,status:"draft",
    }).select("id").single();
    if(error||!data){const duplicate=error?.code==="23505";return NextResponse.json({code:duplicate?"duplicate":"create_failed",error:duplicate?"Voor deze handelsdatum bestaat al een afsluiting.":"Afsluiting kon niet worden aangemaakt."},{status:400});}
    await supabase.from("audit_logs").insert({
      organisation_id:input.organisationId,actor_id:membership.user.id,action:"close.created",
      entity_type:"closing_session",entity_id:data.id,
      after_summary:{venue_id:input.venueId,trading_date:input.tradingDate,status:"draft"},
      correlation_id:crypto.randomUUID(),source:"api",
    });
    return NextResponse.json({id:data.id},{status:201});
  }catch{return NextResponse.json({code:"invalid",error:"Ongeldige of niet-toegestane aanvraag."},{status:400});}
}
