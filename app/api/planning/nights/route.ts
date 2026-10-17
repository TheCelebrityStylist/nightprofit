import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {parseEuroRate,serviceLinesSchema} from "../../../../lib/workforce/service-nights";

const envelope=z.object({
  organisationId:z.string().uuid(),
  action:z.enum(["pattern_save","night_plan","week_apply","role_rate","planner_access","dj_setup"]),
  values:z.record(z.string(),z.string()),
});
const patternSchema=z.object({venueId:z.string().uuid(),isoWeekday:z.coerce.number().int().min(1).max(7),active:z.enum(["true","false"]),lines:z.string().transform(value=>serviceLinesSchema.parse(JSON.parse(value)))});
const nightSchema=z.object({venueId:z.string().uuid(),serviceDate:z.iso.date(),lines:z.string().optional().transform(value=>value?serviceLinesSchema.min(1).parse(JSON.parse(value)):null)});
const weekSchema=z.object({venueId:z.string().uuid(),weekStart:z.iso.date()});
const rateSchema=z.object({venueId:z.string().uuid(),roleId:z.string().uuid(),hourlyCost:z.string().trim().min(1).max(12)});
const plannerSchema=z.object({staffId:z.string().uuid(),enabled:z.enum(["true","false"])});
const djSetupSchema=z.object({venueId:z.string().uuid(),hourlyCost:z.string().trim().min(1).max(12).default("0")});

const failure=(code:string,status=400)=>NextResponse.json({errorCode:code},{status});
const dbCode=(error:unknown)=>error&&typeof error==="object"&&"message" in error?String((error as {message:unknown}).message):"";
const knownErrors:Record<string,string>={
  no_standard_night:"NO_STANDARD_NIGHT",no_standard_week:"NO_STANDARD_WEEK",invalid_service_role:"INVALID_SERVICE_ROLE",
  invalid_service_time:"INVALID_SERVICE_TIME",service_lines_required:"SERVICE_LINES_REQUIRED",staff_has_no_account:"STAFF_HAS_NO_ACCOUNT",
  cannot_change_own_access:"CANNOT_CHANGE_OWN_ACCESS",forbidden:"FORBIDDEN",
};
const mapDbError=(error:unknown)=>{const message=dbCode(error);const key=Object.keys(knownErrors).find(code=>message.includes(code));return key?knownErrors[key]:null};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=envelope.parse(await request.json());
    if(input.action==="pattern_save"){
      const values=patternSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {error}=await supabase.rpc("save_service_pattern" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_iso_weekday:values.isoWeekday,target_active:values.active==="true",target_lines:values.lines} as never);
      if(error)throw error;
      return NextResponse.json({message:values.active==="true"?"Standaardavond opgeslagen.":"Dag staat nu dicht in de standaardweek."});
    }
    if(input.action==="night_plan"){
      const values=nightSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("plan_service_night" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_service_date:values.serviceDate,target_lines:values.lines} as never);
      if(error)throw error;
      const result=data as unknown as {created:number;already_present:number};
      return NextResponse.json({message:result.created?`${result.created} open dienst(en) aangemaakt.`:"Deze avond stond al volledig klaar.",created:result.created},{status:201});
    }
    if(input.action==="week_apply"){
      const values=weekSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {data,error}=await supabase.rpc("apply_standard_week" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_week_start:values.weekStart} as never);
      if(error)throw error;
      const result=data as unknown as {created:number;nights:unknown[]};
      return NextResponse.json({message:result.created?`Standaardweek ingevuld: ${result.created} open dienst(en) over ${result.nights.length} avond(en).`:"De standaardweek stond al volledig klaar.",created:result.created},{status:201});
    }
    if(input.action==="role_rate"){
      const values=rateSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const minor=parseEuroRate(values.hourlyCost);
      if(minor===null)return failure("INVALID_RATE");
      const {data,error}=await supabase.from("operational_roles").update({hourly_cost_minor:Number(minor)} as never).eq("organisation_id",input.organisationId).eq("id",values.roleId).select("id").single();
      if(error||!data)throw error??new Error("ROLE_NOT_FOUND");
      const {error:shiftError}=await supabase.from("shifts").update({hourly_cost_minor:Number(minor)} as never).eq("organisation_id",input.organisationId).eq("role_id",values.roleId).eq("status","draft").is("staff_id",null);
      if(shiftError)throw shiftError;
      return NextResponse.json({message:"Uurtarief opgeslagen. Open conceptdiensten zijn bijgewerkt."});
    }
    if(input.action==="planner_access"){
      const values=plannerSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"members.manage");
      const {error}=await supabase.rpc("set_staff_planner" as "clock_out",{target_organisation_id:input.organisationId,target_staff_id:values.staffId,target_enabled:values.enabled==="true"} as never);
      if(error)throw error;
      return NextResponse.json({message:values.enabled==="true"?"Planner kan nu roosters maken, beschikbaarheid opvragen en publiceren.":"Plannerrechten ingetrokken."});
    }
    const values=djSetupSchema.parse(input.values);
    const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
    const minor=parseEuroRate(values.hourlyCost);
    if(minor===null)return failure("INVALID_RATE");
    const departments=supabase.from("departments") as unknown as {
      select:(columns:string)=>{eq:(column:string,value:string)=>{eq:(column:string,value:string)=>{eq:(column:string,value:string)=>{maybeSingle:()=>Promise<{data:{id:string}|null;error:unknown}>}}}};
      insert:(row:Record<string,unknown>)=>{select:(columns:string)=>{single:()=>Promise<{data:{id:string}|null;error:unknown}>}};
    };
    const lookup=await departments.select("id").eq("organisation_id",input.organisationId).eq("venue_id",values.venueId).eq("kind","dj").maybeSingle();
    if(lookup.error)throw lookup.error;
    let department=lookup.data;
    if(!department){
      const created=await departments.insert({organisation_id:input.organisationId,venue_id:values.venueId,name:"DJ",kind:"dj"}).select("id").single();
      if(created.error||!created.data)throw created.error??new Error("DJ_DEPARTMENT_FAILED");
      department=created.data;
    }
    const {data:existingRole,error:roleLookupError}=await supabase.from("operational_roles").select("id").eq("organisation_id",input.organisationId).eq("department_id",department.id).limit(1);
    if(roleLookupError)throw roleLookupError;
    if(!existingRole?.length){
      const {error}=await supabase.from("operational_roles").insert({organisation_id:input.organisationId,department_id:department.id,name:"DJ",hourly_cost_minor:Number(minor),minimum_staff:1,guests_per_staff:1000} as never);
      if(error)throw error;
    }
    return NextResponse.json({message:"DJ-planning staat klaar."},{status:201});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return failure("UNAUTHENTICATED",401);
    if(error instanceof Error&&error.message==="FORBIDDEN")return failure("FORBIDDEN",403);
    const mapped=mapDbError(error);
    if(mapped)return failure(mapped,mapped==="FORBIDDEN"?403:409);
    return securityErrorResponse(error)??failure(error instanceof z.ZodError?"VALIDATION_FAILED":"SERVICE_NIGHT_FAILED");
  }
}
