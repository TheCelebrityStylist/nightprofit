import {createSupabaseAdminClient} from "../../../lib/supabase/admin";
import {hashStaffOnboardingToken} from "../../../lib/workforce/onboarding";
import {EmployeeOnboardingForm} from "./employee-onboarding-form";

export default async function EmployeeOnboardingPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;let invitation:{language?:unknown;expires_at?:unknown;revoked_at?:unknown;claimed_at?:unknown;staff_id?:unknown}|null=null;
  try{const admin=createSupabaseAdminClient();const result=await admin.from("staff_onboarding_invitations").select("language,expires_at,revoked_at,claimed_at,staff_id").eq("token_hash",hashStaffOnboardingToken(token)).single();invitation=result.data}catch{}
  const usable=Boolean(invitation&&!invitation.revoked_at&&!invitation.claimed_at&&new Date(String(invitation.expires_at))>new Date());
  return <main className="auth-page"><section className="auth-card onboarding-card">{usable?<EmployeeOnboardingForm token={token} language={invitation?.language==="en"?"en":"nl"}/>:<><span className="eyebrow">NIGHTPROFIT</span><h1>Invitation unavailable</h1><p>This secure onboarding link is invalid, expired, revoked, or already used. Ask your manager for a new invitation.</p></>}</section></main>
}
