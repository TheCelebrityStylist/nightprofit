import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {decimalToMinor} from "../../../lib/imports/locale-number";
import {requiredStaff} from "../../../lib/operations/planning";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";

const envelope=z.object({
  organisationId:z.string().uuid(),
  locale:z.enum(["nl-NL","en-US"]).default("nl-NL"),
  action:z.enum(["department","role","forecast","shift","shift_update","shift_cancel","copy_week","staff","staff_deactivate","absence","absence_decide","publish","availability","proposal","resolve_action"]),
  values:z.record(z.string(),z.string()),
});
const departmentSchema=z.object({venueId:z.string().uuid(),name:z.string().trim().min(2).max(100)});
const roleSchema=z.object({departmentId:z.string().uuid(),name:z.string().trim().min(2).max(100),hourlyCost:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000)});
const forecastSchema=z.object({venueId:z.string().uuid(),tradingDate:z.iso.date(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),expectedGuests:z.coerce.number().int().min(0).max(100000),expectedRevenue:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000),managerNote:z.string().trim().max(1000).default("")});
const shiftSchema=z.object({venueId:z.string().uuid(),departmentId:z.string().uuid(),roleId:z.string().uuid(),staffId:z.union([z.string().uuid(),z.literal("open")]),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),breakMinutes:z.coerce.number().int().min(0).max(480),hourlyCost:z.string()});
const shiftUpdateSchema=shiftSchema.extend({shiftId:z.string().uuid()});
const shiftCancelSchema=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid()});
const copyWeekSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),idempotencyKey:z.string().uuid()});
const staffSchema=z.object({venueId:z.string().uuid(),fullName:z.string().trim().min(2).max(140),email:z.union([z.literal(""),z.email()]),phone:z.string().trim().max(40),roleName:z.string().trim().min(2).max(100),engagementType:z.enum(["employee","contractor","temporary"]),preferredLanguage:z.enum(["nl","en"])});
const staffDeactivateSchema=z.object({staffId:z.string().uuid()});
const absenceSchema=z.object({venueId:z.string().uuid(),staffId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),absenceType:z.enum(["leave","sickness","other"]),note:z.string().trim().max(500)});
const absenceDecisionSchema=z.object({venueId:z.string().uuid(),absenceId:z.string().uuid(),decision:z.enum(["approved","rejected"])});
const publishSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true})});
const availabilitySchema=z.object({venueId:z.string().uuid(),staffId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),availability:z.enum(["available","preferred","unavailable"]),note:z.string().trim().max(500).default("")});
const proposalSchema=z.object({venueId:z.string().uuid(),tradingDate:z.iso.date()});
const resolveSchema=z.object({actionId:z.string().uuid(),resolution:z.string().trim().min(5).max(2000)});
const iso=(value:string)=>new Date(value).toISOString();

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=envelope.parse(await request.json());
    if(input.action==="department"){
      const values=departmentSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {error}=await supabase.from("departments").insert({organisation_id:input.organisationId,venue_id:values.venueId,name:values.name});
      if(error)throw error;
      return NextResponse.json({message:"Afdeling toegevoegd."},{status:201});
    }
    if(input.action==="role"){
      const values=roleSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage");
      const {error}=await supabase.from("operational_roles").insert({organisation_id:input.organisationId,department_id:values.departmentId,name:values.name,hourly_cost_minor:decimalToMinor(values.hourlyCost,input.locale).toString(),minimum_staff:values.minimumStaff,guests_per_staff:values.guestsPerStaff});
      if(error)throw error;
      return NextResponse.json({message:"Operationele rol toegevoegd."},{status:201});
    }
    if(input.action==="forecast"){
      const values=forecastSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);
      if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_WINDOW");
      const interval=[{starts_at:startsAt,ends_at:endsAt,expected_guests:values.expectedGuests,expected_revenue_minor:decimalToMinor(values.expectedRevenue,input.locale).toString(),required_staff:requiredStaff(values.expectedGuests,values.minimumStaff,values.guestsPerStaff)}];
      const {error}=await supabase.rpc("create_demand_plan",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_trading_date:values.tradingDate,interval_inputs:interval,target_assumptions:{manager_note:values.managerNote,minimum_staff:values.minimumStaff,guests_per_staff:values.guestsPerStaff}});
      if(error)throw error;
      return NextResponse.json({message:"Intervalforecast met personeelsbehoefte opgeslagen."},{status:201});
    }
    if(input.action==="shift"){
      const values=shiftSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);
      if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_WINDOW");
      if(values.staffId!=="open"){
        const {data:overlaps}=await supabase.from("shifts").select("id").eq("organisation_id",input.organisationId).eq("staff_id",values.staffId).lt("starts_at",endsAt).gt("ends_at",startsAt).not("status","in","(cancelled,rejected)").limit(1);
        if(overlaps?.length)return NextResponse.json({errorCode:"SHIFT_OVERLAP"},{status:409});
      }
      const {error}=await supabase.from("shifts").insert({organisation_id:input.organisationId,venue_id:values.venueId,department_id:values.departmentId,role_id:values.roleId,staff_id:values.staffId==="open"?null:values.staffId,starts_at:startsAt,ends_at:endsAt,break_minutes:values.breakMinutes,hourly_cost_minor:decimalToMinor(values.hourlyCost,input.locale).toString(),status:"draft",source:"manager",created_by:user.id});
      if(error)throw error;
      return NextResponse.json({message:"Conceptdienst toegevoegd; publicatie vereist."},{status:201});
    }
    if(input.action==="shift_update"){
      const values=shiftUpdateSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);
      if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_WINDOW");
      if(values.staffId!=="open"){
        const {data:overlaps}=await supabase.from("shifts").select("id").eq("organisation_id",input.organisationId).eq("staff_id",values.staffId).neq("id",values.shiftId).lt("starts_at",endsAt).gt("ends_at",startsAt).not("status","in","(cancelled,rejected)").limit(1);
        if(overlaps?.length)return NextResponse.json({errorCode:"SHIFT_OVERLAP"},{status:409});
      }
      const {data,error}=await supabase.from("shifts").update({department_id:values.departmentId,role_id:values.roleId,staff_id:values.staffId==="open"?null:values.staffId,starts_at:startsAt,ends_at:endsAt,break_minutes:values.breakMinutes,hourly_cost_minor:decimalToMinor(values.hourlyCost,input.locale).toString(),status:"draft",source:"manager",created_by:user.id,updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).select("id").single();
      if(error||!data)throw error??new Error("SHIFT_NOT_FOUND");
      return NextResponse.json({message:"Conceptrooster automatisch opgeslagen."});
    }
    if(input.action==="shift_cancel"){
      const values=shiftCancelSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.from("shifts").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).select("id").single();
      if(error||!data)throw error??new Error("SHIFT_NOT_FOUND");
      return NextResponse.json({message:"Dienst verwijderd uit het conceptrooster."});
    }
    if(input.action==="copy_week"){
      const values=copyWeekSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const receipt=`roster-copy:${input.organisationId}:${values.idempotencyKey}`;
      const jobs=supabase.from("job_runs") as unknown as {insert:(value:Record<string,unknown>)=>Promise<{error:{code?:string}|null}>;update:(value:Record<string,unknown>)=>{eq:(column:string,value:string)=>Promise<unknown>}};
      const {error:receiptError}=await jobs.insert({organisation_id:input.organisationId,venue_id:values.venueId,job_type:"roster_copy",idempotency_key:receipt,status:"started",started_at:new Date().toISOString()});
      if(receiptError?.code==="23505")return NextResponse.json({message:"Deze week was al gekopieerd.",replayed:true});
      if(receiptError)throw receiptError;
      const start=iso(values.startsAt),end=iso(values.endsAt);
      const {data:source,error:sourceError}=await supabase.from("shifts").select("department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).gte("starts_at",start).lt("starts_at",end).not("status","in","(cancelled,rejected)");
      if(sourceError)throw sourceError;
      const copied=((source??[]) as unknown as {department_id:string;role_id:string;staff_id:string|null;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string}[]).map(row=>({...row,organisation_id:input.organisationId,venue_id:values.venueId,starts_at:new Date(new Date(row.starts_at).getTime()+7*86400000).toISOString(),ends_at:new Date(new Date(row.ends_at).getTime()+7*86400000).toISOString(),status:"draft",source:"template",created_by:user.id}));
      if(copied.length){const {error}=await supabase.from("shifts").insert(copied);if(error)throw error;}
      await jobs.update({status:"succeeded",finished_at:new Date().toISOString()}).eq("idempotency_key",receipt);
      return NextResponse.json({message:`${copied.length} dienst(en) naar volgende week gekopieerd.`},{status:201});
    }
    if(input.action==="staff"){
      const values=staffSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"members.manage",values.venueId);
      const {data,error}=await supabase.from("staff_profiles").insert({organisation_id:input.organisationId,full_name:values.fullName,contact_email:values.email||null,contact_phone:values.phone||null,preferred_language:values.preferredLanguage,engagement_type:values.engagementType,role_name:values.roleName,onboarding_status:"invited"}).select("id").single();
      if(error||!data)throw error??new Error("STAFF_CREATE_FAILED");
      const assignments=supabase.from("staff_venue_assignments") as unknown as {insert:(value:Record<string,unknown>)=>Promise<{error:unknown}>};
      const {error:assignmentError}=await assignments.insert({organisation_id:input.organisationId,staff_id:data.id,venue_id:values.venueId});
      if(assignmentError)throw assignmentError;
      await supabase.from("audit_logs").insert({organisation_id:input.organisationId,venue_id:values.venueId,actor_id:user.id,action:"staff.created",entity_type:"staff_profile",entity_id:data.id,after_summary:{engagement_type:values.engagementType,role_name:values.roleName},correlation_id:crypto.randomUUID(),source:"planning_api"});
      return NextResponse.json({message:"Medewerker toegevoegd. Verstuur daarna een beveiligde beschikbaarheidsuitnodiging."},{status:201});
    }
    if(input.action==="staff_deactivate"){
      const values=staffDeactivateSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"members.manage");
      const {data,error}=await supabase.from("staff_profiles").update({onboarding_status:"suspended",end_date:new Date().toISOString().slice(0,10),updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("id",values.staffId).select("id").single();
      if(error||!data)throw error??new Error("STAFF_NOT_FOUND");
      return NextResponse.json({message:"Medewerker gedeactiveerd; historie blijft behouden."});
    }
    if(input.action==="absence"){
      const values=absenceSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_WINDOW");
      const {error}=await supabase.from("staff_absences").insert({organisation_id:input.organisationId,venue_id:values.venueId,staff_id:values.staffId,starts_at:startsAt,ends_at:endsAt,absence_type:values.absenceType,status:values.absenceType==="sickness"?"recorded":"requested",note:values.note||null});if(error)throw error;
      return NextResponse.json({message:"Afwezigheid opgeslagen; roosterconflicten zijn bijgewerkt."},{status:201});
    }
    if(input.action==="absence_decide"){
      const values=absenceDecisionSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.from("staff_absences").update({status:values.decision,reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.absenceId).select("id").single();if(error||!data)throw error??new Error("ABSENCE_NOT_FOUND");
      return NextResponse.json({message:"Verlofbesluit opgeslagen; dekking is opnieuw beoordeeld."});
    }
    if(input.action==="publish"){
      const values=publishSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("publish_roster",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,window_start:iso(values.startsAt),window_end:iso(values.endsAt)});
      if(error)throw error;
      return NextResponse.json({message:`${data} dienst(en) gepubliceerd.`});
    }
    if(input.action==="availability"){
      const values=availabilitySchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"planning.respond",values.venueId);
      const [{data:manager},{data:staff}]=await Promise.all([
        supabase.rpc("has_capability",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,required_capability:"planning.manage"}),
        supabase.from("staff_profiles").select("auth_user_id").eq("organisation_id",input.organisationId).eq("id",values.staffId).single(),
      ]);
      if(!manager&&staff?.auth_user_id!==user.id)throw new Error("FORBIDDEN");
      const {error}=await supabase.from("staff_availability").insert({organisation_id:input.organisationId,venue_id:values.venueId,staff_id:values.staffId,starts_at:iso(values.startsAt),ends_at:iso(values.endsAt),availability:values.availability,note:values.note||null,source:manager?"manager":"employee",created_by:user.id});
      if(error)throw error;
      return NextResponse.json({message:"Beschikbaarheid vastgelegd."},{status:201});
    }
    if(input.action==="proposal"){
      const values=proposalSchema.parse(input.values);
      const {supabase,user}=await requireMembership(input.organisationId,"ai.propose",values.venueId);
      const dayStart=`${values.tradingDate}T00:00:00.000Z`,dayEnd=`${values.tradingDate}T23:59:59.999Z`;
      const [{data:intervals},{data:shifts}]=await Promise.all([
        supabase.from("demand_forecast_intervals").select("expected_guests,expected_revenue_minor,required_staff,starts_at,ends_at").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).gte("starts_at",dayStart).lte("starts_at",dayEnd),
        supabase.from("shifts").select("id,staff_id,starts_at,ends_at,status").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).gte("starts_at",dayStart).lte("starts_at",dayEnd).not("status","in","(cancelled,rejected)"),
      ]);
      const intervalRows=(intervals??[]) as unknown as {required_staff:number;starts_at:string;ends_at:string}[];
      const shiftRows=(shifts??[]) as unknown as {staff_id:string|null;starts_at:string;ends_at:string}[];
      const gaps=intervalRows.map(interval=>({starts_at:interval.starts_at,ends_at:interval.ends_at,required:interval.required_staff,planned:shiftRows.filter(shift=>new Date(shift.starts_at)<new Date(interval.ends_at)&&new Date(shift.ends_at)>new Date(interval.starts_at)).length})).filter(gap=>gap.required!==gap.planned);
      const {error}=await supabase.from("ai_proposals").insert({organisation_id:input.organisationId,venue_id:values.venueId,action_type:"schedule_proposal",proposed_change:{staffing_gaps:gaps},rationale:gaps.length?"Pas de conceptdiensten aan op de vastgelegde intervalvraag.":"De huidige conceptbezetting dekt de vastgelegde intervalvraag.",expected_effect:{gap_count:gaps.length},evidence_refs:[],input_snapshot:{trading_date:values.tradingDate,interval_count:intervalRows.length,shift_count:shiftRows.length},missing_data:intervalRows.length?["Geen gekalibreerde historische confidence beschikbaar."]:["Geen intervalforecast beschikbaar."],confidence_basis:"Deterministische vergelijking; geen modelconfidence.",model_version:"deterministic-fallback-1",prompt_version:"schedule-v1",approval_status:"proposed",execution_status:"not_started",created_by:user.id});
      if(error)throw error;
      return NextResponse.json({message:"Uitlegbare planningpropositie aangemaakt; er is niets automatisch gewijzigd."},{status:201});
    }
    const values=resolveSchema.parse(input.values);
    const {supabase,user}=await requireMembership(input.organisationId,"actions.manage");
    const {error}=await supabase.from("operating_actions").update({status:"resolved",resolution:values.resolution,owner_id:user.id,updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("id",values.actionId);
    if(error)throw error;
    return NextResponse.json({message:"Actie opgelost en verantwoord."});
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"PLANNING_ACTION_FAILED"},{status:400});
  }
}
