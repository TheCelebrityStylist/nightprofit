import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {hashAvailabilityToken} from "../../../../lib/workforce/availability";
import {buildCalendar,type CalendarEvent} from "../../../../lib/planning/ics";

// Subscribable shift feed. The token in the URL is the only key; only published shifts are shown.
const PUBLISHED=["published","confirmed","acknowledged","in_progress","completed"];
const GONE=["cancelled","rejected"];

export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
  const {token:raw}=await params;
  const token=raw.replace(/\.ics$/i,"");
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))return new Response("Not found",{status:404});
  try{
    const admin=createSupabaseAdminClient();
    const feeds=admin.from("staff_calendar_feeds" as "staff_profiles") as unknown as {select:(columns:string)=>{eq:(column:string,value:string)=>{maybeSingle:()=>Promise<{data:{staff_id:string;organisation_id:string}|null}>}};update:(row:Record<string,unknown>)=>{eq:(column:string,value:string)=>Promise<unknown>}};
    const {data:feed}=await feeds.select("staff_id,organisation_id").eq("token_hash",hashAvailabilityToken(token)).maybeSingle();
    if(!feed)return new Response("Not found",{status:404});
    const now=Date.now();
    const [{data:shiftRows},{data:venueRows},{data:roleRows}]=await Promise.all([
      admin.from("shifts").select("id,venue_id,role_id,starts_at,ends_at,status,revision,updated_at,location_label").eq("organisation_id",feed.organisation_id).eq("staff_id",feed.staff_id).gte("starts_at",new Date(now-60*86400000).toISOString()).lte("starts_at",new Date(now+180*86400000).toISOString()).order("starts_at"),
      admin.from("venues").select("id,name,address").eq("organisation_id",feed.organisation_id),
      admin.from("operational_roles" as "venues").select("id,name").eq("organisation_id",feed.organisation_id),
    ]);
    const venues=new Map(((venueRows??[]) as unknown as {id:string;name:string;address:Record<string,unknown>|null}[]).map(row=>[row.id,row]));
    const roles=new Map(((roleRows??[]) as unknown as {id:string;name:string}[]).map(row=>[row.id,row.name]));
    const place=(address:Record<string,unknown>|null)=>address?["street","line1","house_number","postal_code","postcode","city"].map(key=>address[key]).filter(value=>typeof value==="string"&&value).join(" "):"";
    const events:CalendarEvent[]=((shiftRows??[]) as unknown as {id:string;venue_id:string;role_id:string;starts_at:string;ends_at:string;status:string;revision:number|null;updated_at:string|null;location_label:string|null}[])
      .filter(row=>PUBLISHED.includes(row.status)||GONE.includes(row.status))
      .map(row=>{
        const venue=venues.get(row.venue_id);
        const role=roles.get(row.role_id);
        const where=[venue?.name,place(venue?.address??null)].filter(Boolean).join(", ");
        return {uid:`${row.id}@cliniq.team`,start:row.starts_at,end:row.ends_at,summary:`${venue?.name??"Werk"}${role?` · ${role}`:""}`,location:row.location_label||where||undefined,description:"Je dienst uit Cliniq Team. Wijzigingen komen hier vanzelf in.",cancelled:GONE.includes(row.status),sequence:row.revision??0,updated:row.updated_at??undefined};
      });
    void feeds.update({last_fetched_at:new Date(now).toISOString()}).eq("token_hash",hashAvailabilityToken(token));
    const name=venues.size===1?`Rooster ${[...venues.values()][0].name}`:"Mijn rooster";
    return new Response(buildCalendar(name,events),{headers:{"content-type":"text/calendar; charset=utf-8","cache-control":"private, max-age=900","content-disposition":"inline; filename=\"rooster.ics\""}});
  }catch{
    return new Response("Temporarily unavailable",{status:503});
  }
}
