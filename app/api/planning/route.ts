import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {decimalToMinor} from "../../../lib/imports/locale-number";
import {requiredStaff} from "../../../lib/operations/planning";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";
import {rankSchedulingCandidates,type RosterObjective,type AvailabilityState} from "../../../lib/workforce/maestro";
import {normalizeDutchPhone} from "../../../lib/workforce/domain";
import {calculateCoverage,simulateDemand} from "../../../lib/workforce/decision-support";

const envelope=z.object({
  organisationId:z.string().uuid(),
  locale:z.enum(["nl-NL","en-US"]).default("nl-NL"),
  action:z.enum(["department","role","forecast","shift","shift_update","shift_cancel","shift_duplicate","shift_lock","shift_bulk","planner_history","template_save","template_apply","break_plan","copy_week","staff","staff_deactivate","absence","absence_decide","publish","availability","proposal","proposal_apply","scenario","resolve_action"]),
  values:z.record(z.string(),z.string()),
});
const departmentSchema=z.object({venueId:z.string().uuid(),name:z.string().trim().min(2).max(100)});
const roleSchema=z.object({departmentId:z.string().uuid(),name:z.string().trim().min(2).max(100),hourlyCost:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000)});
const forecastSchema=z.object({venueId:z.string().uuid(),tradingDate:z.iso.date(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),expectedGuests:z.coerce.number().int().min(0).max(100000),expectedRevenue:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000),managerNote:z.string().trim().max(1000).default("")});
const shiftSchema=z.object({venueId:z.string().uuid(),departmentId:z.string().uuid(),roleId:z.string().uuid(),staffId:z.union([z.string().uuid(),z.literal("open")]),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),breakMinutes:z.coerce.number().int().min(0).max(480),hourlyCost:z.string()});
const shiftUpdateSchema=shiftSchema.extend({shiftId:z.string().uuid(),expectedRevision:z.coerce.number().int().positive().default(1)});
const shiftCancelSchema=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid()});
const shiftLockSchema=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid(),locked:z.enum(["true","false"]),expectedRevision:z.coerce.number().int().positive()});
const shiftDuplicateSchema=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid(),idempotencyKey:z.string().uuid()});
const shiftBulkSchema=z.object({venueId:z.string().uuid(),shiftIds:z.string().transform(value=>z.array(z.string().uuid()).min(1).max(100).parse(JSON.parse(value))),expectedRevisions:z.string().transform(value=>z.record(z.string().uuid(),z.number().int().positive()).parse(JSON.parse(value))),operation:z.enum(["cancel","lock","unlock","assign","role"]),staffId:z.string().uuid().optional(),roleId:z.string().uuid().optional(),idempotencyKey:z.string().uuid()});
const plannerHistorySchema=z.object({venueId:z.string().uuid(),changeSetId:z.string().uuid(),direction:z.enum(["undo","redo"])});
const templateSaveSchema=z.object({venueId:z.string().uuid(),name:z.string().trim().min(2).max(100),shiftIds:z.string().transform(value=>z.array(z.string().uuid()).min(1).max(200).parse(JSON.parse(value)))});
const templateApplySchema=z.object({venueId:z.string().uuid(),templateId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),repeatCount:z.coerce.number().int().min(1).max(52),idempotencyKey:z.string().uuid()});
const breakPlanSchema=z.object({venueId:z.string().uuid(),shiftId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true})});
const copyWeekSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),idempotencyKey:z.string().uuid()});
const staffSchema=z.object({venueId:z.string().uuid(),fullName:z.string().trim().min(2).max(140),email:z.union([z.literal(""),z.email()]),phone:z.string().trim().max(40),roleName:z.string().trim().min(2).max(100),engagementType:z.enum(["employee","contractor","temporary"]),preferredLanguage:z.enum(["nl","en"])});
const staffDeactivateSchema=z.object({staffId:z.string().uuid()});
const absenceSchema=z.object({venueId:z.string().uuid(),staffId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),absenceType:z.enum(["leave","sickness","other"]),note:z.string().trim().max(500)});
const absenceDecisionSchema=z.object({venueId:z.string().uuid(),absenceId:z.string().uuid(),decision:z.enum(["approved","rejected"])});
const publishSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),expectedRevision:z.coerce.number().int().positive(),idempotencyKey:z.string().uuid()});
const availabilitySchema=z.object({venueId:z.string().uuid(),staffId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),availability:z.enum(["available","preferred","unavailable"]),note:z.string().trim().max(500).default("")});
const proposalSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true})});
const proposalApplySchema=z.object({venueId:z.string().uuid(),proposalId:z.string().uuid()});
const scenarioSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),demandChangeBasisPoints:z.coerce.number().int().min(-10000).max(100000),idempotencyKey:z.string().uuid()});
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
      const {data,error}=await supabase.from("shifts").update({department_id:values.departmentId,role_id:values.roleId,staff_id:values.staffId==="open"?null:values.staffId,starts_at:startsAt,ends_at:endsAt,break_minutes:values.breakMinutes,hourly_cost_minor:decimalToMinor(values.hourlyCost,input.locale).toString(),status:"draft",source:"manager",created_by:user.id,updated_at:new Date().toISOString(),revision:values.expectedRevision+1}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).eq("revision",values.expectedRevision).eq("locked",false).select("id").single();
      if(error||!data)throw error??new Error("CONCURRENT_SHIFT_EDIT");
      return NextResponse.json({message:"Conceptrooster automatisch opgeslagen."});
    }
    if(input.action==="shift_cancel"){
      const values=shiftCancelSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.from("shifts").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).select("id").single();
      if(error||!data)throw error??new Error("SHIFT_NOT_FOUND");
      return NextResponse.json({message:"Dienst verwijderd uit het conceptrooster."});
    }
    if(input.action==="shift_lock"){
      const values=shiftLockSchema.parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.from("shifts").update({locked:values.locked==="true",revision:values.expectedRevision+1,updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).eq("revision",values.expectedRevision).select("id").single();if(error||!data)throw error??new Error("CONCURRENT_SHIFT_EDIT");
      return NextResponse.json({message:values.locked==="true"?"Dienst vergrendeld tegen roosterwijzigingen.":"Dienst ontgrendeld."});
    }
    if(input.action==="shift_bulk"){
      const values=shiftBulkSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("mutate_roster_shifts" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_shift_ids:values.shiftIds,target_expected_revisions:values.expectedRevisions,target_operation:values.operation,target_staff_id:values.staffId??null,target_role_id:values.roleId??null,target_idempotency_key:values.idempotencyKey} as never);
      if(error)throw error;
      const result=data as unknown as {changed?:number;change_set_id?:string;replayed?:boolean};
      return NextResponse.json({message:result.replayed?"Deze wijziging was al verwerkt.":`${result.changed??0} dienst(en) bijgewerkt.`,changeSetId:result.change_set_id,replayed:result.replayed});
    }
    if(input.action==="planner_history"){
      const values=plannerHistorySchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("replay_roster_change" as "clock_out",{target_organisation_id:input.organisationId,target_change_set_id:values.changeSetId,target_direction:values.direction} as never);
      if(error)throw error;
      return NextResponse.json({message:values.direction==="undo"?"Laatste roosterwijziging ongedaan gemaakt.":"Roosterwijziging opnieuw toegepast.",changeSet:data});
    }
    if(input.action==="template_save"){
      const values=templateSaveSchema.parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("save_roster_template" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_name:values.name,target_shift_ids:values.shiftIds} as never);if(error)throw error;
      return NextResponse.json({message:"Roostertemplate met relatieve diensttijden opgeslagen.",template:data},{status:201});
    }
    if(input.action==="template_apply"){
      const values=templateApplySchema.parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("apply_roster_template" as "clock_out",{target_organisation_id:input.organisationId,target_template_id:values.templateId,target_starts_at:iso(values.startsAt),target_repeat_count:values.repeatCount,target_idempotency_key:values.idempotencyKey} as never);if(error)throw error;
      return NextResponse.json({message:`${(data as unknown as {created?:number})?.created??0} conceptdienst(en) vanuit template gemaakt.`,result:data},{status:201});
    }
    if(input.action==="shift_duplicate"){
      const values=shiftDuplicateSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);const receipt=`shift-duplicate:${input.organisationId}:${values.idempotencyKey}`;
      const jobs=supabase.from("job_runs") as unknown as {insert:(value:Record<string,unknown>)=>Promise<{error:{code?:string}|null}>;update:(value:Record<string,unknown>)=>{eq:(column:string,value:string)=>Promise<unknown>}};const {error:receiptError}=await jobs.insert({organisation_id:input.organisationId,venue_id:values.venueId,job_type:"shift_duplicate",idempotency_key:receipt,status:"started",started_at:new Date().toISOString()});if(receiptError?.code==="23505")return NextResponse.json({message:"Deze duplicatie was al verwerkt.",replayed:true});if(receiptError)throw receiptError;
      const {data:source,error:sourceError}=await supabase.from("shifts").select("department_id,role_id,starts_at,ends_at,break_minutes,hourly_cost_minor").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).single();if(sourceError||!source)throw sourceError??new Error("SHIFT_NOT_FOUND");
      const row=source as unknown as {department_id:string;role_id:string;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string};const {error}=await supabase.from("shifts").insert({...row,organisation_id:input.organisationId,venue_id:values.venueId,staff_id:null,status:"draft",source:"manager",created_by:user.id});if(error)throw error;await jobs.update({status:"succeeded",finished_at:new Date().toISOString()}).eq("idempotency_key",receipt);
      return NextResponse.json({message:"Dienst als open concept gedupliceerd."},{status:201});
    }
    if(input.action==="break_plan"){
      const values=breakPlanSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_BREAK_WINDOW");
      const {data:shift,error:shiftError}=await supabase.from("shifts").select("starts_at,ends_at,break_minutes").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("id",values.shiftId).single();if(shiftError||!shift)throw shiftError??new Error("SHIFT_NOT_FOUND");
      const row=shift as unknown as {starts_at:string;ends_at:string;break_minutes:number};const duration=Math.floor((new Date(endsAt).getTime()-new Date(startsAt).getTime())/60000);
      if(new Date(startsAt)<new Date(row.starts_at)||new Date(endsAt)>new Date(row.ends_at)||duration>row.break_minutes)throw new Error("BREAK_OUTSIDE_SHIFT");
      const plans=supabase.from("shift_break_plans");const {data:existing,error:existingError}=await plans.select("id,revision").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("shift_id",values.shiftId).in("status",["planned","adjusted"]).maybeSingle();if(existingError)throw existingError;
      const existingPlan=existing as unknown as {id:string;revision:number}|null;
      if(existingPlan){const {data,error}=await plans.update({starts_at:startsAt,ends_at:endsAt,status:"adjusted",revision:existingPlan.revision+1,updated_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("id",existingPlan.id).eq("revision",existingPlan.revision).select("id").single();if(error||!data)throw error??new Error("CONCURRENT_BREAK_EDIT");}
      else{const {error}=await plans.insert({organisation_id:input.organisationId,venue_id:values.venueId,shift_id:values.shiftId,starts_at:startsAt,ends_at:endsAt,status:"planned",created_by:user.id});if(error)throw error;}
      return NextResponse.json({message:"Pauzevenster opgeslagen; dekkingscontrole is bijgewerkt."},{status:201});
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
      const phone=values.phone?normalizeDutchPhone(values.phone):null;
      const email=values.email.toLowerCase()||null;
      const duplicateQueries=[
        email?supabase.from("staff_profiles").select("id").eq("organisation_id",input.organisationId).ilike("contact_email",email).limit(1):Promise.resolve({data:[],error:null}),
        phone?supabase.from("staff_profiles").select("id").eq("organisation_id",input.organisationId).eq("contact_phone",phone).limit(1):Promise.resolve({data:[],error:null}),
      ];
      const duplicates=await Promise.all(duplicateQueries);
      const duplicateError=duplicates.find(result=>result.error)?.error;
      if(duplicateError)throw duplicateError;
      if(duplicates.some(result=>result.data?.length))return NextResponse.json({errorCode:"DUPLICATE_STAFF"},{status:409});
      const {data,error}=await supabase.from("staff_profiles").insert({organisation_id:input.organisationId,full_name:values.fullName,contact_email:email,contact_phone:phone,preferred_language:values.preferredLanguage,engagement_type:values.engagementType,role_name:values.roleName,onboarding_status:"invited"}).select("id").single();
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
      const {data,error}=await supabase.rpc("publish_roster_v2" as "publish_roster",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_window_start:iso(values.startsAt),target_window_end:iso(values.endsAt),target_expected_revision:values.expectedRevision,target_idempotency_key:values.idempotencyKey,target_acknowledged_exceptions:[]} as never);
      if(error)throw error;
      return NextResponse.json({message:`Roosterversie ${(data as unknown as {version?:number})?.version??""} onveranderlijk gepubliceerd.`});
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
      const windowStart=iso(values.startsAt),windowEnd=iso(values.endsAt);if(new Date(windowEnd)<=new Date(windowStart))throw new Error("INVALID_WINDOW");
      const [{data:intervals},{data:shifts},{data:roleData},{data:staffData},{data:assignmentData},{data:qualificationData},{data:availabilityData},{data:absenceData}]=await Promise.all([
        supabase.from("demand_forecast_intervals").select("expected_guests,expected_revenue_minor,required_staff,starts_at,ends_at").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).gte("starts_at",windowStart).lt("starts_at",windowEnd).order("starts_at"),
        supabase.from("shifts").select("staff_id,starts_at,ends_at,status,locked").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).lt("starts_at",new Date(new Date(windowEnd).getTime()+11*3600000).toISOString()).gt("ends_at",new Date(new Date(windowStart).getTime()-11*3600000).toISOString()).not("status","in","(cancelled,rejected)"),
        supabase.from("operational_roles").select("id,department_id,hourly_cost_minor,minimum_staff,guests_per_staff").eq("organisation_id",input.organisationId).eq("active",true),
        supabase.from("staff_profiles").select("id,effective_hourly_cost_minor,contracted_minutes_week,maximum_minutes_week,employment_status,onboarding_status").eq("organisation_id",input.organisationId),
        supabase.from("staff_venue_assignments").select("staff_id").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId),
        supabase.from("staff_role_qualifications").select("staff_id,role_id,qualified_until").eq("organisation_id",input.organisationId),
        supabase.from("staff_availability").select("staff_id,starts_at,ends_at,availability").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).lt("starts_at",windowEnd).gt("ends_at",windowStart),
        supabase.from("staff_absences").select("staff_id,starts_at,ends_at,status").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).in("status",["approved","recorded"]).lt("starts_at",windowEnd).gt("ends_at",windowStart),
      ]);
      const intervalRows=(intervals??[]) as unknown as {expected_guests:number;expected_revenue_minor:string;required_staff:number;starts_at:string;ends_at:string}[];
      if(!intervalRows.length)throw new Error("FORECAST_REQUIRED");
      const roleRows=(roleData??[]) as unknown as {id:string;department_id:string;hourly_cost_minor:string;minimum_staff:number;guests_per_staff:number}[];if(!roleRows.length)throw new Error("ROLES_REQUIRED");
      const staffRows=(staffData??[]) as unknown as {id:string;effective_hourly_cost_minor:string|null;contracted_minutes_week:number|null;maximum_minutes_week:number|null;employment_status:string;onboarding_status:string}[];
      const assigned=new Set(((assignmentData??[]) as unknown as {staff_id:string}[]).map(row=>row.staff_id));
      const qualifications=(qualificationData??[]) as unknown as {staff_id:string;role_id:string;qualified_until:string|null}[];
      const availability=(availabilityData??[]) as unknown as {staff_id:string;starts_at:string;ends_at:string;availability:AvailabilityState}[];
      const absences=(absenceData??[]) as unknown as {staff_id:string;starts_at:string;ends_at:string}[];
      const existing=(shifts??[]) as unknown as {staff_id:string|null;starts_at:string;ends_at:string;locked:boolean}[];
      const objectives:RosterObjective[]=["balanced","lowest_cost","preference"];
      const inputSnapshot={window_start:windowStart,window_end:windowEnd,intervals:intervalRows,role_ids:roleRows.map(row=>row.id),staff_ids:staffRows.map(row=>row.id)};
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(inputSnapshot))),inputHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      const proposals=objectives.map(objective=>{
        const shiftPlan:Record<string,unknown>[]=[],plannedMinutes=new Map<string,number>();let unfilled=0,totalRequired=0,totalCost=0n,preferredAssignments=0;
        for(const interval of intervalRows){const intervalStart=new Date(interval.starts_at),intervalEnd=new Date(interval.ends_at),minutes=Math.floor((intervalEnd.getTime()-intervalStart.getTime())/60000),used=new Set<string>();
          for(const role of roleRows){const required=Math.max(role.minimum_staff,Math.ceil(interval.expected_guests/role.guests_per_staff));totalRequired+=required;
            const candidates=staffRows.map(staff=>{const window=availability.find(row=>row.staff_id===staff.id&&new Date(row.starts_at)<=intervalStart&&new Date(row.ends_at)>=intervalEnd),state=window?.availability??"unknown";const qualified=qualifications.some(row=>row.staff_id===staff.id&&row.role_id===role.id&&(!row.qualified_until||row.qualified_until>=interval.starts_at.slice(0,10)));const absent=absences.some(row=>row.staff_id===staff.id&&new Date(row.starts_at)<intervalEnd&&new Date(row.ends_at)>intervalStart);const staffShifts=existing.filter(row=>row.staff_id===staff.id);const occupied=staffShifts.some(row=>new Date(row.starts_at)<intervalEnd&&new Date(row.ends_at)>intervalStart)||used.has(staff.id);const restConflict=staffShifts.some(row=>{const start=new Date(row.starts_at).getTime(),end=new Date(row.ends_at).getTime();return end<=intervalStart.getTime()&&intervalStart.getTime()-end<11*3600000||start>=intervalEnd.getTime()&&start-intervalEnd.getTime()<11*3600000});const projected=(plannedMinutes.get(staff.id)??0)+minutes;const hoursAllowed=staff.maximum_minutes_week===null||projected<=staff.maximum_minutes_week;return{staffId:staff.id,hourlyCostMinor:BigInt(staff.effective_hourly_cost_minor??role.hourly_cost_minor),contractedMinutes:staff.contracted_minutes_week??0,alreadyPlannedMinutes:plannedMinutes.get(staff.id)??0,availability:state,eligible:assigned.has(staff.id)&&staff.onboarding_status!=="suspended"&&staff.employment_status!=="deactivated"&&qualified&&!absent&&!occupied&&!restConflict&&hoursAllowed}});
            const ranked=rankSchedulingCandidates(candidates,objective);
            for(let index=0;index<required;index++){const chosen=ranked[index];if(chosen){used.add(chosen.staffId);plannedMinutes.set(chosen.staffId,(plannedMinutes.get(chosen.staffId)??0)+minutes);totalCost+=(BigInt(minutes)*chosen.hourlyCostMinor+30n)/60n;if(chosen.availability==="preferred")preferredAssignments+=1} else unfilled+=1;shiftPlan.push({department_id:role.department_id,role_id:role.id,staff_id:chosen?.staffId??null,starts_at:interval.starts_at,ends_at:interval.ends_at,break_minutes:0,hourly_cost_minor:String(chosen?.hourlyCostMinor??BigInt(role.hourly_cost_minor))})}
          }
        }
        return{organisation_id:input.organisationId,venue_id:values.venueId,window_start:windowStart,window_end:windowEnd,objective,status:"current",input_hash:inputHash,input_snapshot:inputSnapshot,result_summary:{coverage_basis_points:totalRequired?Math.round((totalRequired-unfilled)*10000/totalRequired):10000,required_assignments:totalRequired,unfilled_assignments:unfilled,total_planned_minutes:[...plannedMinutes.values()].reduce((sum,value)=>sum+value,0),planned_cost_minor:String(totalCost),preferred_assignments:preferredAssignments,missing_evidence:staffRows.length?[]:["employees"]},shift_plan:shiftPlan,created_by:user.id};
      });
      await supabase.from("roster_proposals").update({status:"stale"}).eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("status","current");
      const {data:created,error}=await supabase.from("roster_proposals").insert(proposals).select("id,objective,result_summary");if(error)throw error;
      return NextResponse.json({message:"Drie geldige, uitlegbare roosteropties opgeslagen. Kies een optie om conceptdiensten te maken.",proposals:created},{status:201});
    }
    if(input.action==="proposal_apply"){
      const values=proposalApplySchema.parse(input.values);const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("apply_roster_proposal" as "clock_out",{target_organisation_id:input.organisationId,target_proposal_id:values.proposalId} as never);if(error)throw error;
      return NextResponse.json({message:`Roosteroptie toegepast als bewerkbaar concept (${(data as unknown as {created?:number})?.created??0} diensten).`});
    }
    if(input.action==="scenario"){
      const values=scenarioSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);const windowStart=iso(values.startsAt),windowEnd=iso(values.endsAt);
      const [{data:intervalData,error:intervalError},{data:shiftData,error:shiftError}]=await Promise.all([
        supabase.from("demand_forecast_intervals").select("id,starts_at,ends_at,required_staff,expected_revenue_minor").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).gte("starts_at",windowStart).lt("starts_at",windowEnd),
        supabase.from("shifts").select("id,starts_at,ends_at,staff_id,hourly_cost_minor,break_minutes").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).lt("starts_at",windowEnd).gt("ends_at",windowStart).not("status","in","(cancelled,rejected)"),
      ]);if(intervalError||shiftError)throw intervalError??shiftError;
      const coverage=calculateCoverage(((intervalData??[]) as unknown as {id:string;starts_at:string;ends_at:string;required_staff:number;expected_revenue_minor:string}[]).map(row=>({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",requiredStaff:row.required_staff,expectedRevenueMinor:BigInt(row.expected_revenue_minor)})),((shiftData??[]) as unknown as {id:string;starts_at:string;ends_at:string;staff_id:string|null;hourly_cost_minor:string;break_minutes:number}[]).map(row=>({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",staffId:row.staff_id,hourlyCostMinor:BigInt(row.hourly_cost_minor),breakMinutes:row.break_minutes})));
      const result=simulateDemand(coverage,values.demandChangeBasisPoints).map(row=>({...row,expectedRevenueMinor:String(row.expectedRevenueMinor)}));
      const {data,error}=await supabase.from("workforce_scenarios" as "shifts").insert({organisation_id:input.organisationId,venue_id:values.venueId,window_start:windowStart,window_end:windowEnd,scenario_type:"demand_change",inputs:{demand_change_basis_points:values.demandChangeBasisPoints},result,status:"draft",idempotency_key:values.idempotencyKey,created_by:user.id} as never).select("id").single();if(error)throw error;
      return NextResponse.json({message:"What-if-scenario als niet-toegepast concept opgeslagen.",scenarioId:data.id,result},{status:201});
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
