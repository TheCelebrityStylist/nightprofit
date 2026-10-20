import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {createAvailabilityToken,hashAvailabilityToken} from "../../../../lib/workforce/availability";

// Personal calendar link for the signed-in person. Making a new link stops the old one.
const schema=z.object({organisationId:z.string().uuid()});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {user}=await requireMembership(input.organisationId);
    const admin=createSupabaseAdminClient();
    const {data:staff}=await admin.from("staff_profiles").select("id").eq("organisation_id",input.organisationId).eq("auth_user_id",user.id).maybeSingle();
    const staffId=(staff as {id?:string}|null)?.id;
    if(!staffId)return NextResponse.json({errorCode:"NO_STAFF_PROFILE"},{status:409});
    const token=createAvailabilityToken();
    const feeds=admin.from("staff_calendar_feeds" as "staff_profiles") as unknown as {upsert:(row:Record<string,unknown>,options:{onConflict:string})=>Promise<{error:unknown}>};
    const {error}=await feeds.upsert({staff_id:staffId,organisation_id:input.organisationId,token_hash:hashAvailabilityToken(token),created_at:new Date().toISOString(),last_fetched_at:null},{onConflict:"staff_id"});
    if(error)throw error;
    const host=new URL(request.url).host;
    const https=`https://${host}/api/calendar/${token}.ics`;
    const webcal=`webcal://${host}/api/calendar/${token}.ics`;
    return NextResponse.json({https,webcal,google:`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
    if(error instanceof Error&&error.message==="FORBIDDEN")return NextResponse.json({errorCode:"FORBIDDEN"},{status:403});
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"CALENDAR_LINK_FAILED"},{status:400});
  }
}
