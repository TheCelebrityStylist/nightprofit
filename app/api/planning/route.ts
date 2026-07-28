import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {decimalToMinor} from "../../../lib/imports/locale-number";
import {requiredStaff} from "../../../lib/operations/planning";

const envelope=z.object({
  organisationId:z.string().uuid(),
  action:z.enum(["department","role","forecast","shift","publish","availability","proposal","resolve_action"]),
  values:z.record(z.string(),z.string()),
});
const departmentSchema=z.object({venueId:z.string().uuid(),name:z.string().trim().min(2).max(100)});
const roleSchema=z.object({departmentId:z.string().uuid(),name:z.string().trim().min(2).max(100),hourlyCost:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000)});
const forecastSchema=z.object({venueId:z.string().uuid(),tradingDate:z.iso.date(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),expectedGuests:z.coerce.number().int().min(0).max(100000),expectedRevenue:z.string(),minimumStaff:z.coerce.number().int().min(0).max(100),guestsPerStaff:z.coerce.number().int().positive().max(1000),managerNote:z.string().trim().max(1000).default("")});
const shiftSchema=z.object({venueId:z.string().uuid(),departmentId:z.string().uuid(),roleId:z.string().uuid(),staffId:z.union([z.string().uuid(),z.literal("open")]),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),breakMinutes:z.coerce.number().int().min(0).max(480),hourlyCost:z.string()});
const publishSchema=z.object({venueId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true})});
const availabilitySchema=z.object({venueId:z.string().uuid(),staffId:z.string().uuid(),startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),availability:z.enum(["available","preferred","unavailable"]),note:z.string().trim().max(500).default("")});
const proposalSchema=z.object({venueId:z.string().uuid(),tradingDate:z.iso.date()});
const resolveSchema=z.object({actionId:z.string().uuid(),resolution:z.string().trim().min(5).max(2000)});
const iso=(value:string)=>new Date(value).toISOString();

export async function POST(request:Request){
  try{
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
      const {error}=await supabase.from("operational_roles").insert({organisation_id:input.organisationId,department_id:values.departmentId,name:values.name,hourly_cost_minor:decimalToMinor(values.hourlyCost,"nl-NL").toString(),minimum_staff:values.minimumStaff,guests_per_staff:values.guestsPerStaff});
      if(error)throw error;
      return NextResponse.json({message:"Operationele rol toegevoegd."},{status:201});
    }
    if(input.action==="forecast"){
      const values=forecastSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const startsAt=iso(values.startsAt),endsAt=iso(values.endsAt);
      if(new Date(endsAt)<=new Date(startsAt))throw new Error("INVALID_WINDOW");
      const interval=[{starts_at:startsAt,ends_at:endsAt,expected_guests:values.expectedGuests,expected_revenue_minor:decimalToMinor(values.expectedRevenue,"nl-NL").toString(),required_staff:requiredStaff(values.expectedGuests,values.minimumStaff,values.guestsPerStaff)}];
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
        if(overlaps?.length)return NextResponse.json({error:"Deze medewerker heeft een overlappende dienst."},{status:409});
      }
      const {error}=await supabase.from("shifts").insert({organisation_id:input.organisationId,venue_id:values.venueId,department_id:values.departmentId,role_id:values.roleId,staff_id:values.staffId==="open"?null:values.staffId,starts_at:startsAt,ends_at:endsAt,break_minutes:values.breakMinutes,hourly_cost_minor:decimalToMinor(values.hourlyCost,"nl-NL").toString(),status:"draft",source:"manager",created_by:user.id});
      if(error)throw error;
      return NextResponse.json({message:"Conceptdienst toegevoegd; publicatie vereist."},{status:201});
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
    const message=error instanceof z.ZodError?"Controleer alle verplichte velden en bedragen.":"De bewerking kon niet veilig worden uitgevoerd.";
    return NextResponse.json({error:message},{status:400});
  }
}
