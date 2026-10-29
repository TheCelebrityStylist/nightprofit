import {NextResponse} from "next/server";
import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {pushToStaff} from "../../../../lib/push/push";

// "Stuur een testmelding" for the signed-in person's own phones.
const schema=z.object({organisationId:z.string().uuid()});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {user}=await requireMembership(input.organisationId);
    const admin=createSupabaseAdminClient() as unknown as SupabaseClient;
    const {data}=await admin.from("staff_profiles").select("id").eq("organisation_id",input.organisationId).eq("auth_user_id",user.id).maybeSingle();
    const staffId=(data as {id?:string}|null)?.id;
    if(!staffId)return NextResponse.json({errorCode:"NO_STAFF_PROFILE"},{status:409});
    const reached=await pushToStaff(admin,input.organisationId,[staffId],{title:"Meldingen staan aan",body:"Zo krijg je straks je rooster, vragen en herinneringen.",url:"/app/my-work",tag:"test"},new URL(request.url).origin);
    return NextResponse.json({delivered:reached.has(staffId)});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"PUSH_TEST_FAILED"},{status:400});
  }
}
