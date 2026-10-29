import {NextResponse} from "next/server";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {sendReminders} from "../../../../lib/workforce/reminders";
import {remindUpcomingShifts} from "../../../../lib/push/notify";

// Called every hour by the database schedule (pg_cron + pg_net) with a shared secret from Vault.
export async function POST(request:Request){
  const token=(request.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  if(token.length!==64)return NextResponse.json({errorCode:"UNAUTHORIZED"},{status:401});
  try{
    const admin=createSupabaseAdminClient();
    const {data:valid,error}=await admin.rpc("cron_token_valid" as "clock_out",{candidate:token} as never);
    if(error||(valid as unknown)!==true)return NextResponse.json({errorCode:"UNAUTHORIZED"},{status:401});
    const db=admin as unknown as SupabaseClient,origin=new URL(request.url).origin;
    const result=await sendReminders(db,{origin,mode:"auto"});
    const shiftNotices=await remindUpcomingShifts(db,origin).catch(()=>0);
    return NextResponse.json({requests:result.requests,sent:result.sent,failed:result.outcomes.filter(row=>row.state==="failed").length,shiftNotices});
  }catch{
    return NextResponse.json({errorCode:"REMINDERS_FAILED"},{status:500});
  }
}
