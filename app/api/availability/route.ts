import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {createAvailabilityToken,hashAvailabilityToken} from "../../../lib/workforce/availability";
import {normalizeDutchPhone} from "../../../lib/workforce/domain";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../lib/supabase/admin";
import {sendTemplate} from "../../../lib/whatsapp/cloud";
import {loadWhatsapp} from "../../../lib/whatsapp/store";
import {pushToStaff} from "../../../lib/push/push";
import type {SupabaseClient} from "@supabase/supabase-js";
import {addDays,deadlineLabel,firstName,nightsLabel,zonedInstant} from "../../../lib/planning/nights";

const schema=z.object({
  organisationId:z.string().uuid(),venueId:z.string().uuid(),
  startsAt:z.iso.datetime({local:true}).optional(),endsAt:z.iso.datetime({local:true}).optional(),deadlineAt:z.iso.datetime({local:true,offset:true}),
  dates:z.array(z.iso.date()).min(1).max(31).optional(),
  staffIds:z.array(z.string().uuid()).min(1).max(250),idempotencyKey:z.string().uuid(),
  deliver:z.enum(["manual","whatsapp"]).default("manual"),
});

const updateSchema=z.object({
  organisationId:z.string().uuid(),venueId:z.string().uuid(),
  action:z.enum(["manual_share","cancel","extend","remind"]),
  requestId:z.string().uuid(),recipientIds:z.array(z.string().uuid()).max(250).default([]),
  deadlineAt:z.iso.datetime({local:true}).optional(),idempotencyKey:z.string().uuid(),
});

const availabilityMessage=(language:string,name:string,nights:string,deadline:string,url:string)=>language==="en"
  ?`Hi ${name}! Can you work ${nights}? Let us know before ${deadline}, it takes ten seconds: ${url}`
  :`Hoi ${name}! Kun je ${nights}? Laat het weten vóór ${deadline}, kost je tien seconden: ${url}`;

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const origin=new URL(request.url).origin;
    if(!input.dates&&(!input.startsAt||!input.endsAt))throw new Error("DATES_REQUIRED");
    const {data:venueRow}=await supabase.from("venues").select("timezone").eq("organisation_id",input.organisationId).eq("id",input.venueId).single();
    const timezone=String((venueRow as {timezone?:string}|null)?.timezone||"Europe/Amsterdam");
    const dates=input.dates?[...new Set(input.dates)].sort():null;
    const periodStart=dates?zonedInstant(dates[0],"18:00",timezone):new Date(input.startsAt!).toISOString();
    const periodEnd=dates?zonedInstant(addDays(dates.at(-1)!,1),"05:00",timezone):new Date(input.endsAt!).toISOString();
    const nightsText=(language:string)=>dates?nightsLabel(dates,language==="en"?"en":"nl"):`${new Date(periodStart).toLocaleDateString("nl-NL",{day:"numeric",month:"short",timeZone:timezone})} t/m ${new Date(periodEnd).toLocaleDateString("nl-NL",{day:"numeric",month:"short",timeZone:timezone})}`;
    const {data:staff,error:staffError}=await supabase.from("staff_profiles").select("id,full_name,preferred_language,contact_phone,onboarding_status").eq("organisation_id",input.organisationId).in("id",input.staffIds);
    if(staffError||staff?.length!==input.staffIds.length)throw new Error("RECIPIENTS_INVALID");
    const links=new Map<string,string>();
    const shares:Record<string,{message:string;whatsappUrl:string|null;phoneState:"valid"|"missing"|"invalid"}>={};
    const recipients=(staff as unknown as {id:string;full_name:string;preferred_language:string;contact_phone:string|null;onboarding_status:string}[]).map(person=>{
      if(person.onboarding_status==="suspended")throw new Error("RECIPIENTS_INVALID");
      const token=createAvailabilityToken();
      const responseUrl=`${origin}/availability/${token}`;
      links.set(person.id,responseUrl);
      let phone:string|null=null,phoneState:"valid"|"missing"|"invalid"=person.contact_phone?"invalid":"missing";
      if(person.contact_phone){try{phone=normalizeDutchPhone(person.contact_phone);phoneState="valid"}catch{/* explicitly reported below */}}
      const message=availabilityMessage(person.preferred_language,firstName(person.full_name),nightsText(person.preferred_language),deadlineLabel(new Date(input.deadlineAt).toISOString(),timezone,person.preferred_language==="en"?"en":"nl"),responseUrl);
      shares[person.id]={message,phoneState,whatsappUrl:phone?`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`:null};
      return {staff_id:person.id,token_hash:hashAvailabilityToken(token),response_url:responseUrl,language:person.preferred_language,phone_state:phoneState,destination_e164:phone};
    });
    const {data,error}=dates
      ?await supabase.rpc("create_availability_request_v4" as "create_availability_request",{
        target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_dates:dates,
        target_deadline_at:new Date(input.deadlineAt).toISOString(),recipient_inputs:recipients,target_idempotency_key:input.idempotencyKey,
      } as never)
      :await supabase.rpc("create_availability_request_v3" as "create_availability_request",{
        target_organisation_id:input.organisationId,target_venue_id:input.venueId,
        target_starts_at:periodStart,target_ends_at:periodEnd,
        target_deadline_at:new Date(input.deadlineAt).toISOString(),recipient_inputs:recipients,target_idempotency_key:input.idempotencyKey,
      } as never);
    if(error)throw error;
    const command=data as unknown as {request_id:string;replayed:boolean};
    if(command.replayed)return NextResponse.json({message:"Dit beschikbaarheidsverzoek was al voorbereid.",requestId:command.request_id,replayed:true,links:{},shares:{},recipientIdsByStaff:{}});
    const {data:createdRecipients,error:createdRecipientsError}=await supabase.from("availability_request_recipients").select("id,staff_id").eq("organisation_id",input.organisationId).eq("request_id",command.request_id);if(createdRecipientsError)throw createdRecipientsError;
    const recipientIdsByStaff=Object.fromEntries((createdRecipients??[]).map(row=>[row.staff_id,row.id]));
    // Phone notification for everyone who allowed it, whatever the WhatsApp setup.
    const pushed=await (async()=>{try{
      const people=staff as unknown as {id:string;preferred_language:string}[];
      const deadlineText=deadlineLabel(new Date(input.deadlineAt).toISOString(),timezone);
      return await pushToStaff(createSupabaseAdminClient() as unknown as SupabaseClient,input.organisationId,input.staffIds,(staffId)=>{const language=people.find(row=>row.id===staffId)?.preferred_language??"nl";return {title:language==="en"?"Can you work?":"Kun je werken?",body:language==="en"?`Can you work ${nightsText(language)}? Let us know before ${deadlineText}.`:`Kun je ${nightsText(language)}? Laat het weten vóór ${deadlineText}.`,url:links.get(staffId)??"/app/my-work",tag:`availability-${command.request_id}`};},origin);
    }catch{return new Set<string>()}})();
    const config=input.deliver==="whatsapp"?await loadWhatsapp(input.organisationId):null;
    if(input.deliver==="whatsapp"&&!config)return NextResponse.json({message:"Links voorbereid. WhatsApp is nog niet gekoppeld, deel ze handmatig.",requestId:command.request_id,links:Object.fromEntries(links),shares,recipientIdsByStaff,deliveries:{}},{status:201});
    const deliveries:Record<string,{state:"sent"|"failed";detail:string}>={};
    if(config){
      const admin=(()=>{try{return createSupabaseAdminClient()}catch{return null}})();
      const people=staff as unknown as {id:string;full_name:string;preferred_language:string;contact_phone:string|null}[];
      const deadline=deadlineLabel(new Date(input.deadlineAt).toISOString(),timezone);
      for(const recipient of recipients){
        const person=people.find(row=>row.id===recipient.staff_id);
        const url=links.get(recipient.staff_id);
        if(!person||!url)continue;
        if(!recipient.destination_e164){deliveries[recipient.staff_id]={state:"failed",detail:recipient.phone_state==="missing"?"Geen telefoonnummer.":"Telefoonnummer is ongeldig."};continue;}
        const result=await sendTemplate(config,recipient.destination_e164,"availability",[firstName(person.full_name),nightsText(person.preferred_language),deadline,url]);
        deliveries[recipient.staff_id]={state:result.ok?"sent":"failed",detail:result.ok?"Verstuurd via WhatsApp.":result.detail};
        if(admin&&recipientIdsByStaff[recipient.staff_id])await admin.from("notification_outbox").insert({organisation_id:input.organisationId,venue_id:input.venueId,channel:"whatsapp",destination_e164:recipient.destination_e164,correlation_type:"availability_recipient",correlation_id:recipientIdsByStaff[recipient.staff_id],payload:{template:config.templates.availability,request_id:command.request_id},state:result.ok?"sent":"failed",provider_message_id:result.ok?result.messageId:null,failure_reason:result.ok?null:result.detail});
      }
    }
    const sentCount=Object.values(deliveries).filter(row=>row.state==="sent").length;
    return NextResponse.json({message:config?`${sentCount} van ${recipients.length} verzoeken verstuurd via WhatsApp.`:`Beschikbaarheid voorbereid voor ${recipients.length} medewerker(s).${pushed.size?` ${pushed.size} kregen een melding op hun telefoon.`:" Er is niets extern verstuurd."}`,requestId:command.request_id,links:Object.fromEntries(links),shares,recipientIdsByStaff,deliveries,pushed:[...pushed]},{status:201});
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"AVAILABILITY_REQUEST_FAILED"},{status:400});
  }
}

export async function PATCH(request:Request){
  try{
    assertSameOrigin(request);
    const input=updateSchema.parse(await request.json());
    const {supabase,user}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const {data:period,error:periodError}=await supabase.from("availability_request_periods").select("id,status,deadline_at").eq("organisation_id",input.organisationId).eq("venue_id",input.venueId).eq("id",input.requestId).single();
    if(periodError||!period)throw periodError??new Error("REQUEST_NOT_FOUND");
    if(input.action==="cancel"){
      const {data:cancelRecipients,error:cancelRecipientsError}=await supabase.from("availability_request_recipients").select("id").eq("organisation_id",input.organisationId).eq("request_id",input.requestId);if(cancelRecipientsError)throw cancelRecipientsError;
      const {error}=await supabase.from("availability_request_periods").update({status:"cancelled",cancelled_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("id",input.requestId).not("status","in","(closed,cancelled)");if(error)throw error;
      await supabase.from("availability_request_recipients").update({status:"cancelled"}).eq("organisation_id",input.organisationId).eq("request_id",input.requestId).not("status","in","(submitted,responded)");
      const cancelIds=(cancelRecipients??[]).map(row=>row.id);if(cancelIds.length)await supabase.from("secure_response_tokens").update({revoked_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).in("recipient_id",cancelIds);
      return NextResponse.json({message:"Beschikbaarheidsverzoek geannuleerd; open links zijn ingetrokken."});
    }
    if(input.action==="extend"){
      if(!input.deadlineAt)throw new Error("DEADLINE_REQUIRED");
      const {error}=await supabase.from("availability_request_periods").update({deadline_at:new Date(input.deadlineAt).toISOString()}).eq("organisation_id",input.organisationId).eq("id",input.requestId).not("status","in","(closed,cancelled)");if(error)throw error;
      return NextResponse.json({message:"Reactietermijn verlengd."});
    }
    if(!input.recipientIds.length)throw new Error("RECIPIENTS_REQUIRED");
    const {data:recipients,error:recipientError}=await supabase.from("availability_request_recipients").select("id,status,reminder_count").eq("organisation_id",input.organisationId).eq("venue_id",input.venueId).eq("request_id",input.requestId).in("id",input.recipientIds);
    if(recipientError||recipients?.length!==input.recipientIds.length)throw recipientError??new Error("RECIPIENTS_INVALID");
    const rows=(recipients??[]) as unknown as {id:string;status:string;reminder_count:number}[];
    if(rows.some(row=>["submitted","responded","cancelled","expired","revoked"].includes(row.status)))throw new Error("RECIPIENT_NOT_REMINDABLE");
    const attempts=supabase.from("availability_message_attempts") as unknown as {insert:(rows:Record<string,unknown>[])=>Promise<{error:{code?:string}|null}>};
    const {error:attemptError}=await attempts.insert(rows.map(row=>({organisation_id:input.organisationId,venue_id:input.venueId,recipient_id:row.id,attempt_type:input.action==="remind"?"reminder":"initial",channel:"manual_whatsapp",idempotency_key:`${input.idempotencyKey}:${row.id}`,state:"manually_shared",attempted_by:user.id})));
    if(attemptError?.code==="23505")return NextResponse.json({message:"Deze deelactie was al verwerkt.",replayed:true});
    if(attemptError)throw attemptError;
    for(const row of rows){await supabase.from("availability_request_recipients").update({status:"manually_shared",manually_shared_at:new Date().toISOString(),reminder_count:input.action==="remind"?row.reminder_count+1:row.reminder_count}).eq("organisation_id",input.organisationId).eq("id",row.id)}
    return NextResponse.json({message:input.action==="remind"?"Herinneringen als handmatig gedeeld vastgelegd.":"Handmatig delen geaudit."});
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"AVAILABILITY_UPDATE_FAILED"},{status:400});
  }
}
