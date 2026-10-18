import {NextResponse} from "next/server";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {statusUpdates,verifySignature} from "../../../../lib/whatsapp/cloud";

const env=(name:string)=>{const value=process.env[name];return typeof value==="string"&&value.trim()?value.trim():undefined};

/** Meta calls this once when you save the webhook URL in the app dashboard. */
export async function GET(request:Request){
  const url=new URL(request.url);
  const expected=env("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if(expected&&url.searchParams.get("hub.mode")==="subscribe"&&url.searchParams.get("hub.verify_token")===expected){
    return new Response(url.searchParams.get("hub.challenge")??"",{status:200,headers:{"content-type":"text/plain"}});
  }
  return new Response("Forbidden",{status:403});
}

/** Delivery receipts: sent → delivered → read, or failed with a reason. */
export async function POST(request:Request){
  const secret=env("WHATSAPP_APP_SECRET");
  const raw=await request.text();
  if(!secret||!(await verifySignature(secret,raw,request.headers.get("x-hub-signature-256"))))return new Response("Invalid signature",{status:401});
  let payload:unknown;
  try{payload=JSON.parse(raw)}catch{return new Response("Bad request",{status:400})}
  const updates=statusUpdates(payload);
  if(updates.length){
    const admin=createSupabaseAdminClient();
    const rank:Record<string,number>={pending:0,sending:1,sent:2,delivered:3,read:4,failed:5};
    for(const update of updates){
      const {data}=await admin.from("notification_outbox").select("id,state").eq("channel","whatsapp").eq("provider_message_id",update.messageId).limit(1);
      const row=(data??[])[0] as {id:string;state:string}|undefined;
      if(!row||(rank[update.state]??0)<=(rank[row.state]??0))continue;
      await admin.from("notification_outbox").update({state:update.state,failure_reason:update.failureReason,updated_at:new Date().toISOString()}).eq("id",row.id);
    }
  }
  return NextResponse.json({received:updates.length});
}
