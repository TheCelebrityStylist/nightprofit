import {NextResponse} from "next/server";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {statusUpdates,verifySignature} from "../../../../lib/whatsapp/cloud";
import {allStoredSetups} from "../../../../lib/whatsapp/store";

const env=(name:string)=>{const value=process.env[name];return typeof value==="string"&&value.trim()?value.trim():undefined};

/** Meta calls this once when the webhook is connected. Accepts the hosting token or one stored in the app. */
export async function GET(request:Request){
  const url=new URL(request.url);
  const given=url.searchParams.get("hub.verify_token");
  if(url.searchParams.get("hub.mode")!=="subscribe"||!given)return new Response("Forbidden",{status:403});
  const known=[env("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),...(await allStoredSetups().catch(()=>[])).map(row=>row.setup.verifyToken)].filter(Boolean);
  if(!known.includes(given))return new Response("Forbidden",{status:403});
  return new Response(url.searchParams.get("hub.challenge")??"",{status:200,headers:{"content-type":"text/plain"}});
}

/** Delivery receipts: sent → delivered → read, or failed with a reason. */
export async function POST(request:Request){
  const raw=await request.text();
  const signature=request.headers.get("x-hub-signature-256");
  const stored=await allStoredSetups().catch(()=>[]);
  const hostingSecret=env("WHATSAPP_APP_SECRET");
  let matched:{id:string}|null=null;
  let valid=Boolean(hostingSecret&&(await verifySignature(hostingSecret,raw,signature)));
  if(!valid)for(const row of stored){if(await verifySignature(row.setup.appSecret,raw,signature)){valid=true;matched={id:row.id};break}}
  if(!valid)return new Response("Invalid signature",{status:401});
  let payload:unknown;
  try{payload=JSON.parse(raw)}catch{return new Response("Bad request",{status:400})}
  const admin=createSupabaseAdminClient();
  if(matched)await admin.from("integration_connections").update({webhook_status:"receiving",last_successful_sync_at:new Date().toISOString()}).eq("id",matched.id);
  const updates=statusUpdates(payload);
  const rank:Record<string,number>={pending:0,sending:1,sent:2,delivered:3,read:4,failed:5};
  for(const update of updates){
    const {data}=await admin.from("notification_outbox").select("id,state").eq("channel","whatsapp").eq("provider_message_id",update.messageId).limit(1);
    const row=(data??[])[0] as {id:string;state:string}|undefined;
    if(!row||(rank[update.state]??0)<=(rank[row.state]??0))continue;
    await admin.from("notification_outbox").update({state:update.state,failure_reason:update.failureReason,updated_at:new Date().toISOString()}).eq("id",row.id);
  }
  return NextResponse.json({received:updates.length});
}
