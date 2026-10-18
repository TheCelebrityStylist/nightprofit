import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {normalizeDutchPhone} from "../../../../lib/workforce/domain";
import {whatsappConfig,type WhatsappTemplateKey} from "../../../../lib/whatsapp/cloud";
import {connectWebhook,createTemplate,phoneInfo,sendTestMessage,templateStatus} from "../../../../lib/whatsapp/meta";
import {WHATSAPP_CONNECTOR,sealSetup,storedSetup,type WhatsappSetup} from "../../../../lib/whatsapp/store";

const org={organisationId:z.string().uuid(),venueId:z.string().uuid()};
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("status"),...org}),
  z.object({action:z.literal("save"),...org,token:z.string().trim().min(20).max(2000),phoneNumberId:z.string().trim().regex(/^\d{6,30}$/),wabaId:z.string().trim().regex(/^\d{6,30}$/),appId:z.string().trim().regex(/^\d{6,30}$/),appSecret:z.string().trim().regex(/^[a-f0-9]{32}$/i)}),
  z.object({action:z.literal("templates"),...org}),
  z.object({action:z.literal("webhook"),...org}),
  z.object({action:z.literal("test"),...org,to:z.string().trim().min(8).max(40)}),
  z.object({action:z.literal("disconnect"),...org}),
]);

const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});

async function status(organisationId:string){
  if(whatsappConfig())return {source:"hosting" as const,connected:true,phone:null,templates:null,webhook:null};
  const stored=await storedSetup(organisationId);
  if(!stored)return {source:"none" as const,connected:false,phone:null,templates:null,webhook:null};
  const [phone,templates]=await Promise.all([phoneInfo(stored.setup),templateStatus(stored.setup)]);
  return {
    source:"app" as const,
    connected:phone.ok,
    phone:phone.ok?{number:phone.data.display_phone_number??"",name:phone.data.verified_name??"",quality:phone.data.quality_rating??"",nameStatus:phone.data.name_status??""}:{error:phone.message},
    templates:templates.ok?templates.data:{error:templates.message},
    webhook:{status:stored.row.webhook_status??"not_connected",lastEventAt:stored.row.last_successful_sync_at},
  };
}

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    await requireMembership(input.organisationId,"members.manage",input.venueId);
    const admin=createSupabaseAdminClient();

    if(input.action==="status")return NextResponse.json(await status(input.organisationId));

    if(input.action==="save"){
      const phone=await phoneInfo({token:input.token,phoneNumberId:input.phoneNumberId});
      if(!phone.ok)return fail(`Meta accepteert deze gegevens niet: ${phone.message}`);
      const templates=await templateStatus({token:input.token,wabaId:input.wabaId});
      if(!templates.ok)return fail(`Het WhatsApp Business-account-ID klopt niet bij deze token: ${templates.message}`);
      const previous=await storedSetup(input.organisationId).catch(()=>null);
      const setup:WhatsappSetup={token:input.token,phoneNumberId:input.phoneNumberId,wabaId:input.wabaId,appId:input.appId,appSecret:input.appSecret,verifyToken:previous?.setup.verifyToken??Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,"0")).join("")};
      const now=new Date().toISOString();
      const {error}=await admin.from("integration_connections").upsert({organisation_id:input.organisationId,venue_id:input.venueId,connector_key:WHATSAPP_CONNECTOR,lifecycle_status:"available",connection_status:"connected",credential_reference:"app",provider_account_id:input.phoneNumberId,encrypted_credential:await sealSetup(setup),credential_tested_at:now,webhook_status:previous?.row.webhook_status??"not_connected",consecutive_failures:0,provider_error_code:null,provider_error_message:null,updated_at:now},{onConflict:"organisation_id,venue_id,connector_key"});
      if(error)throw error;
      return NextResponse.json(await status(input.organisationId));
    }

    const stored=await storedSetup(input.organisationId);
    if(!stored)return fail("Koppel eerst je WhatsApp-nummer.",409);

    if(input.action==="templates"){
      const current=await templateStatus(stored.setup);
      if(!current.ok)return fail(current.message);
      const errors:string[]=[];
      for(const row of current.data.filter(item=>item.status==="MISSING"||item.status==="REJECTED")){
        const created=await createTemplate(stored.setup,row.key as WhatsappTemplateKey);
        if(!created.ok)errors.push(`${row.title}: ${created.message}`);
      }
      const result=await status(input.organisationId);
      return errors.length?NextResponse.json({...result,error:errors.join(" ")},{status:207}):NextResponse.json(result);
    }

    if(input.action==="webhook"){
      const origin=request.headers.get("origin")??new URL(request.url).origin;
      if(!origin.startsWith("https://"))return fail("De webhook werkt alleen via een https-adres. Open de app via de gepubliceerde link.");
      const linked=await connectWebhook(stored.setup,`${origin}/api/whatsapp/webhook`);
      await admin.from("integration_connections").update({webhook_status:linked.ok?"connected":"error",provider_error_message:linked.ok?null:linked.message,updated_at:new Date().toISOString()}).eq("id",stored.row.id);
      if(!linked.ok)return fail(linked.message);
      return NextResponse.json({...(await status(input.organisationId)),callbackUrl:`${origin}/api/whatsapp/webhook`});
    }

    if(input.action==="test"){
      let to:string;try{to=normalizeDutchPhone(input.to)}catch{return fail("Dit nummer klopt niet. Gebruik bijvoorbeeld 06 12345678.")}
      const sent=await sendTestMessage(stored.setup,to);
      if(!sent.ok)return fail(sent.message);
      return NextResponse.json({sent:true});
    }

    await admin.from("integration_connections").delete().eq("id",stored.row.id);
    return NextResponse.json({source:"none",connected:false,phone:null,templates:null,webhook:null});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return fail("Log opnieuw in.",401);
    if(error instanceof Error&&error.message==="FORBIDDEN")return fail("Alleen de eigenaar of een beheerder kan WhatsApp koppelen.",403);
    return securityErrorResponse(error)??fail(error instanceof z.ZodError?"Controleer de ingevulde gegevens.":"Er ging iets mis. Probeer het opnieuw.");
  }
}
