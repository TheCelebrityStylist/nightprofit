import {NextResponse} from "next/server";
import {z} from "zod";
import {assertSameOrigin,consumeRateLimit,opaqueRateLimitKey,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {hashStaffOnboardingToken} from "../../../../lib/workforce/onboarding";

const schema=z.object({token:z.string(),email:z.email(),password:z.string().min(12).max(128),contractedHours:z.coerce.number().int().min(0).max(168),minimumHours:z.coerce.number().int().min(0).max(168),maximumHours:z.coerce.number().int().min(0).max(168)}).refine(value=>value.minimumHours<=value.contractedHours&&value.contractedHours<=value.maximumHours,{message:"INVALID_HOURS"});

export async function POST(request:Request){
  let createdUserId:string|undefined;
  try{
    assertSameOrigin(request);const input=schema.parse(await request.json());consumeRateLimit(await opaqueRateLimitKey(request,"staff-onboarding",input.token),5,60*60_000);
    const tokenHash=hashStaffOnboardingToken(input.token),admin=createSupabaseAdminClient();
    const {data:invitation,error:invitationError}=await admin.from("staff_onboarding_invitations").select("id,expires_at,revoked_at,claimed_at").eq("token_hash",tokenHash).single();
    if(invitationError||!invitation||invitation.revoked_at||invitation.claimed_at||new Date(String(invitation.expires_at))<=new Date())return NextResponse.json({errorCode:"INVITATION_UNAVAILABLE"},{status:410});
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:input.email.toLowerCase(),password:input.password,email_confirm:true});
    if(createError||!created.user)return NextResponse.json({errorCode:"ACCOUNT_CREATE_FAILED"},{status:400});createdUserId=created.user.id;
    const {error:claimError}=await admin.rpc("claim_staff_onboarding" as "create_organisation",{target_token_hash:tokenHash,target_user_id:createdUserId,target_email:input.email.toLowerCase(),target_contracted_minutes:input.contractedHours*60,target_minimum_minutes:input.minimumHours*60,target_maximum_minutes:input.maximumHours*60} as never);
    if(claimError){await admin.auth.admin.deleteUser(createdUserId);createdUserId=undefined;throw claimError}
    return NextResponse.json({message:"Employee account activated.",next:"/login"},{status:201});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"ONBOARDING_FAILED"},{status:400})}
}
