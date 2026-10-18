import {NextResponse} from "next/server";
import {z} from "zod";
import {assertSameOrigin,consumeRateLimit,opaqueRateLimitKey,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {createSupabaseServerClient} from "../../../../lib/supabase/server";
import {hashStaffOnboardingToken} from "../../../../lib/workforce/onboarding";

// An invited person creates their account. Contract hours are the planner's business, so the
// profile keeps whatever it already had.
const schema=z.object({token:z.string(),email:z.email(),password:z.string().min(10).max(128)});

export async function POST(request:Request){
  let createdUserId:string|undefined;
  try{
    assertSameOrigin(request);const input=schema.parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"staff-onboarding",input.token),5,60*60_000);
    const tokenHash=hashStaffOnboardingToken(input.token),admin=createSupabaseAdminClient(),email=input.email.toLowerCase();
    const {data:invitation,error:invitationError}=await admin.from("staff_onboarding_invitations").select("id,staff_id,expires_at,revoked_at,claimed_at").eq("token_hash",tokenHash).single();
    if(invitationError||!invitation||invitation.revoked_at||invitation.claimed_at||new Date(String(invitation.expires_at))<=new Date())return NextResponse.json({errorCode:"INVITATION_UNAVAILABLE"},{status:410});
    const {data:staff}=await admin.from("staff_profiles").select("contracted_minutes_week,minimum_minutes_week,maximum_minutes_week").eq("id",String(invitation.staff_id)).single();
    const profile=(staff??{}) as {contracted_minutes_week?:number|null;minimum_minutes_week?:number|null;maximum_minutes_week?:number|null};
    const minimum=profile.minimum_minutes_week??0,maximum=Math.max(profile.maximum_minutes_week??10080,minimum),contracted=Math.min(Math.max(profile.contracted_minutes_week??minimum,minimum),maximum);
    const {data:created,error:createError}=await admin.auth.admin.createUser({email,password:input.password,email_confirm:true});
    if(createError||!created.user)return NextResponse.json({errorCode:/already|registered|exists/i.test(String(createError?.message))?"EMAIL_IN_USE":"ACCOUNT_CREATE_FAILED"},{status:400});
    createdUserId=created.user.id;
    const {error:claimError}=await admin.rpc("claim_staff_onboarding" as "create_organisation",{target_token_hash:tokenHash,target_user_id:createdUserId,target_email:email,target_contracted_minutes:contracted,target_minimum_minutes:minimum,target_maximum_minutes:maximum} as never);
    if(claimError){await admin.auth.admin.deleteUser(createdUserId);createdUserId=undefined;throw claimError}
    // Sign them straight in so the first thing they see is their own roster.
    try{const supabase=await createSupabaseServerClient();await supabase.auth.signInWithPassword({email,password:input.password})}catch{return NextResponse.json({next:"/login?activated=1"},{status:201})}
    return NextResponse.json({next:"/app/my-work"},{status:201});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"ONBOARDING_FAILED"},{status:400})}
}
