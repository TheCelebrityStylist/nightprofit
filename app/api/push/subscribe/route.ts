import {NextResponse} from "next/server";
import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";

// Save or remove this phone's notification subscription for the signed-in person.
const keys=z.object({p256dh:z.string().min(20).max(200),auth:z.string().min(8).max(100)});
const schema=z.object({organisationId:z.string().uuid(),endpoint:z.string().url().startsWith("https://").max(1000),keys:keys.optional()});

async function staffOf(organisationId:string){
  const {user}=await requireMembership(organisationId);
  const admin=createSupabaseAdminClient() as unknown as SupabaseClient;
  const {data}=await admin.from("staff_profiles").select("id").eq("organisation_id",organisationId).eq("auth_user_id",user.id).maybeSingle();
  return {admin,staffId:(data as {id?:string}|null)?.id};
}
const failed=(error:unknown,code:string)=>{
  if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
  if(error instanceof Error&&error.message==="FORBIDDEN")return NextResponse.json({errorCode:"FORBIDDEN"},{status:403});
  return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":code},{status:400});
};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    if(!input.keys)throw new z.ZodError([]);
    const {admin,staffId}=await staffOf(input.organisationId);
    if(!staffId)return NextResponse.json({errorCode:"NO_STAFF_PROFILE"},{status:409});
    const {error}=await admin.from("push_subscriptions").upsert({organisation_id:input.organisationId,staff_id:staffId,endpoint:input.endpoint,p256dh:input.keys.p256dh,auth:input.keys.auth,user_agent:(request.headers.get("user-agent")??"").slice(0,300),failure_count:0},{onConflict:"endpoint"});
    if(error)throw error;
    return NextResponse.json({subscribed:true});
  }catch(error){return failed(error,"PUSH_SUBSCRIBE_FAILED")}
}

export async function DELETE(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {admin,staffId}=await staffOf(input.organisationId);
    if(staffId)await admin.from("push_subscriptions").delete().eq("organisation_id",input.organisationId).eq("staff_id",staffId).eq("endpoint",input.endpoint);
    return NextResponse.json({subscribed:false});
  }catch(error){return failed(error,"PUSH_UNSUBSCRIBE_FAILED")}
}
