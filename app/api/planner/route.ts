import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../lib/supabase/admin";
import {normalizeDutchPhone} from "../../../lib/workforce/domain";
import {createStaffOnboardingToken,hashStaffOnboardingToken,onboardingMessage} from "../../../lib/workforce/onboarding";
import {sendTemplate} from "../../../lib/whatsapp/cloud";
import {loadWhatsapp} from "../../../lib/whatsapp/store";
import {addDays,firstName,zonedInstant} from "../../../lib/planning/nights";

const base={organisationId:z.string().uuid(),venueId:z.string().uuid()};
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("assign"),...base,changes:z.array(z.object({shiftId:z.string().uuid(),staffId:z.string().uuid().nullable()})).min(1).max(300)}),
  z.object({action:z.literal("add_slot"),...base,roleId:z.string().uuid(),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})}),
  z.object({action:z.literal("remove_slots"),...base,shiftIds:z.array(z.string().uuid()).min(1).max(300)}),
  z.object({action:z.literal("publish"),...base,weekStart:z.iso.date()}),
  z.object({action:z.literal("invite"),...base,staffId:z.string().uuid()}),
]);

const failure=(code:string,status=409)=>NextResponse.json({errorCode:code},{status});
const dbCode=(error:unknown)=>{
  const message=String((error as {message?:string})?.message??"");
  for(const code of ["shift_overlap","staff_not_in_team","shift_locked","shift_not_editable","shift_not_open","shift_not_found","already_active","staff_unavailable","forbidden","no_draft_shifts","overlapping_shifts","absence_conflict","concurrent_roster_edit"])if(message.includes(code))return code.toUpperCase();
  return "";
};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const capability=input.action==="invite"?"members.manage":"planning.manage";
    const {supabase}=await requireMembership(input.organisationId,capability,input.venueId);
    const rpc=(name:string,args:Record<string,unknown>)=>supabase.rpc(name as "clock_out",args as never) as unknown as Promise<{data:unknown;error:{message?:string}|null}>;

    if(input.action==="assign"){
      const {data,error}=await rpc("plan_assign_shifts",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_changes:input.changes.map(change=>({shift_id:change.shiftId,staff_id:change.staffId}))});
      if(error)return failure(dbCode(error)||"ASSIGN_FAILED");
      return NextResponse.json({changed:(data as {changed?:number})?.changed??0});
    }
    if(input.action==="add_slot"){
      const {data,error}=await rpc("plan_add_open_shift",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_role_id:input.roleId,target_starts_at:input.startsAt,target_ends_at:input.endsAt});
      if(error)return failure(dbCode(error)||"ADD_SLOT_FAILED");
      return NextResponse.json({shiftId:data},{status:201});
    }
    if(input.action==="remove_slots"){
      const {error}=await rpc("plan_remove_open_shifts",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_shift_ids:input.shiftIds});
      if(error)return failure(dbCode(error)||"REMOVE_FAILED");
      return NextResponse.json({removed:input.shiftIds.length});
    }
    if(input.action==="publish"){
      const {data:venue}=await supabase.from("venues").select("timezone").eq("organisation_id",input.organisationId).eq("id",input.venueId).single();
      const timezone=String((venue as {timezone?:string}|null)?.timezone||"Europe/Amsterdam");
      const windowStart=zonedInstant(input.weekStart,"12:00",timezone),windowEnd=zonedInstant(addDays(input.weekStart,7),"12:00",timezone);
      const {data:drafts,error:draftError}=await supabase.from("shifts").select("revision").eq("organisation_id",input.organisationId).eq("venue_id",input.venueId).eq("status","draft").gte("starts_at",windowStart).lt("starts_at",windowEnd).order("revision",{ascending:false}).limit(1);
      if(draftError)throw draftError;
      if(!drafts?.length)return NextResponse.json({published:false,message:"Er staan geen wijzigingen klaar."});
      const {data,error}=await rpc("publish_roster_v2",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_window_start:windowStart,target_window_end:windowEnd,target_expected_revision:(drafts[0] as {revision:number}).revision,target_idempotency_key:crypto.randomUUID(),target_acknowledged_exceptions:[]});
      if(error)return failure(dbCode(error)||"PUBLISH_FAILED");
      return NextResponse.json({published:true,version:(data as {version?:number})?.version??null,weekStart:windowStart});
    }

    // invite: a fresh personal link; older links stop working.
    const {data:person}=await supabase.from("staff_profiles").select("id,full_name,contact_phone,preferred_language,auth_user_id").eq("organisation_id",input.organisationId).eq("id",input.staffId).single();
    const staff=person as unknown as {id:string;full_name:string;contact_phone:string|null;preferred_language:string;auth_user_id:string|null}|null;
    if(!staff)return failure("STAFF_NOT_FOUND",404);
    if(staff.auth_user_id)return failure("ALREADY_ACTIVE");
    const token=createStaffOnboardingToken(),link=`${new URL(request.url).origin}/employee-onboarding/${token}`;
    const {error}=await rpc("reissue_staff_invitation",{target_organisation_id:input.organisationId,target_staff_id:staff.id,target_token_hash:hashStaffOnboardingToken(token),target_expires_at:new Date(Date.now()+14*86400000).toISOString()});
    if(error)return failure(dbCode(error)||"INVITE_FAILED");
    const {data:venueRow}=await supabase.from("venues").select("name").eq("organisation_id",input.organisationId).eq("id",input.venueId).single();
    const venueName=String((venueRow as {name?:string}|null)?.name??"Cliniq");
    const language=staff.preferred_language==="en"?"en":"nl";
    const message=onboardingMessage(language,firstName(staff.full_name),venueName,link);
    let phone:string|null=null;try{phone=staff.contact_phone?normalizeDutchPhone(staff.contact_phone):null}catch{phone=null}
    const whatsappUrl=phone?`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`:"";
    const config=await loadWhatsapp(input.organisationId);
    if(!config||!phone)return NextResponse.json({link,message,whatsappUrl,delivery:{state:"manual",detail:phone?"":"Geen telefoonnummer."}});
    const result=await sendTemplate(config,phone,"invite",[firstName(staff.full_name),venueName,link]);
    try{await createSupabaseAdminClient().from("notification_outbox").insert({organisation_id:input.organisationId,venue_id:input.venueId,channel:"whatsapp",destination_e164:phone,correlation_type:"staff_invitation",correlation_id:staff.id,payload:{template:config.templates.invite},state:result.ok?"sent":"failed",provider_message_id:result.ok?result.messageId:null,failure_reason:result.ok?null:result.detail})}catch{/* delivery result is still returned */}
    return NextResponse.json({link,message,whatsappUrl,delivery:{state:result.ok?"sent":"failed",detail:result.ok?"Uitnodiging verstuurd via WhatsApp.":result.detail}});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return failure("UNAUTHENTICATED",401);
    if(error instanceof Error&&error.message==="FORBIDDEN")return failure("FORBIDDEN",403);
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"PLANNER_ACTION_FAILED"},{status:400});
  }
}
