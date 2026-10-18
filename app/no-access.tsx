import Link from "next/link";

/** Shown to someone who is signed in but was never invited to a team. */
export function NoAccess({ name }: { name?: string }) {
  return (
    <main className="auth-page">
      <div className="auth-brand-row"><Link href="/login" className="brand"><span className="cq-mark">CLI<span className="cq-n">N</span>IQ</span><span className="cq-mark-sub">Team</span></Link></div>
      <section className="auth-card">
        <span className="eyebrow">ALLEEN OP UITNODIGING</span>
        <h1>{name ? `Hoi ${name}` : "Hoi"}, je hebt nog geen toegang</h1>
        <p>Cliniq Team is alleen voor mensen die door de planner zijn toegevoegd. Vraag je planner om je uit te nodigen; je krijgt dan een persoonlijke link via WhatsApp.</p>
        <form action="/api/auth/logout" method="post"><button className="primary">Uitloggen</button></form>
      </section>
    </main>
  );
}
