import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";

const inputSchema=z.object({organisationId:z.string().uuid(),action:z.enum(["respond","request_leave","report_sickness","withdraw_leave","clock_in","start_break","end_break","clock_out","claim_open_shift","request_swap","respond_swap","request_correction","approve_time"]),values:z.record(z.string(),z.string())});

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
    if(input.action==="request_leave"||input.action==="report_sickness"){
      const values=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),note:z.string().trim().max(1000).default("")}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.respond",values.venueId);
      const {data,error}=await supabase.rpc("request_staff_absence" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_starts_at:new Date(values.startsAt).toISOString(),target_ends_at:new Date(values.endsAt).toISOString(),target_type:input.action==="report_sickness"?"sickness":"leave",target_note:values.note||null} as never);if(error)throw error;
      return NextResponse.json({message:input.action==="report_sickness"?"Ziekmelding veilig vastgelegd; de planner ziet alleen de noodzakelijke dekkingsactie.":"Verlofaanvraag ingediend." ,result:data},{status:201});
    }
    if(input.action==="withdraw_leave"){
      const values=z.object({absenceId:z.string().uuid()}).parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.respond");
      const {error}=await supabase.rpc("withdraw_staff_leave" as "clock_out",{target_organisation_id:input.organisationId,target_absence_id:values.absenceId} as never);if(error)throw error;return NextResponse.json({message:"Openstaande verlofaanvraag ingetrokken."});
    }
    if(input.action==="clock_out"){
      const values=z.object({timeRecordId:z.string().uuid()}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"time.record");
      const {error}=await supabase.rpc("clock_out",{target_organisation_id:input.organisationId,target_time_record_id:values.timeRecordId});
      if(error)throw error;
      return NextResponse.json({message:"Uitgeklokt en uren ter goedkeuring ingediend."});
    }
    if(input.action==="start_break"||input.action==="end_break"){
      const values=z.object({timeRecordId:z.string().uuid()}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"time.record");
      const functionName=input.action==="start_break"?"start_time_break":"end_time_break";
      const {error}=await supabase.rpc(functionName as "clock_out",{target_organisation_id:input.organisationId,target_time_record_id:values.timeRecordId});
      if(error)throw error;
      return NextResponse.json({message:input.action==="start_break"?"Pauze gestart en onveranderlijk vastgelegd.":"Pauze beëindigd en vastgelegd."});
    }
    if(input.action==="claim_open_shift"){
      const values=z.object({offerId:z.string().uuid()}).parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.respond");
      const {error}=await supabase.rpc("claim_open_shift" as "clock_out",{target_organisation_id:input.organisationId,target_offer_id:values.offerId} as never);
      if(error)throw error;
      return NextResponse.json({message:"Open dienst atomair toegewezen. Een gelijktijdige tweede claim kan deze dienst niet overnemen."});
    }
    if(input.action==="request_swap"){
      const values=z.object({shiftId:z.string().uuid(),candidateStaffId:z.string().uuid(),reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.respond");
      const {data,error}=await supabase.rpc("request_shift_swap" as "clock_out",{target_organisation_id:input.organisationId,target_shift_id:values.shiftId,target_candidate_staff_id:values.candidateStaffId,target_reason:values.reason,target_idempotency_key:values.idempotencyKey} as never);if(error)throw error;return NextResponse.json({message:"Ruilverzoek veilig ingediend; de collega en manager moeten nog beslissen.",swap:data},{status:201});
    }
    if(input.action==="respond_swap"){
      const values=z.object({swapId:z.string().uuid(),decision:z.enum(["accept","decline"])}).parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.respond");
      const {data,error}=await supabase.rpc("respond_shift_swap" as "clock_out",{target_organisation_id:input.organisationId,target_swap_id:values.swapId,target_accept:values.decision==="accept"} as never);if(error)throw error;return NextResponse.json({message:values.decision==="accept"?"Je instemming is vastgelegd; de manager beslist definitief.":"Ruilverzoek afgewezen.",swap:data});
    }
    if(input.action==="request_correction"){
      const values=z.object({venueId:z.string().uuid(),timeRecordId:z.string().uuid(),proposedClockIn:z.iso.datetime({local:true}).optional(),proposedClockOut:z.iso.datetime({local:true}).optional(),proposedBreakMinutes:z.coerce.number().int().min(0).max(480),reason:z.string().trim().min(5).max(1000)}).parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"time.record",values.venueId);
      const {data:rawRecord,error:recordError}=await supabase.from("time_records").select("id,staff_id,clocked_in_at,clocked_out_at,break_minutes").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.timeRecordId).single();if(recordError||!rawRecord)throw recordError??new Error("TIME_RECORD_NOT_FOUND");const record=rawRecord as unknown as {id:string;staff_id:string;clocked_in_at:string;clocked_out_at:string|null;break_minutes:number};
      const {data:staff}=await supabase.from("staff_profiles").select("auth_user_id").eq("organisation_id",input.organisationId).eq("id",record.staff_id).single();if(staff?.auth_user_id!==user.id)throw new Error("FORBIDDEN");
      const corrections=supabase.from("time_corrections") as unknown as {insert:(value:Record<string,unknown>)=>Promise<{error:unknown}>};
      const {error}=await corrections.insert({organisation_id:input.organisationId,venue_id:values.venueId,time_record_id:values.timeRecordId,requested_by:user.id,reason:values.reason,original_values:{clocked_in_at:record.clocked_in_at,clocked_out_at:record.clocked_out_at,break_minutes:record.break_minutes},proposed_values:{clocked_in_at:values.proposedClockIn?new Date(values.proposedClockIn).toISOString():record.clocked_in_at,clocked_out_at:values.proposedClockOut?new Date(values.proposedClockOut).toISOString():record.clocked_out_at,break_minutes:values.proposedBreakMinutes},status:"requested"});if(error)throw error;
      return NextResponse.json({message:"Uurcorrectie ingediend; oorspronkelijke tijdgebeurtenissen blijven behouden."},{status:201});
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
