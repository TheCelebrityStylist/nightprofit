import Link from "next/link";

export default function SignupPage(){
  return <main className="auth-page"><div className="auth-brand-row"><Link href="/login" className="brand"><span className="cq-mark">CLI<span className="cq-n">N</span>IQ</span><span className="cq-mark-sub">Team</span></Link></div><section className="auth-card">
    <span className="eyebrow">ALLEEN OP UITNODIGING</span>
    <h1>Account aanmaken gaat via je uitnodiging</h1>
    <p>Je planner voegt je toe en stuurt je een persoonlijke link via WhatsApp. Open die link om je account aan te maken.</p>
    <footer><Link href="/login">Ik heb al een account</Link></footer>
  </section></main>;
}
