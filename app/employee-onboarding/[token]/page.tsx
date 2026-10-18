import Link from "next/link";
import {createSupabaseAdminClient} from "../../../lib/supabase/admin";
import {hashStaffOnboardingToken} from "../../../lib/workforce/onboarding";
import {EmployeeOnboardingForm} from "./employee-onboarding-form";

type Invitation={language?:unknown;expires_at?:unknown;revoked_at?:unknown;claimed_at?:unknown;staff_id?:unknown;organisation_id?:unknown;venue_id?:unknown};

export default async function EmployeeOnboardingPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  let invitation:Invitation|null=null,name="",venue="Cliniq";
  try{
    const admin=createSupabaseAdminClient();
    const result=await admin.from("staff_onboarding_invitations").select("language,expires_at,revoked_at,claimed_at,staff_id,organisation_id,venue_id").eq("token_hash",hashStaffOnboardingToken(token)).single();
    invitation=result.data as Invitation|null;
    if(invitation){
      const [{data:staff},{data:venueRow}]=await Promise.all([
        admin.from("staff_profiles").select("full_name,first_name").eq("id",String(invitation.staff_id)).single(),
        admin.from("venues").select("name").eq("id",String(invitation.venue_id)).single(),
      ]);
      const person=staff as {full_name?:string;first_name?:string|null}|null;
      name=person?.first_name||String(person?.full_name??"").trim().split(/\s+/)[0]||"";
      venue=String((venueRow as {name?:string}|null)?.name||venue);
    }
  }catch{invitation=null}
  const claimed=Boolean(invitation?.claimed_at);
  const usable=Boolean(invitation&&!invitation.revoked_at&&!invitation.claimed_at&&new Date(String(invitation.expires_at))>new Date());
  return <main className="auth-page"><div className="auth-brand-row"><Link href="/login" className="brand"><span className="cq-mark">CLI<span className="cq-n">N</span>IQ</span><span className="cq-mark-sub">Team</span></Link></div><section className="auth-card onboarding-card">
    {usable?<EmployeeOnboardingForm token={token} name={name} venue={venue} language={invitation?.language==="en"?"en":"nl"}/>
    :claimed?<><span className="eyebrow">AL GEACTIVEERD</span><h1>{name?`Hoi ${name}, je`:"Je"} account bestaat al</h1><p>Log in met het e-mailadres dat je bij het aanmaken gebruikte.</p><Link className="primary button-link" href="/login">Naar inloggen</Link></>
    :<><span className="eyebrow">LINK VERLOPEN</span><h1>{name?`Hoi ${name}, deze`:"Deze"} link werkt niet meer</h1><p>Uitnodigingen verlopen na twee weken, of er is intussen een nieuwe verstuurd. Vraag je planner om je opnieuw uit te nodigen.</p></>}
  </section></main>;
}
