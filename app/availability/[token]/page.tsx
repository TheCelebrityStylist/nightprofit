import {createClient} from "@supabase/supabase-js";
import {serverEnv} from "../../../lib/env";
import type {Database} from "../../../lib/supabase/types";
import {hashAvailabilityToken} from "../../../lib/workforce/availability";
import {AvailabilityResponse} from "./availability-response";
export default async function AvailabilityPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;let state:{state?:string;starts_at?:string;ends_at?:string;deadline_at?:string;venue_name?:string;preferred_language?:"nl"|"en";employee_name?:string;entries?:Array<{starts_at:string;ends_at:string;availability:"available"|"preferred"|"preferably_not"|"unavailable";note?:string|null}>}|null=null;
  try{const env=serverEnv();if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error("CONFIGURATION_REQUIRED");const supabase=createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {data}=await supabase.rpc("inspect_availability_request_v2" as "inspect_availability_request",{target_token_hash:hashAvailabilityToken(token)});state=data as typeof state}catch{state={state:"invalid"}}
  if(!state||!state.starts_at||!state.ends_at||!["opened","partial","submitted"].includes(state.state||""))return <main className="availability-page"><section className="availability-card"><div className="logo">N</div><p className="eyebrow">NIGHTPROFIT</p><h1>Deze link is niet actief</h1><p>De aanvraag is verlopen, ingetrokken of ongeldig. Vraag je planner om een nieuwe persoonlijke link.</p></section></main>;
  return <AvailabilityResponse token={token} periodStart={state.starts_at} periodEnd={state.ends_at} deadlineAt={state.deadline_at||state.ends_at} venueName={state.venue_name||"Jouw vestiging"} employeeName={state.employee_name||""} preferredLanguage={state.preferred_language||"nl"} initialEntries={state.entries||[]}/>;
}
