import Link from "next/link";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { AuthForm } from "./auth-form";
import { CloseForm } from "./close-form";
import { CloseWorkspace } from "./close-workspace";
import { OnboardingForm } from "./onboarding/onboarding-form";
import { WorkflowForm } from "./workflow-form";
import "./real-app.css";

const navigation = [
  ["Vandaag", "/app/dashboard"], ["Plan & Rooster", "/app/planning"], ["Nightly Close", "/app/close"],
  ["Groepsboekingen", "/app/bookings"], ["Inkoop & Contracten", "/app/suppliers"],
  ["Events & Yield", "/app/yield"], ["Team & Compliance", "/app/compliance"],
  ["Alerts & Actions", "/app/alerts"], ["Reports", "/app/reports"],
  ["Integrations", "/app/integrations"], ["Settings", "/app/settings"], ["Billing", "/app/billing"],
] as const;

type Venue = {id:string;name:string;timezone:string};
type Close = {id:string;venue_id:string;trading_date:string;status:string;version:number;expected_total_minor:string;accounted_total_minor:string;difference_minor:string};
type Inquiry = {id:string;venue_id:string;status:string;preferred_start:string;group_size:number;contact_name:string;occasion:string|null;budget_minor:string|null};
type Supplier = {id:string;name:string;email:string|null};
type Staff = {id:string;full_name:string;role_name:string;onboarding_status:string;preferred_language:string};
type Scenario = {id:string;venue_id:string;event_id:string;scenario:string;revenue_low_minor:string;contribution_minor:string;break_even_revenue_minor:string;missing_data:string[];created_at:string};
type EventRow = {id:string;name:string;starts_at:string};
type Incident = {id:string;venue_id:string;occurred_at:string;category:string;status:string;factual_record:string};
type Forecast = {id:string;venue_id:string;interval_start:string;interval_end:string;expected_guests:number;expected_revenue_minor:string;source_basis:string[]};
type Shift = {id:string;venue_id:string;staff_profile_id:string|null;role_name:string;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string;status:string;source:string};
type Availability = {id:string;staff_profile_id:string;starts_at:string;ends_at:string;availability:string;note:string|null};

const euro = (minor:string|number|bigint|null|undefined) => new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(BigInt(minor??0))/100);
const date = (value:string) => new Intl.DateTimeFormat("nl-NL",{dateStyle:"medium"}).format(new Date(value));
const venueOptions = (venues:Venue[]) => venues.map((venue)=>({label:venue.name,value:venue.id}));

export async function AuthenticatedApp({ path }: { path: string }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return <AuthForm mode="login"/>;
  const { data: memberships, error: membershipError } = await supabase.from("organisation_members").select("organisation_id,role").eq("user_id", user.id);
  if (membershipError) throw new Error("Membership lookup failed");
  if (!memberships?.length) return <OnboardingForm/>;
  const membership = memberships[0];
  const organisationId = membership.organisation_id;
  const [{ data: organisation }, { data: venuesData }, { data: closesData }] = await Promise.all([
    supabase.from("organisations").select("id,name,currency,timezone").eq("id", organisationId).single(),
    supabase.from("venues").select("id,name,timezone").eq("organisation_id", organisationId).order("name"),
    supabase.from("closing_sessions").select("id,venue_id,trading_date,status,version,expected_total_minor,accounted_total_minor,difference_minor").eq("organisation_id", organisationId).order("trading_date",{ascending:false}).limit(50),
  ]);
  if (!organisation) return <OnboardingForm/>;
  const venues = (venuesData ?? []) as Venue[];
  const closes = (closesData ?? []) as Close[];
  const activeLabel = navigation.find(([, href]) => path===href)?.[0] ?? (
    path.startsWith("/app/close/") ? "Nightly Close" : "Command Center"
  );

  let content: React.ReactNode;
  if (path === "/app/dashboard") content = await dashboard(supabase, organisationId, venues, closes);
  else if (path === "/app/close") content = closeList(venues, closes);
  else if (path === "/app/close/new") content = <section className="panel"><CloseForm organisationId={organisationId} venues={venues}/></section>;
  else if (path.startsWith("/app/close/")) content = await closeDetail(supabase, organisationId, path.split("/").at(-1) ?? "", venues);
  else if (path === "/app/bookings") content = await bookings(supabase, organisationId, venues);
  else if (path === "/app/planning") content = await planning(supabase, organisationId, venues);
  else if (path === "/app/suppliers") content = await suppliers(supabase, organisationId);
  else if (path === "/app/yield") content = await eventYield(supabase, organisationId, venues);
  else if (path === "/app/compliance") content = await compliance(supabase, organisationId, venues);
  else if (path === "/app/integrations") content = integrations();
  else content = <HonestEmpty title={activeLabel}/>;

  return <div className="app-shell real-app">
    <aside>
      <Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link>
      <div className="venue" aria-label="Current organisation"><span>{organisation.name.slice(0,2).toUpperCase()}</span><div><b>{organisation.name}</b><small>{venues.length} vestiging(en) · {organisation.currency}</small></div></div>
      <nav>{navigation.map(([label,href])=><Link key={href} href={href} className={path===href?"active":""}>{label}</Link>)}</nav>
      <div className="aside-foot"><span>Beveiligde tenantdata</span><p>{membership.role}</p></div>
    </aside>
    <main className="app-main">
      <header className="topbar"><div><b>{organisation.name}</b><small>{venues.map((venue)=>venue.name).join(" · ")||"Nog geen vestiging"}</small></div><form action="/api/auth/logout" method="post"><button className="ghost">Uitloggen</button></form></header>
      <div className="content">
        <section className="hero-row"><div><div className="eyebrow">NIGHTPROFIT CONTROL LOOP · LIVE</div><h1>{activeLabel}</h1><p>{path==="/app/dashboard"?"Van vraag naar bezetting, uitvoering en winst—met één geprioriteerde actielijst.":"Alle gegevens zijn beperkt tot je organisatie, rol en toegewezen vestigingen."}</p></div>{path==="/app/close"&&<Link className="primary" href="/app/close/new">Nieuwe afsluiting</Link>}</section>
        {content}
      </div>
    </main>
  </div>;
}

async function dashboard(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[], closes:Close[]) {
  const today=new Date().toISOString().slice(0,10);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const [{data:deposits},{data:quotes},{data:discrepancies},{data:policies},{data:forecasts},{data:shifts},{data:inquiries}] = await Promise.all([
    supabase.from("booking_deposits").select("id,status,amount_minor").eq("organisation_id",organisationId).in("status",["created","pending","failed"]),
    supabase.from("booking_quotes").select("id,expires_at,status").eq("organisation_id",organisationId).in("status",["approved","sent"]),
    supabase.from("contract_discrepancies").select("id,status,financial_impact_minor").eq("organisation_id",organisationId).in("status",["open","reviewing","disputed"]),
    supabase.from("compliance_policies").select("id,expires_at").eq("organisation_id",organisationId),
    supabase.from("demand_forecasts").select("id,expected_guests,expected_revenue_minor").eq("organisation_id",organisationId).gte("trading_date",today).lte("trading_date",tomorrow),
    supabase.from("staff_shifts").select("id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,staff_profile_id").eq("organisation_id",organisationId).gte("starts_at",`${today}T00:00:00`).lt("starts_at",`${tomorrow}T23:59:59`),
    supabase.from("booking_inquiries").select("id,status,preferred_start,group_size").eq("organisation_id",organisationId).in("status",["new","qualified","quoted"]),
  ]);
  const unexplained = closes.filter(close=>BigInt(close.difference_minor)!==0n);
  const unapproved = closes.filter(close=>["draft","reopened","submitted"].includes(close.status));
  const depositRows = (deposits??[]) as unknown as {id:string;status:string;amount_minor:string}[];
  const discrepancyRows = (discrepancies??[]) as unknown as {id:string;status:string;financial_impact_minor:string}[];
  const soon = Date.now()+14*86400000;
  const expiringQuotes = ((quotes??[]) as unknown as {id:string;expires_at:string}[]).filter(row=>new Date(row.expires_at).getTime()<soon);
  const expiringPolicies = ((policies??[]) as unknown as {id:string;expires_at:string|null}[]).filter(row=>row.expires_at&&new Date(row.expires_at).getTime()<soon);
  const forecastRows=(forecasts??[]) as unknown as {id:string;expected_guests:number;expected_revenue_minor:string}[];
  const shiftRows=(shifts??[]) as unknown as {id:string;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string;status:string;staff_profile_id:string|null}[];
  const inquiryRows=(inquiries??[]) as unknown as {id:string;status:string;preferred_start:string;group_size:number}[];
  const expectedRevenue=forecastRows.reduce((sum,row)=>sum+BigInt(row.expected_revenue_minor),0n);
  const laborCost=shiftRows.reduce((sum,row)=>{
    const minutes=Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes);
    return sum+(BigInt(row.hourly_cost_minor)*BigInt(Math.round(minutes)))/60n;
  },0n);
  const laborBp=expectedRevenue>0n?Number((laborCost*10000n)/expectedRevenue):0;
  const openShifts=shiftRows.filter(row=>!row.staff_profile_id||row.status==="open");
  return <>
    <section className="control-brief">
      <div><span className="ai-badge">CONTROL BRIEF · REGELGESTUURD</span><h2>{openShifts.length?`${openShifts.length} dienst(en) nog onbezet vóór publicatie.`:"De huidige bezetting heeft geen zichtbare open diensten."}</h2><p>{forecastRows.length?`${forecastRows.reduce((sum,row)=>sum+row.expected_guests,0)} gasten verwacht · ${euro(expectedRevenue)} omzet · geplande loonkosten ${euro(laborCost)}.`:"Voeg een vraagverwachting toe om omzet, bezetting en loonkosten in één besluit te verbinden."}</p></div>
      <div className="control-score"><span>Loonquote</span><strong>{(laborBp/100).toLocaleString("nl-NL",{maximumFractionDigits:1})}%</strong><small>{expectedRevenue>0n?"op verwachte omzet":"wacht op forecast"}</small></div>
    </section>
    <section className="loop-strip" aria-label="Operationele control loop"><Link href="/app/bookings">01 Vraag<small>{inquiryRows.length} open aanvragen</small></Link><Link href="/app/planning">02 Plan<small>{forecastRows.length} forecastblokken</small></Link><Link href="/app/planning">03 Bezet<small>{openShifts.length} open diensten</small></Link><Link href="/app/suppliers">04 Koop<small>{discrepancyRows.length} afwijkingen</small></Link><Link href="/app/close">05 Sluit<small>{unapproved.length} te beoordelen</small></Link></section>
    <section className="metric-grid">
      <Metric href="/app/planning" label="Verwachte omzet" value={euro(expectedRevenue)} detail={`${forecastRows.length} vraagblok(ken)`}/>
      <Metric href="/app/planning" label="Geplande loonkosten" value={euro(laborCost)} detail={`${shiftRows.length} dienst(en)`}/>
      <Metric href="/app/close" label="Onverklaard verschil" value={euro(unexplained.reduce((sum,row)=>sum+BigInt(row.difference_minor),0n))} detail={`${unexplained.length} afsluiting(en)`}/>
      <Metric href="/app/bookings" label="Openstaande deposito's" value={euro(depositRows.reduce((sum,row)=>sum+BigInt(row.amount_minor),0n))} detail={`${depositRows.length} actie(s)`}/>
      <Metric href="/app/suppliers" label="Open afwijkingen" value={String(discrepancyRows.length)} detail={euro(discrepancyRows.reduce((sum,row)=>sum+BigInt(row.financial_impact_minor),0n))}/>
      <Metric href="/app/compliance" label="Deadlines" value={String(expiringQuotes.length+expiringPolicies.length)} detail="Offertes en beleid binnen 14 dagen"/>
    </section>
    <section className="panel"><header><div><h3>Actiewachtrij</h3><p>Rechtstreeks afgeleid van records die aandacht vereisen.</p></div></header>
      {!unapproved.length&&!depositRows.length&&!discrepancyRows.length?<div className="empty-state"><h3>Geen open acties</h3><p>Voeg echte operationele records toe via de modules om de wachtrij te vullen.</p></div>:
      <div className="record-list">
        {openShifts.slice(0,3).map(row=><Link key={row.id} href="/app/planning"><b>Vul open dienst</b><span>{new Intl.DateTimeFormat("nl-NL",{weekday:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(row.starts_at))}</span><em>Plan →</em></Link>)}
        {unapproved.slice(0,4).map(row=><Link key={row.id} href={`/app/close/${row.id}`}><b>Close {row.trading_date}</b><span>{row.status} · {venues.find(v=>v.id===row.venue_id)?.name}</span><em>Controleer →</em></Link>)}
        {depositRows.slice(0,3).map(row=><Link key={row.id} href="/app/bookings"><b>Boekingsdeposito</b><span>{row.status} · {euro(row.amount_minor)}</span><em>Open →</em></Link>)}
      </div>}
    </section>
  </>;
}

function Metric({href,label,value,detail}:{href:string;label:string;value:string;detail:string}) { return <Link href={href} className="metric"><span>{label}</span><strong>{value}</strong><small>{detail} →</small></Link>; }

function closeList(venues:Venue[], closes:Close[]) { return <section className="panel"><header><div><h3>Afsluitingen</h3><p>Nieuwste handelsdatum eerst. Open een record voor bedragen, bewijs en status.</p></div></header>{!closes.length?<div className="empty-state"><h3>Nog geen afsluitingen</h3><p>Start met de eerste handelsdatum; bedragen worden server-side als gehele centen verwerkt.</p><Link className="primary" href="/app/close/new">Eerste afsluiting</Link></div>:<div className="record-list">{closes.map(close=><Link key={close.id} href={`/app/close/${close.id}`}><b>{close.trading_date} · v{close.version}</b><span>{venues.find(v=>v.id===close.venue_id)?.name} · {close.status}</span><em>{euro(close.difference_minor)} →</em></Link>)}</div>}</section>; }

async function planning(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[]) {
  const start=new Date(); start.setHours(0,0,0,0);
  const end=new Date(start); end.setDate(end.getDate()+14);
  const [{data:forecastData},{data:shiftData},{data:staffData},{data:availabilityData}]=await Promise.all([
    supabase.from("demand_forecasts").select("id,venue_id,interval_start,interval_end,expected_guests,expected_revenue_minor,source_basis").eq("organisation_id",organisationId).gte("interval_start",start.toISOString()).lt("interval_start",end.toISOString()).order("interval_start"),
    supabase.from("staff_shifts").select("id,venue_id,staff_profile_id,role_name,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source").eq("organisation_id",organisationId).gte("starts_at",start.toISOString()).lt("starts_at",end.toISOString()).order("starts_at"),
    supabase.from("staff_profiles").select("id,full_name,role_name,onboarding_status,preferred_language").eq("organisation_id",organisationId).order("full_name"),
    supabase.from("staff_availability").select("id,staff_profile_id,starts_at,ends_at,availability,note").eq("organisation_id",organisationId).gte("ends_at",start.toISOString()).lt("starts_at",end.toISOString()).order("starts_at"),
  ]);
  const forecasts=(forecastData??[]) as unknown as Forecast[];
  const shifts=(shiftData??[]) as unknown as Shift[];
  const staff=(staffData??[]) as Staff[];
  const availability=(availabilityData??[]) as unknown as Availability[];
  const staffOptions=staff.map(row=>({label:`${row.full_name} · ${row.role_name}`,value:row.id}));
  const totalRevenue=forecasts.reduce((sum,row)=>sum+BigInt(row.expected_revenue_minor),0n);
  const totalLabor=shifts.reduce((sum,row)=>{
    const minutes=Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes);
    return sum+(BigInt(row.hourly_cost_minor)*BigInt(Math.round(minutes)))/60n;
  },0n);
  const open=shifts.filter(row=>!row.staff_profile_id||row.status==="open");
  const dayKeys=Array.from(new Set([...forecasts.map(row=>row.interval_start.slice(0,10)),...shifts.map(row=>row.starts_at.slice(0,10))])).slice(0,7);
  return <div className="workflow-stack">
    <section className="planner-summary">
      <div><span>Verwachte omzet</span><strong>{euro(totalRevenue)}</strong><small>{forecasts.reduce((sum,row)=>sum+row.expected_guests,0)} gasten · 14 dagen</small></div>
      <div><span>Geplande loonkosten</span><strong>{euro(totalLabor)}</strong><small>{totalRevenue?`${Number(totalLabor*10000n/totalRevenue)/100}% van omzet`:"forecast vereist"}</small></div>
      <div><span>Bezettingsrisico</span><strong>{open.length}</strong><small>open dienst(en)</small></div>
      <div><span>Beschikbaarheid</span><strong>{availability.length}</strong><small>reacties in venster</small></div>
    </section>
    <section className="panel plan-board"><header><div><h3>Geïntegreerd planbord</h3><p>Vraag, bezetting en loonkosten per handelsdag. Concepten blijven herkenbaar totdat een manager publiceert.</p></div><span className="ai-badge">AI-READY · MENS KEURT GOED</span></header>
      {!dayKeys.length?<div className="empty-state"><h3>Bouw het eerste winstplan</h3><p>Leg eerst verwachte gasten en omzet vast. Plan daarna alleen de uren die de vraag nodig heeft.</p></div>:
      <div className="day-grid">{dayKeys.map(day=>{
        const dayForecasts=forecasts.filter(row=>row.interval_start.startsWith(day));
        const dayShifts=shifts.filter(row=>row.starts_at.startsWith(day));
        const revenue=dayForecasts.reduce((sum,row)=>sum+BigInt(row.expected_revenue_minor),0n);
        return <article key={day}><header><div><b>{new Intl.DateTimeFormat("nl-NL",{weekday:"short",day:"numeric",month:"short"}).format(new Date(`${day}T12:00:00`))}</b><small>{dayForecasts.reduce((sum,row)=>sum+row.expected_guests,0)} gasten · {euro(revenue)}</small></div><em>{dayShifts.length} diensten</em></header>
          <div className="shift-stack">{dayShifts.length?dayShifts.map(shift=><div key={shift.id} className={shift.staff_profile_id?"shift":"shift open"}><span>{new Intl.DateTimeFormat("nl-NL",{hour:"2-digit",minute:"2-digit"}).format(new Date(shift.starts_at))}</span><div><b>{shift.role_name}</b><small>{staff.find(row=>row.id===shift.staff_profile_id)?.full_name||"Open dienst"} · {shift.status}</small></div></div>):<small className="no-shifts">Nog geen bezetting</small>}</div>
        </article>;
      })}</div>}
    </section>
    <div className="planning-forms">
      <WorkflowForm organisationId={organisationId} workflow="demand_forecast" title="1. Vraag voorspellen" submitLabel="Forecast toevoegen" fields={[
        {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"startsAt",label:"Start vraagblok",type:"datetime-local",required:true},
        {name:"endsAt",label:"Einde vraagblok",type:"datetime-local",required:true},{name:"expectedGuests",label:"Verwachte gasten",type:"number",required:true},
        {name:"expectedRevenue",label:"Verwachte omzet (€)",required:true},{name:"sourceBasis",label:"Bronnen",required:true,placeholder:"Reserveringen, historie, event, weer"},
      ]}/>
      <WorkflowForm organisationId={organisationId} workflow="staff_shift" title="2. Dienst plannen" submitLabel="Dienst toevoegen" fields={[
        {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"staffProfileId",label:"Medewerker (leeg = open)",type:"select",options:staffOptions},
        {name:"roleName",label:"Rol",required:true},{name:"startsAt",label:"Start dienst",type:"datetime-local",required:true},{name:"endsAt",label:"Einde dienst",type:"datetime-local",required:true},
        {name:"breakMinutes",label:"Pauze (min)",type:"number",required:true},{name:"hourlyCost",label:"Uurkost (€)",required:true},
        {name:"status",label:"Status",type:"select",required:true,options:[{label:"Concept",value:"draft"},{label:"Open dienst",value:"open"},{label:"Publiceren",value:"published"}]},
      ]}/>
      <WorkflowForm organisationId={organisationId} workflow="availability" title="3. Beschikbaarheid verwerken" submitLabel="Beschikbaarheid opslaan" fields={[
        {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"staffProfileId",label:"Medewerker",type:"select",required:true,options:staffOptions},
        {name:"startsAt",label:"Vanaf",type:"datetime-local",required:true},{name:"endsAt",label:"Tot",type:"datetime-local",required:true},
        {name:"availability",label:"Reactie",type:"select",required:true,options:[{label:"Beschikbaar",value:"available"},{label:"Voorkeur",value:"preferred"},{label:"Niet beschikbaar",value:"unavailable"}]},
        {name:"note",label:"Notitie",placeholder:"Reden of voorkeur"},
      ]}/>
    </div>
    <section className="panel"><header><div><h3>WhatsApp-operatie</h3><p>De MaestroPlanner-kern, verbonden aan NightProfit: beschikbaarheid opvragen, open diensten vullen, ruilingen behandelen en het rooster delen.</p></div></header><div className="integration-steps"><div><b>01 Vraag op</b><span>Persoonlijke beschikbaarheidslink per periode</span></div><div><b>02 Optimaliseer</b><span>Vraag, vaardigheden, voorkeuren en loonkost als randvoorwaarden</span></div><div><b>03 Keur goed</b><span>Manager ziet conflicten en accepteert het voorstel</span></div><div><b>04 Deel</b><span>WhatsApp-bericht met dienst en bevestigingslink</span></div></div><div className="legal-note">WhatsApp-verzending vereist een goedgekeurde Business-provider en templates. NightProfit toont geen actieve koppeling totdat credentials en webhook aantoonbaar werken.</div></section>
  </div>;
}

async function closeDetail(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, closeId:string, venues:Venue[]) {
  const [{data:close},{data:lines},{data:audit},{data:canApprove},{data:canReopen}] = await Promise.all([
    supabase.from("closing_sessions").select("id,venue_id,trading_date,status,version,expected_total_minor,accounted_total_minor,difference_minor,reopened_reason").eq("organisation_id",organisationId).eq("id",closeId).single(),
    supabase.from("closing_lines").select("id,line_type,expected_minor,actual_minor,metadata,created_at").eq("organisation_id",organisationId).eq("closing_session_id",closeId).order("created_at"),
    supabase.from("audit_logs").select("id,action,actor_id,created_at,after_summary").eq("organisation_id",organisationId).eq("entity_id",closeId).order("created_at",{ascending:false}).limit(30),
    supabase.rpc("has_capability",{target_organisation_id:organisationId,target_venue_id:null,required_capability:"close.approve"}),
    supabase.rpc("has_capability",{target_organisation_id:organisationId,target_venue_id:null,required_capability:"close.reopen"}),
  ]);
  if (!close) return <HonestEmpty title="Afsluiting niet gevonden"/>;
  const row=close as unknown as Close&{reopened_reason:string|null};
  const lineRows=(lines??[]) as unknown as {id:string;line_type:string;expected_minor:string;actual_minor:string;metadata:{note?:string}}[];
  const expected=lineRows.reduce((sum,line)=>sum+BigInt(line.expected_minor),0n);
  const actual=lineRows.reduce((sum,line)=>sum+BigInt(line.actual_minor),0n);
  return <div className="workflow-stack">
    <section className="detail-head"><div><span className={`status ${row.status}`}>{row.status}</span><h2>{row.trading_date} · versie {row.version}</h2><p>{venues.find(v=>v.id===row.venue_id)?.name}{row.reopened_reason?` · Heropend: ${row.reopened_reason}`:""}</p></div><div className="money-summary"><span>Verwacht <b>{euro(expected)}</b></span><span>Werkelijk <b>{euro(actual)}</b></span><span>Verschil <b>{euro(actual-expected)}</b></span></div></section>
    <CloseWorkspace organisationId={organisationId} closeId={closeId} status={row.status} canApprove={Boolean(canApprove)} canReopen={Boolean(canReopen)}/>
    <section className="panel"><header><div><h3>Bedragregels</h3><p>De totalen worden bij iedere statusovergang opnieuw in PostgreSQL berekend.</p></div></header>{!lineRows.length?<div className="empty-state"><p>Voeg de eerste verwachte en werkelijke bron toe.</p></div>:<div className="record-list">{lineRows.map(line=><div className="record-row" key={line.id}><b>{line.line_type.replaceAll("_"," ")}</b><span>{line.metadata.note||"Geen toelichting"}</span><em>{euro(line.expected_minor)} → {euro(line.actual_minor)}</em></div>)}</div>}</section>
    <section className="panel"><header><div><h3>Auditlijn</h3><p>Actor-ID en tijdstip voor iedere materiële bewerking.</p></div></header><div className="record-list">{((audit??[]) as unknown as {id:string;action:string;actor_id:string;created_at:string}[]).map(item=><div className="record-row" key={item.id}><b>{item.action}</b><span>{item.actor_id}</span><em>{date(item.created_at)}</em></div>)}</div></section>
  </div>;
}

async function bookings(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[]) {
  const {data}=await supabase.from("booking_inquiries").select("id,venue_id,status,preferred_start,group_size,contact_name,occasion,budget_minor").eq("organisation_id",organisationId).order("preferred_start");
  const rows=(data??[]) as Inquiry[];
  return <div className="split-workspace"><WorkflowForm organisationId={organisationId} workflow="booking_inquiry" title="Nieuwe groepsaanvraag" submitLabel="Aanvraag vastleggen" fields={[
    {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"contactName",label:"Contactnaam",required:true},{name:"contactEmail",label:"E-mail",type:"email",required:true},
    {name:"preferredStart",label:"Gewenste datum en tijd",type:"datetime-local",required:true},{name:"groupSize",label:"Aantal gasten",type:"number",required:true},
    {name:"budget",label:"Budget (€)",placeholder:"1500,00"},{name:"occasion",label:"Gelegenheid"},{name:"source",label:"Bron",required:true,placeholder:"Website, telefoon, partner…"},
    {name:"preferences",label:"Voorkeuren en toegankelijkheid",type:"textarea"},
  ]}/><RecordPanel title="Aanvraagpipeline" empty="Nog geen groepsaanvragen.">{rows.map(row=><div className="record-row" key={row.id}><b>{row.contact_name} · {row.group_size} gasten</b><span>{date(row.preferred_start)} · {row.occasion||"Geen gelegenheid"} · {row.status}</span><em>{row.budget_minor?euro(row.budget_minor):"Budget onbekend"}</em></div>)}</RecordPanel></div>;
}

async function suppliers(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string) {
  const [{data:supplierData},{data:contracts},{data:discrepancies}]=await Promise.all([
    supabase.from("suppliers").select("id,name,email").eq("organisation_id",organisationId).order("name"),
    supabase.from("supplier_contracts").select("id,name,status,start_date,end_date,notice_deadline").eq("organisation_id",organisationId).order("notice_deadline"),
    supabase.from("contract_discrepancies").select("id,discrepancy_type,status,financial_impact_minor,recommended_check").eq("organisation_id",organisationId).order("created_at",{ascending:false}),
  ]);
  const rows=(supplierData??[]) as Supplier[];
  return <div className="workflow-stack"><div className="split-workspace"><WorkflowForm organisationId={organisationId} workflow="supplier" title="Leverancier toevoegen" submitLabel="Leverancier opslaan" fields={[
    {name:"name",label:"Naam",required:true},{name:"contactEmail",label:"Contact e-mail",type:"email"},
  ]}/><RecordPanel title="Leveranciers" empty="Nog geen leveranciers.">{rows.map(row=><div className="record-row" key={row.id}><b>{row.name}</b><span>{row.email||"Geen e-mail"}</span><em>Profiel →</em></div>)}</RecordPanel></div>
  <RecordPanel title="Contracten en afwijkingen" empty="Leg eerst een leverancier en contractversie vast.">{((contracts??[]) as unknown as {id:string;name:string;status:string;notice_deadline:string|null}[]).map(row=><div className="record-row" key={row.id}><b>{row.name}</b><span>{row.status}</span><em>{row.notice_deadline?`Opzegdeadline ${date(row.notice_deadline)}`:"Geen deadline"}</em></div>)}{((discrepancies??[]) as unknown as {id:string;discrepancy_type:string;status:string;financial_impact_minor:string;recommended_check:string}[]).map(row=><div className="record-row" key={row.id}><b>Neutrale afwijking: {row.discrepancy_type}</b><span>{row.recommended_check}</span><em>{euro(row.financial_impact_minor)} · {row.status}</em></div>)}</RecordPanel></div>;
}

async function eventYield(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[]) {
  const [{data:scenarioData},{data:eventData}]=await Promise.all([
    supabase.from("event_yield_scenarios").select("id,venue_id,event_id,scenario,revenue_low_minor,contribution_minor,break_even_revenue_minor,missing_data,created_at").eq("organisation_id",organisationId).order("created_at",{ascending:false}),
    supabase.from("events").select("id,name,starts_at").eq("organisation_id",organisationId),
  ]);
  const rows=(scenarioData??[]) as unknown as Scenario[]; const events=(eventData??[]) as EventRow[];
  return <div className="split-workspace"><WorkflowForm organisationId={organisationId} workflow="event_yield" title="Deterministisch basisscenario" submitLabel="Scenario berekenen" fields={[
    {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"name",label:"Eventnaam",required:true},{name:"startsAt",label:"Start",type:"datetime-local",required:true},{name:"attendance",label:"Verwachte bezoekers",type:"number",required:true},
    {name:"ticketRevenue",label:"Ticketomzet (€)",required:true},{name:"barRevenue",label:"Baromzet (€)",required:true},{name:"staffing",label:"Personeel (€)",required:true},{name:"security",label:"Beveiliging (€)",required:true},
    {name:"entertainment",label:"Entertainment (€)",required:true},{name:"stock",label:"Voorraad/inkoop (€)",required:true},{name:"otherCosts",label:"Overige kosten (€)",required:true},
  ]}/><RecordPanel title="Scenario's" empty="Nog geen scenario's.">{rows.map(row=><div className="record-row" key={row.id}><b>{events.find(event=>event.id===row.event_id)?.name||"Event"} · {row.scenario}</b><span>Omzet {euro(row.revenue_low_minor)} · break-even {euro(row.break_even_revenue_minor)}</span><em>Bijdrage {euro(row.contribution_minor)}<small>Deterministische modus · geen ML-confidence</small></em></div>)}</RecordPanel></div>;
}

async function compliance(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[]) {
  const [{data:staffData},{data:incidentData}]=await Promise.all([
    supabase.from("staff_profiles").select("id,full_name,role_name,onboarding_status,preferred_language").eq("organisation_id",organisationId).order("full_name"),
    supabase.from("staff_incidents").select("id,venue_id,occurred_at,category,status,factual_record").eq("organisation_id",organisationId).order("occurred_at",{ascending:false}),
  ]);
  const staff=(staffData??[]) as Staff[]; const incidents=(incidentData??[]) as unknown as Incident[];
  return <div className="workflow-stack"><div className="legal-note">NightProfit helpt beleid en bewijs organiseren. De klant blijft verantwoordelijk voor toepasselijke wetgeving, beleid en deskundig advies.</div><div className="split-workspace">
    <WorkflowForm organisationId={organisationId} workflow="staff_profile" title="Beperkt medewerkersprofiel" submitLabel="Profiel aanmaken" fields={[
      {name:"fullName",label:"Volledige naam",required:true},{name:"contactEmail",label:"E-mail",type:"email"},{name:"roleName",label:"Functie",required:true},{name:"engagementType",label:"Type inzet",required:true},
      {name:"preferredLanguage",label:"Voorkeurstaal",type:"select",required:true,options:[{label:"Nederlands",value:"nl"},{label:"English",value:"en"}]},{name:"startDate",label:"Startdatum",type:"date",required:true},
    ]}/><RecordPanel title="Onboarding" empty="Nog geen beperkte medewerkersprofielen.">{staff.map(row=><div className="record-row" key={row.id}><b>{row.full_name}</b><span>{row.role_name} · {row.preferred_language.toUpperCase()}</span><em>{row.onboarding_status}</em></div>)}</RecordPanel></div>
    <div className="split-workspace"><WorkflowForm organisationId={organisationId} workflow="incident" title="Feitelijk incident vastleggen" submitLabel="Conceptincident opslaan" fields={[
      {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"occurredAt",label:"Datum en tijd",type:"datetime-local",required:true},{name:"category",label:"Categorie",required:true},
      {name:"factualRecord",label:"Feitelijke beschrijving",type:"textarea",required:true},{name:"witnesses",label:"Getuigen",type:"textarea"},{name:"actions",label:"Ondernomen acties",type:"textarea"},
    ]}/><RecordPanel title="Beperkte incidenten" empty="Geen incidenten vastgelegd.">{incidents.map(row=><div className="record-row" key={row.id}><b>{row.category} · {date(row.occurred_at)}</b><span>{row.factual_record}</span><em>{row.status}</em></div>)}</RecordPanel></div></div>;
}

function integrations() {
  const configured=(name:string)=>Boolean(process.env[name]);
  const rows=[
    ["Supabase auth/database/storage",configured("NEXT_PUBLIC_SUPABASE_URL")&&configured("NEXT_PUBLIC_SUPABASE_ANON_KEY"),"Runtimeconfiguratie aanwezig; credentialtest via browser nog geblokkeerd door Sites-allowlist."],
    ["Stripe billing en deposito's",configured("STRIPE_SECRET_KEY")&&configured("STRIPE_WEBHOOK_SECRET"),"Serverconfiguratie; testmodebewijs blijft vereist."],
    ["OpenAI extractie",configured("OPENAI_API_KEY"),"Optioneel: voorstellen zijn nooit financieel gezaghebbend."],
    ["E-mailprovider",configured("RESEND_API_KEY"),"Bij ontbreken: kopieerbare link en handmatig verzenden."],
    ["Scheduled jobs/cron",configured("CRON_SECRET"),"Geen geplande uitvoering claimen zonder credentialtest."],
    ["CSV/manual fallback",true,"Beschikbaar als operationele fallback."],
  ];
  return <section className="panel"><div className="record-list">{rows.map(([label,ok,detail])=><div className="record-row" key={String(label)}><b>{label}</b><span>{detail}</span><em className={ok?"ok":"warn"}>{ok?"Geconfigureerd":"Configuratie vereist"}</em></div>)}</div></section>;
}

function RecordPanel({title,empty,children}:{title:string;empty:string;children:React.ReactNode}) {
  const list=Array.isArray(children)?children.filter(Boolean):children;
  const isEmpty=Array.isArray(list)&&list.length===0;
  return <section className="panel record-panel"><header><div><h3>{title}</h3></div></header>{isEmpty?<div className="empty-state"><p>{empty}</p></div>:<div className="record-list">{list}</div>}</section>;
}
function HonestEmpty({title}:{title:string}) { return <section className="panel"><div className="empty-state"><h2>{title}</h2><p>Deze route bevat nog geen geverifieerde gegevens of actieve workflow. Er worden geen fictieve productieclaims getoond.</p></div></section>; }
