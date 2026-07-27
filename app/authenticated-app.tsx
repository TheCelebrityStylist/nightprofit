import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { CloseForm } from "./close-form";
import "./real-app.css";

const navigation = [
  ["Command Center", "/app/dashboard"],
  ["Nightly Close", "/app/close"],
  ["Events", "/app/events"],
  ["Group Bookings", "/app/bookings"],
  ["Suppliers & Contracts", "/app/suppliers"],
  ["Products & Margins", "/app/margins"],
  ["Event Yield", "/app/yield"],
  ["Team & Compliance", "/app/compliance"],
  ["Alerts & Actions", "/app/alerts"],
  ["Reports", "/app/reports"],
  ["Integrations", "/app/integrations"],
  ["Settings", "/app/settings"],
  ["Billing", "/app/billing"],
] as const;

export async function AuthenticatedApp({ path }: { path: string }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const { data: memberships, error: membershipError } = await supabase
    .from("organisation_members")
    .select("organisation_id,role")
    .eq("user_id", user.id);
  if (membershipError) throw new Error("Membership lookup failed");
  if (!memberships?.length) redirect("/onboarding");
  const selectedMembership = memberships[0];
  const [{ data: organisation }, { data: venues }, { data: closes }] = await Promise.all([
    supabase.from("organisations").select("id,name,currency,timezone").eq("id", selectedMembership.organisation_id).single(),
    supabase.from("venues").select("id,name,timezone").eq("organisation_id", selectedMembership.organisation_id).order("name"),
    supabase.from("closing_sessions").select("id,venue_id,trading_date,status").eq("organisation_id", selectedMembership.organisation_id).order("trading_date",{ascending:false}).limit(5),
  ]);
  if (!organisation) redirect("/onboarding");
  const activeLabel = navigation.find(([, href]) => path===href)?.[0] ?? "Command Center";
  const submitted = closes?.filter((close) => close.status==="submitted").length ?? 0;
  const approved = closes?.filter((close) => close.status==="approved"||close.status==="locked").length ?? 0;

  return <div className="app-shell real-app">
    <aside>
      <Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link>
      <div className="venue" aria-label="Current organisation">
        <span>{organisation.name.slice(0,2).toUpperCase()}</span>
        <div><b>{organisation.name}</b><small>{venues?.length ?? 0} vestiging(en) · {organisation.currency}</small></div>
      </div>
      <nav>{navigation.map(([label,href])=><Link key={href} href={href} className={path===href?"active":""}>{label}</Link>)}</nav>
      <div className="aside-foot"><span>Beveiligde tenantdata</span><p>{selectedMembership.role}</p></div>
    </aside>
    <main className="app-main">
      <header className="topbar">
        <div><b>{organisation.name}</b><small>{venues?.map((venue)=>venue.name).join(" · ")||"Nog geen vestiging"}</small></div>
        <form action="/api/auth/logout" method="post"><button className="ghost">Uitloggen</button></form>
      </header>
      <div className="content">
        <section className="hero-row">
          <div><div className="eyebrow">LIVE · SUPABASE</div><h1>{activeLabel}</h1><p>Alle gegevens hieronder zijn beperkt tot je huidige organisatie en toegewezen vestigingen.</p></div>
          {path==="/app/close"&&<Link className="primary" href="/app/close/new">Nieuwe afsluiting</Link>}
        </section>
        {path==="/app/close/new"?<section className="panel"><CloseForm organisationId={organisation.id} venues={venues??[]}/></section>:path==="/app/dashboard"?<>
          <section className="metric-grid">
            <article className="metric"><span>Vestigingen</span><strong>{venues?.length ?? 0}</strong><small>Toegankelijk binnen deze organisatie</small></article>
            <article className="metric"><span>Ingediende closes</span><strong>{submitted}</strong><small>Wachten op bevoegde goedkeuring</small></article>
            <article className="metric"><span>Goedgekeurd/vergrendeld</span><strong>{approved}</strong><small>Historie met onveranderlijke snapshots</small></article>
          </section>
          <section className="panel recent">
            <header><div><h3>Recente afsluitingen</h3><p>Live uit de beveiligde tenantdatabase.</p></div></header>
            {!closes?.length?<div className="empty-state"><h3>Nog geen echte afsluitingen</h3><p>Maak de eerste afsluiting aan. Synthetische voorbeelden blijven uitsluitend beschikbaar onder /demo.</p></div>:
              <div className="table">{closes.map((close)=><Link href={`/app/close/${close.id}`} className="tr" key={close.id}><span><b>{close.trading_date}</b></span><span>{venues?.find((venue)=>venue.id===close.venue_id)?.name??"Vestiging"}</span><span>{close.status}</span><span>Open bewijs →</span></Link>)}</div>}
          </section>
        </>:<section className="panel"><div className="empty-state"><h2>{activeLabel}</h2><p>Deze beveiligde module bevat geen fictieve klantcijfers. Configureer of importeer geverifieerde gegevens om de workflow te starten.</p></div></section>}
      </div>
    </main>
  </div>;
}
