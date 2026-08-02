import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";

const inputSchema=z.object({organisationId:z.string().uuid(),action:z.enum(["respond","clock_in","clock_out","approve_time"]),values:z.record(z.string(),z.string())});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=inputSchema.parse(await request.json());
    if(input.action==="respond"){
      const values=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid(),staffId:z.string().uuid(),response:z.enum(["accepted","rejected"]),reason:z.string().trim().max(500).default("")}).parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.respond",values.venueId);
      const {data:staff}=await supabase.from("staff_profiles").select("auth_user_id").eq("organisation_id",input.organisationId).eq("id",values.staffId).single();
      if(staff?.auth_user_id!==user.id)throw new Error("FORBIDDEN");
      const {error}=await supabase.from("shift_responses").insert({organisation_id:input.organisationId,venue_id:values.venueId,shift_id:values.shiftId,staff_id:values.staffId,response:values.response,reason:values.reason||null});
      if(error)throw error;
      return NextResponse.json({message:values.response==="accepted"?"Dienst bevestigd.":"Afwijzing is aan de planner doorgegeven."},{status:201});
    }
    if(input.action==="clock_in"){
      const values=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid().optional()}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"time.record",values.venueId);
      const {error}=await supabase.rpc("clock_in",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_shift_id:values.shiftId||null});
      if(error)throw error;
      return NextResponse.json({message:"Ingeklokt. Je starttijd is veilig vastgelegd."},{status:201});
    }
    if(input.action==="clock_out"){
      const values=z.object({timeRecordId:z.string().uuid()}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"time.record");
      const {error}=await supabase.rpc("clock_out",{target_organisation_id:input.organisationId,target_time_record_id:values.timeRecordId});
      if(error)throw error;
      return NextResponse.json({message:"Uitgeklokt en uren ter goedkeuring ingediend."});
    }
    const values=z.object({timeRecordId:z.string().uuid(),correctionReason:z.string().trim().max(1000).default("")}).parse(input.values);
    const {supabase}=await requireMembership(input.organisationId,"time.approve");
    const {error}=await supabase.rpc("approve_time_record",{target_organisation_id:input.organisationId,target_time_record_id:values.timeRecordId,target_correction_reason:values.correctionReason||null});
    if(error)throw error;
    return NextResponse.json({message:"Uren goedgekeurd en geaudit."});
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"WORKFORCE_ACTION_FAILED"},{status:400});
  }
}
