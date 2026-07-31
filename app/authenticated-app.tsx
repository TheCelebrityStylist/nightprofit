import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { getTranslations } from "../lib/i18n/server";
import type { Dictionary } from "../lib/i18n";
import { LocaleSwitcher } from "./locale-switcher";
import { CloseForm } from "./close-form";
import "./real-app.css";

const navigation = [
  ["commandCenter", "/app/dashboard"],
  ["nightlyClose", "/app/close"],
  ["events", "/app/events"],
  ["bookings", "/app/bookings"],
  ["suppliers", "/app/suppliers"],
  ["margins", "/app/margins"],
  ["yield", "/app/yield"],
  ["compliance", "/app/compliance"],
  ["alerts", "/app/alerts"],
  ["reports", "/app/reports"],
  ["integrations", "/app/integrations"],
  ["settings", "/app/settings"],
  ["billing", "/app/billing"],
] as const satisfies ReadonlyArray<readonly [keyof Dictionary["nav"], string]>;

export async function AuthenticatedApp({ path }: { path: string }) {
  const { locale, t } = await getTranslations();
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
  const activeKey = navigation.find(([, href]) => path===href)?.[0] ?? "commandCenter";
  const activeLabel = t.nav[activeKey];
  const submitted = closes?.filter((close) => close.status==="submitted").length ?? 0;
  const approved = closes?.filter((close) => close.status==="approved"||close.status==="locked").length ?? 0;

  return <div className="app-shell real-app">
    <aside>
      <Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link>
      <div className="venue" aria-label={t.shell.currentOrganisation}>
        <span>{organisation.name.slice(0,2).toUpperCase()}</span>
        <div><b>{organisation.name}</b><small>{venues?.length ?? 0} {t.shell.venuesSuffix} · {organisation.currency}</small></div>
      </div>
      <nav>{navigation.map(([key,href])=><Link key={href} href={href} className={path===href?"active":""}>{t.nav[key]}</Link>)}</nav>
      <div className="aside-foot"><span>{t.shell.securedTenantData}</span><p>{selectedMembership.role}</p></div>
    </aside>
    <main className="app-main">
      <header className="topbar">
        <div><b>{organisation.name}</b><small>{venues?.map((venue)=>venue.name).join(" · ")||t.shell.noVenue}</small></div>
        <div className="top-actions">
          <LocaleSwitcher locale={locale} label={t.locale.switchLabel}/>
          <form action="/api/auth/logout" method="post"><button className="ghost">{t.shell.logout}</button></form>
        </div>
      </header>
      <div className="content">
        <section className="hero-row">
          <div><div className="eyebrow">{t.shell.liveSupabase}</div><h1>{activeLabel}</h1><p>{t.shell.heroLead}</p></div>
          {path==="/app/close"&&<Link className="primary" href="/app/close/new">{t.shell.newClose}</Link>}
        </section>
        {path==="/app/close/new"?<section className="panel"><CloseForm organisationId={organisation.id} venues={venues??[]} locale={locale}/></section>:path==="/app/dashboard"?<>
          <section className="metric-grid">
            <article className="metric"><span>{t.dashboard.metricVenues}</span><strong>{venues?.length ?? 0}</strong><small>{t.dashboard.metricVenuesNote}</small></article>
            <article className="metric"><span>{t.dashboard.metricSubmitted}</span><strong>{submitted}</strong><small>{t.dashboard.metricSubmittedNote}</small></article>
            <article className="metric"><span>{t.dashboard.metricApproved}</span><strong>{approved}</strong><small>{t.dashboard.metricApprovedNote}</small></article>
          </section>
          <section className="panel recent">
            <header><div><h3>{t.dashboard.recentTitle}</h3><p>{t.dashboard.recentSubtitle}</p></div></header>
            {!closes?.length?<div className="empty-state"><h3>{t.dashboard.emptyTitle}</h3><p>{t.dashboard.emptyBody}</p></div>:
              <div className="table">{closes.map((close)=><Link href={`/app/close/${close.id}`} className="tr" key={close.id}><span><b>{close.trading_date}</b></span><span>{venues?.find((venue)=>venue.id===close.venue_id)?.name??t.dashboard.venueFallback}</span><span>{close.status}</span><span>{t.dashboard.openEvidence}</span></Link>)}</div>}
          </section>
        </>:<section className="panel"><div className="empty-state"><h2>{activeLabel}</h2><p>{t.dashboard.moduleEmptyBody}</p></div></section>}
      </div>
    </main>
  </div>;
}
