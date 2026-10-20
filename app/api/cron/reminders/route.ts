import {NextResponse} from "next/server";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {sendReminders} from "../../../../lib/workforce/reminders";

// Called every hour by the database schedule (pg_cron + pg_net) with a shared secret from Vault.
export async function POST(request:Request){
  const token=(request.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  if(token.length!==64)return NextResponse.json({errorCode:"UNAUTHORIZED"},{status:401});
  try{
    const admin=createSupabaseAdminClient();
    const {data:valid,error}=await admin.rpc("cron_token_valid" as "clock_out",{candidate:token} as never);
    if(error||(valid as unknown)!==true)return NextResponse.json({errorCode:"UNAUTHORIZED"},{status:401});
    const result=await sendReminders(admin as unknown as SupabaseClient,{origin:new URL(request.url).origin,mode:"auto"});
    return NextResponse.json({requests:result.requests,sent:result.sent,failed:result.outcomes.filter(row=>row.state==="failed").length});
  }catch{
    return NextResponse.json({errorCode:"REMINDERS_FAILED"},{status:500});
  }
}
