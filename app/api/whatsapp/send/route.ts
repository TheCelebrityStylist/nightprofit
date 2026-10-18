import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {normalizeDutchPhone} from "../../../../lib/workforce/domain";
import {sendTemplate} from "../../../../lib/whatsapp/cloud";
import {loadWhatsapp} from "../../../../lib/whatsapp/store";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("roster"),organisationId:z.string().uuid(),venueId:z.string().uuid(),weekStart:z.iso.datetime({offset:true}),staffIds:z.array(z.string().uuid()).max(250).optional(),resend:z.boolean().default(false)}),
  z.object({action:z.literal("invite"),organisationId:z.string().uuid(),venueId:z.string().uuid(),staffId:z.string().uuid(),link:z.string().url()}),
]);

type Delivery={staffId:string;name:string;state:"sent"|"skipped"|"failed";detail:string};
const dayMs=86400000;

async function digest(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,24);
}
const isoWeek=(value:Date)=>{const date=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate()));date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));return Math.ceil(((date.getTime()-Date.UTC(date.getUTCFullYear(),0,1))/dayMs+1)/7)};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const config=await loadWhatsapp(input.organisationId);
    if(!config)return NextResponse.json({errorCode:"WHATSAPP_NOT_CONFIGURED"},{status:409});
    const capability=input.action==="invite"?"members.manage":"planning.manage";
    const {supabase}=await requireMembership(input.organisationId,capability,input.venueId);
    const admin=(()=>{try{return createSupabaseAdminClient()}catch{return null}})();
    const {data:venue}=await supabase.from("venues").select("name,timezone").eq("organisation_id",input.organisationId).eq("id",input.venueId).single();
    const venueName=String((venue as {name?:string}|null)?.name??"");
    const timezone=String((venue as {timezone?:string}|null)?.timezone||"Europe/Amsterdam");
    const record=async(row:Record<string,unknown>)=>{if(admin)await admin.from("notification_outbox").insert({organisation_id:input.organisationId,venue_id:input.venueId,channel:"whatsapp",...row});};

    if(input.action==="invite"){
      if(!new URL(input.link).pathname.startsWith("/employee-onboarding/"))return NextResponse.json({errorCode:"INVALID_LINK"},{status:400});
      const {data:person}=await supabase.from("staff_profiles").select("id,full_name,contact_phone").eq("organisation_id",input.organisationId).eq("id",input.staffId).single();
      const staff=person as unknown as {id:string;full_name:string;contact_phone:string|null}|null;
      if(!staff?.contact_phone)return NextResponse.json({errorCode:"NO_PHONE"},{status:409});
      const phone=normalizeDutchPhone(staff.contact_phone);
      const result=await sendTemplate(config,phone,"invite",[staff.full_name.split(/\s+/)[0],venueName,input.link]);
      await record({destination_e164:phone,correlation_type:"staff_invitation",correlation_id:staff.id,payload:{template:config.templates.invite},state:result.ok?"sent":"failed",provider_message_id:result.ok?result.messageId:null,failure_reason:result.ok?null:result.detail});
      return NextResponse.json({delivery:{staffId:staff.id,name:staff.full_name,state:result.ok?"sent":"failed",detail:result.ok?"Uitnodiging verstuurd.":result.detail}},{status:result.ok?200:502});
    }

    const weekStart=new Date(input.weekStart),weekEnd=new Date(weekStart.getTime()+7*dayMs),week=String(isoWeek(new Date(weekStart.getTime()+3*dayMs)));
    let shiftQuery=supabase.from("shifts").select("staff_id,starts_at,ends_at,break_minutes,role_id").eq("organisation_id",input.organisationId).eq("venue_id",input.venueId).eq("status","published").not("staff_id","is",null).gte("starts_at",weekStart.toISOString()).lt("starts_at",weekEnd.toISOString()).order("starts_at");
    if(input.staffIds?.length)shiftQuery=shiftQuery.in("staff_id",input.staffIds);
    const [{data:shiftData,error:shiftError},{data:roleData}]=await Promise.all([shiftQuery,supabase.from("operational_roles").select("id,name").eq("organisation_id",input.organisationId)]);
    if(shiftError)throw shiftError;
    const shifts=(shiftData??[]) as unknown as {staff_id:string;starts_at:string;ends_at:string;break_minutes:number;role_id:string}[];
    const roleName=new Map(((roleData??[]) as unknown as {id:string;name:string}[]).map(role=>[role.id,role.name]));
    const staffIds=[...new Set(shifts.map(shift=>shift.staff_id))];
    if(!staffIds.length)return NextResponse.json({deliveries:[],message:"Er zijn deze week geen gepubliceerde diensten met een medewerker."});
    const [{data:peopleData},{data:sentData}]=await Promise.all([
      supabase.from("staff_profiles").select("id,full_name,contact_phone,preferred_language").eq("organisation_id",input.organisationId).in("id",staffIds),
      admin?admin.from("notification_outbox").select("correlation_id,payload,state").eq("organisation_id",input.organisationId).eq("correlation_type","roster_week").in("correlation_id",staffIds).in("state",["sending","sent","delivered","read"]):Promise.resolve({data:[]}),
    ]);
    const people=(peopleData??[]) as unknown as {id:string;full_name:string;contact_phone:string|null}[];
    const alreadySent=new Set(((sentData??[]) as unknown as {correlation_id:string;payload:{content_hash?:string}}[]).map(row=>`${row.correlation_id}:${row.payload?.content_hash??""}`));
    const time=(value:string)=>new Date(value).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",timeZone:timezone});
    const day=(value:string)=>new Date(value).toLocaleDateString("nl-NL",{weekday:"short",day:"numeric",month:"short",timeZone:timezone});
    const deliveries:Delivery[]=[];
    for(const person of people){
      const own=shifts.filter(shift=>shift.staff_id===person.id);
      const summary=own.map(shift=>`${day(shift.starts_at)} ${time(shift.starts_at)}-${time(shift.ends_at)}${roleName.get(shift.role_id)?` (${roleName.get(shift.role_id)})`:""}`).join(" · ");
      const minutes=own.reduce((sum,shift)=>sum+Math.max(0,(new Date(shift.ends_at).getTime()-new Date(shift.starts_at).getTime())/60000-shift.break_minutes),0);
      const contentHash=await digest(`${week}|${summary}`);
      if(!person.contact_phone){deliveries.push({staffId:person.id,name:person.full_name,state:"failed",detail:"Geen telefoonnummer."});continue;}
      let phone:string;
      try{phone=normalizeDutchPhone(person.contact_phone)}catch{deliveries.push({staffId:person.id,name:person.full_name,state:"failed",detail:"Telefoonnummer is ongeldig."});continue;}
      if(!input.resend&&alreadySent.has(`${person.id}:${contentHash}`)){deliveries.push({staffId:person.id,name:person.full_name,state:"skipped",detail:"Dit rooster is al verstuurd."});continue;}
      const result=await sendTemplate(config,phone,"roster",[person.full_name.trim().split(/\s+/)[0],venueName,week,summary,String(Math.round(minutes/6)/10).replace(".",",")]);
      await record({destination_e164:phone,correlation_type:"roster_week",correlation_id:person.id,payload:{template:config.templates.roster,week,week_start:weekStart.toISOString(),content_hash:contentHash},state:result.ok?"sent":"failed",provider_message_id:result.ok?result.messageId:null,failure_reason:result.ok?null:result.detail});
      deliveries.push({staffId:person.id,name:person.full_name,state:result.ok?"sent":"failed",detail:result.ok?"Verstuurd.":result.detail});
    }
    const sent=deliveries.filter(row=>row.state==="sent").length;
    return NextResponse.json({deliveries,message:`${sent} van ${deliveries.length} roosters verstuurd via WhatsApp.`});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
    if(error instanceof Error&&error.message==="FORBIDDEN")return NextResponse.json({errorCode:"FORBIDDEN"},{status:403});
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"WHATSAPP_SEND_FAILED"},{status:400});
  }
}
