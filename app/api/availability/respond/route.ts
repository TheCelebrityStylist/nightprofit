import {createClient} from "@supabase/supabase-js";
import {NextResponse} from "next/server";
import {z} from "zod";
import {serverEnv} from "../../../../lib/env";
import type {Database,Json} from "../../../../lib/supabase/types";
import {hashAvailabilityToken,validateAvailabilityEntries} from "../../../../lib/workforce/availability";

const entry=z.object({startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),availability:z.enum(["available","preferred","unavailable"]),note:z.string().trim().max(500).optional()});
const schema=z.object({token:z.string(),periodStart:z.iso.datetime({offset:true}),periodEnd:z.iso.datetime({offset:true}),entries:z.array(entry).min(1).max(100)});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());
    const entries=validateAvailabilityEntries(input.entries,input.periodStart,input.periodEnd);
    const env=serverEnv();
    if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error("CONFIGURATION_REQUIRED");
    const supabase=createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const entryInputs=entries.map(row=>({starts_at:row.startsAt,ends_at:row.endsAt,availability:row.availability,note:row.note||""}));
    const {data,error}=await supabase.rpc("submit_availability_request",{target_token_hash:hashAvailabilityToken(input.token),entry_inputs:entryInputs as unknown as Json});
    if(error)throw error;
    return NextResponse.json({message:"Je beschikbaarheid is bevestigd.",result:data});
  }catch(error){
    return NextResponse.json({error:error instanceof z.ZodError?"Controleer alle dagen en tijden.":"Deze link is verlopen, ingetrokken of de inzending bevat een conflict."},{status:400});
  }
}
