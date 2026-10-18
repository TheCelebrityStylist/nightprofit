import Link from "next/link";
import {createClient} from "@supabase/supabase-js";
import {serverEnv} from "../../../lib/env";
import type {Database} from "../../../lib/supabase/types";
import {hashAvailabilityToken} from "../../../lib/workforce/availability";
import {AvailabilityResponse} from "./availability-response";

type State={state?:string;deadline_at?:string;venue_name?:string;venue_timezone?:string;preferred_language?:"nl"|"en";employee_name?:string;nights?:string[];answers?:Record<string,string>};

export default async function AvailabilityPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;let state:State|null=null;
  try{
    const env=serverEnv();if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error("CONFIGURATION_REQUIRED");
    const supabase=createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data}=await supabase.rpc("inspect_availability_request_v3" as "inspect_availability_request",{target_token_hash:hashAvailabilityToken(token)});
    state=data as State;
  }catch{state={state:"invalid"}}
  const brand=<div className="auth-brand-row"><Link href="/login" className="brand"><span className="cq-mark">CLI<span className="cq-n">N</span>IQ</span><span className="cq-mark-sub">Team</span></Link></div>;
  if(!state||!state.nights?.length||!["opened","partial","submitted"].includes(state.state||"")){
    const name=state?.employee_name;
    const expired=state?.state==="expired";
    return <main className="auth-page">{brand}<section className="auth-card"><h1>{name?`Hoi ${name}, `:""}{expired?"de deadline is voorbij":"deze link werkt niet meer"}</h1><p>{expired?"Je kunt via deze link niets meer doorgeven. Laat het je planner zelf weten als je nog kunt werken.":"De vraag is ingetrokken of vervangen door een nieuwe. Kijk in je WhatsApp voor de nieuwste link, of log in en kijk onder Mijn rooster."}</p></section></main>;
  }
  return <main className="auth-page">{brand}<AvailabilityResponse token={token} nights={state.nights} initialAnswers={state.answers??{}} deadlineAt={state.deadline_at||""} venueName={state.venue_name||"Cliniq"} timezone={state.venue_timezone||"Europe/Amsterdam"} employeeName={state.employee_name||""} language={state.preferred_language==="en"?"en":"nl"}/></main>;
}
