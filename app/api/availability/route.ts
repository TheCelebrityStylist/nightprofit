import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {createAvailabilityToken,hashAvailabilityToken} from "../../../lib/workforce/availability";
import {normalizeDutchPhone} from "../../../lib/workforce/domain";
import {assertSameOrigin,securityErrorResponse} from "../../../lib/http/security";

const schema=z.object({
  organisationId:z.string().uuid(),venueId:z.string().uuid(),
  startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),deadlineAt:z.iso.datetime({local:true}),
  staffIds:z.array(z.string().uuid()).min(1).max(250),
});

const updateSchema=z.object({
  organisationId:z.string().uuid(),venueId:z.string().uuid(),
  action:z.enum(["manual_share","cancel","extend","remind"]),
  requestId:z.string().uuid(),recipientIds:z.array(z.string().uuid()).max(250).default([]),
  deadlineAt:z.iso.datetime({local:true}).optional(),idempotencyKey:z.string().uuid(),
});

const availabilityMessage=(language:string,name:string,startsAt:string,endsAt:string,deadlineAt:string,url:string)=>{
  const locale=language==="en"?"en-GB":"nl-NL";
  const range=`${new Date(startsAt).toLocaleDateString(locale,{day:"numeric",month:"short"})}–${new Date(endsAt).toLocaleDateString(locale,{day:"numeric",month:"short"})}`;
  const deadline=new Date(deadlineAt).toLocaleString(locale,{weekday:"short",hour:"2-digit",minute:"2-digit"});
  return language==="en"
    ?`Hi ${name}! Can you share your availability for ${range} by ${deadline}? Your personal secure link takes less than a minute: ${url}`
    :`Hoi ${name}! Kun je je beschikbaarheid voor ${range} uiterlijk ${deadline} doorgeven? Via deze persoonlijke beveiligde link duurt dat minder dan een minuut: ${url}`;
};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const origin=new URL(request.url).origin;
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
      const message=availabilityMessage(person.preferred_language,person.full_name,input.startsAt,input.endsAt,input.deadlineAt,responseUrl);
      shares[person.id]={message,phoneState,whatsappUrl:phone?`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`:null};
      return {staff_id:person.id,token_hash:hashAvailabilityToken(token),response_url:responseUrl,language:person.preferred_language};
    });
    const {data,error}=await supabase.rpc("create_availability_request",{
      target_organisation_id:input.organisationId,target_venue_id:input.venueId,
      target_starts_at:new Date(input.startsAt).toISOString(),target_ends_at:new Date(input.endsAt).toISOString(),
      target_deadline_at:new Date(input.deadlineAt).toISOString(),recipient_inputs:recipients,
    });
    if(error)throw error;
    const {data:createdRecipients,error:createdRecipientsError}=await supabase.from("availability_request_recipients").select("id,staff_id").eq("organisation_id",input.organisationId).eq("request_id",data);if(createdRecipientsError)throw createdRecipientsError;
    const recipientIdsByStaff=Object.fromEntries((createdRecipients??[]).map(row=>[row.staff_id,row.id]));
    return NextResponse.json({message:`Beschikbaarheid voorbereid voor ${recipients.length} medewerker(s). Er is niets extern verstuurd.`,requestId:data,links:Object.fromEntries(links),shares,recipientIdsByStaff},{status:201});
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
