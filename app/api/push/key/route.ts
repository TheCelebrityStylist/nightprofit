import {NextResponse} from "next/server";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {vapidKeys} from "../../../../lib/push/push";

// Public half of the Web Push key; browsers need it to subscribe.
export async function GET(){
  try{
    const {publicKey}=await vapidKeys(createSupabaseAdminClient() as unknown as SupabaseClient);
    return NextResponse.json({publicKey},{headers:{"cache-control":"public, max-age=3600"}});
  }catch{
    return NextResponse.json({errorCode:"PUSH_UNAVAILABLE"},{status:503});
  }
}
