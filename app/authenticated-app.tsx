import Link from "next/link";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { AuthForm } from "./auth-form";
import { CloseForm } from "./close-form";
import { CloseWorkspace } from "./close-workspace";
import { OnboardingForm } from "./onboarding/onboarding-form";
import { WorkflowForm } from "./workflow-form";
import "./real-app.css";

const navigation = [
  ["Vandaag", "/app/dashboard"], ["Sales & Demand", "/app/bookings"],
  ["Plan & Rooster", "/app/planning"], ["Inkoop & Marge", "/app/suppliers"],
  ["Mijn werk", "/app/my-work"],
  ["Close & Learn", "/app/close"],
  ["Event Yield", "/app/yield"], ["Team & Compliance", "/app/compliance"],
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

const euro = (minor:string|number|bigint|null|undefined) => new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(BigInt(minor??0))/100);
const date = (value:string) => new Intl.DateTimeFormat("nl-NL",{dateStyle:"medium"}).format(new Date(value));
const venueOptions = (venues:Venue[]) => venues.map((venue)=>({label:venue.name,value:venue.id}));

export async function AuthenticatedApp({ path }: { path: string }) {
  const supabase = await createSupabaseServerClient().catch(()=>null);
  if(!supabase)return <AuthForm mode="login"/>;
  const authResult = await supabase.auth.getUser().catch(()=>null);
  if(!authResult)return <AuthForm mode="login"/>;
  const { data: { user }, error: authError } = authResult;
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
  else if (path === "/app/my-work") content = await myWork(supabase, organisationId, venues, user.id);
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
        <section className="hero-row"><div><div className="eyebrow">LIVE · SUPABASE</div><h1>{activeLabel}</h1><p>Alle gegevens zijn beperkt tot je organisatie, rol en toegewezen vestigingen.</p></div>{path==="/app/close"&&<Link className="primary" href="/app/close/new">Nieuwe afsluiting</Link>}</section>
        {content}
      </div>
    </main>
  </div>;
}

async function dashboard(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[], closes:Close[]) {
  const today=new Date().toISOString().slice(0,10);
  const dayStart=`${today}T00:00:00.000Z`,dayEnd=`${today}T23:59:59.999Z`;
  const [{data:deposits},{data:quotes},{data:discrepancies},{data:policies},{data:intervals},{data:shifts},{data:actions}] = await Promise.all([
    supabase.from("booking_deposits").select("id,status,amount_minor").eq("organisation_id",organisationId).in("status",["created","pending","failed"]),
    supabase.from("booking_quotes").select("id,expires_at,status").eq("organisation_id",organisationId).in("status",["approved","sent"]),
    supabase.from("contract_discrepancies").select("id,status,financial_impact_minor").eq("organisation_id",organisationId).in("status",["open","reviewing","disputed"]),
    supabase.from("compliance_policies").select("id,expires_at").eq("organisation_id",organisationId),
    supabase.from("demand_forecast_intervals").select("id,venue_id,expected_guests,expected_revenue_minor,required_staff,starts_at,ends_at").eq("organisation_id",organisationId).gte("starts_at",dayStart).lte("starts_at",dayEnd),
    supabase.from("shifts").select("id,venue_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status").eq("organisation_id",organisationId).gte("starts_at",dayStart).lte("starts_at",dayEnd).not("status","in","(cancelled,rejected)"),
    supabase.from("operating_actions").select("id,title,rationale,severity,status,due_at,expected_impact_minor,venue_id").eq("organisation_id",organisationId).in("status",["open","approved","in_progress"]).order("created_at",{ascending:false}).limit(20),
  ]);
  const unexplained = closes.filter(close=>BigInt(close.difference_minor)!==0n);
  const unapproved = closes.filter(close=>["draft","reopened","submitted"].includes(close.status));
  const depositRows = (deposits??[]) as unknown as {id:string;status:string;amount_minor:string}[];
  const discrepancyRows = (discrepancies??[]) as unknown as {id:string;status:string;financial_impact_minor:string}[];
  const soon = Date.now()+14*86400000;
  const expiringQuotes = ((quotes??[]) as unknown as {id:string;expires_at:string}[]).filter(row=>new Date(row.expires_at).getTime()<soon);
  const expiringPolicies = ((policies??[]) as unknown as {id:string;expires_at:string|null}[]).filter(row=>row.expires_at&&new Date(row.expires_at).getTime()<soon);
  const intervalRows=(intervals??[]) as unknown as {id:string;expected_guests:number;expected_revenue_minor:string;required_staff:number}[];
  const shiftRows=(shifts??[]) as unknown as {id:string;staff_id:string|null;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string;status:string}[];
  const expectedGuests=intervalRows.reduce((sum,row)=>sum+row.expected_guests,0);
  const expectedRevenue=intervalRows.reduce((sum,row)=>sum+BigInt(row.expected_revenue_minor),0n);
  const scheduledLabor=shiftRows.reduce((sum,row)=>{
    const minutes=Math.max(0,Math.floor((new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000)-row.break_minutes);
    return sum+(BigInt(row.hourly_cost_minor)*BigInt(minutes)+30n)/60n;
  },0n);
  const laborBps=expectedRevenue===0n?0n:(scheduledLabor*10000n)/expectedRevenue;
  const actionRows=(actions??[]) as unknown as {id:string;title:string;rationale:string;severity:string;due_at:string|null;expected_impact_minor:string|null}[];
  return <>
    <section className="morning-brief"><div><span className="eyebrow">OCHTENDBRIEF · {today}</span><h2>{intervalRows.length?`${expectedGuests} gasten verwacht met ${euro(expectedRevenue)} omzet.`:"Nog geen intervalforecast voor vandaag."}</h2><p>{shiftRows.length?`${shiftRows.length} geplande diensten · ${euro(scheduledLabor)} loonkosten · ${Number(laborBps)/100}% van forecastomzet.`:"Plan diensten vanuit de vraag om bezettingsrisico zichtbaar te maken."}</p></div><Link className="primary" href="/app/planning">Open planning</Link></section>
    <section className="metric-grid">
      <Metric href="/app/planning" label="Verwachte gasten vandaag" value={String(expectedGuests)} detail={`${intervalRows.length} vraaginterval(len)`}/>
      <Metric href="/app/planning" label="Geplande loonkosten" value={euro(scheduledLabor)} detail={`${Number(laborBps)/100}% van forecastomzet`}/>
      <Metric href="/app/close" label="Onverklaard closeverschil" value={euro(unexplained.reduce((sum,row)=>sum+BigInt(row.difference_minor),0n))} detail={`${unexplained.length} afsluiting(en)`}/>
      <Metric href="/app/close" label="Niet goedgekeurd" value={String(unapproved.length)} detail="Concept, heropend of ingediend"/>
      <Metric href="/app/bookings" label="Openstaande deposito's" value={euro(depositRows.reduce((sum,row)=>sum+BigInt(row.amount_minor),0n))} detail={`${depositRows.length} actie(s)`}/>
      <Metric href="/app/bookings" label="Offertes verlopen binnenkort" value={String(expiringQuotes.length)} detail="Binnen veertien dagen"/>
      <Metric href="/app/suppliers" label="Open afwijkingen" value={String(discrepancyRows.length)} detail={euro(discrepancyRows.reduce((sum,row)=>sum+BigInt(row.financial_impact_minor),0n))}/>
      <Metric href="/app/compliance" label="Beleid verloopt binnenkort" value={String(expiringPolicies.length)} detail="Controleer vervanging en toewijzing"/>
    </section>
    <section className="panel"><header><div><h3>Prioritaire actiewachtrij</h3><p>Iedere actie heeft een reden, status, deadline en bewijscontext.</p></div></header>
      {!unapproved.length&&!depositRows.length&&!discrepancyRows.length&&!actionRows.length?<div className="empty-state"><h3>Geen open acties</h3><p>Voeg forecast-, boekings- of closegegevens toe om beslisregels te activeren.</p></div>:
      <div className="record-list">
        {actionRows.map(row=><Link key={row.id} href="/app/alerts"><b><span className={`severity ${row.severity}`}>{row.severity}</span> {row.title}</b><span>{row.rationale}</span><em>{row.expected_impact_minor?euro(row.expected_impact_minor):"Impact niet gekwantificeerd"}{row.due_at?<small>Voor {date(row.due_at)}</small>:null}</em></Link>)}
        {unapproved.slice(0,5).map(row=><Link key={row.id} href={`/app/close/${row.id}`}><b>Close {row.trading_date}</b><span>{row.status} · {venues.find(v=>v.id===row.venue_id)?.name}</span><em>Open →</em></Link>)}
        {depositRows.slice(0,3).map(row=><Link key={row.id} href="/app/bookings"><b>Boekingsdeposito</b><span>{row.status} · {euro(row.amount_minor)}</span><em>Open →</em></Link>)}
      </div>}
    </section>
  </>;
}

async function planning(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[]) {
  const [{data:departmentData},{data:roleData},{data:staffData},{data:intervalData},{data:shiftData},{data:proposalData}]=await Promise.all([
    supabase.from("departments").select("id,venue_id,name").eq("organisation_id",organisationId).order("name"),
    supabase.from("operational_roles").select("id,department_id,name,hourly_cost_minor,minimum_staff,guests_per_staff").eq("organisation_id",organisationId).order("name"),
    supabase.from("staff_profiles").select("id,full_name,role_name").eq("organisation_id",organisationId).order("full_name"),
    supabase.from("demand_forecast_intervals").select("id,venue_id,starts_at,ends_at,expected_guests,expected_revenue_minor,required_staff").eq("organisation_id",organisationId).order("starts_at",{ascending:false}).limit(30),
    supabase.from("shifts").select("id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status").eq("organisation_id",organisationId).order("starts_at",{ascending:false}).limit(50),
    supabase.from("ai_proposals").select("id,action_type,rationale,proposed_change,missing_data,confidence_basis,approval_status,execution_status,created_at").eq("organisation_id",organisationId).eq("action_type","schedule_proposal").order("created_at",{ascending:false}).limit(10),
  ]);
  const departments=(departmentData??[]) as unknown as {id:string;venue_id:string;name:string}[];
  const roles=(roleData??[]) as unknown as {id:string;department_id:string;name:string;hourly_cost_minor:string;minimum_staff:number;guests_per_staff:number}[];
  const staff=(staffData??[]) as unknown as {id:string;full_name:string;role_name:string}[];
  const intervals=(intervalData??[]) as unknown as {id:string;venue_id:string;starts_at:string;ends_at:string;expected_guests:number;expected_revenue_minor:string;required_staff:number}[];
  const shifts=(shiftData??[]) as unknown as {id:string;venue_id:string;department_id:string;role_id:string;staff_id:string|null;starts_at:string;ends_at:string;break_minutes:number;hourly_cost_minor:string;status:string}[];
  const proposals=(proposalData??[]) as unknown as {id:string;rationale:string;missing_data:string[];confidence_basis:string;approval_status:string;execution_status:string;created_at:string}[];
  const departmentOptions=departments.map(row=>({label:row.name,value:row.id}));
  const roleOptions=roles.map(row=>({label:row.name,value:row.id}));
  const staffOptions=[{label:"Open dienst",value:"open"},...staff.map(row=>({label:`${row.full_name} · ${row.role_name}`,value:row.id}))];
  return <div className="workflow-stack">
    <section className="connected-flow"><span>Vraag</span><b>→</b><span>Forecast</span><b>→</b><span>Rooster</span><b>→</b><span>Publicatie</span><b>→</b><span>Uren</span><b>→</b><span>Close & Learn</span></section>
    <div className="split-workspace">
      <WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="forecast" title="Vraaginterval plannen" submitLabel="Forecast opslaan" fields={[
        {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"tradingDate",label:"Handelsdatum",type:"date",required:true},
        {name:"startsAt",label:"Interval start",type:"datetime-local",required:true},{name:"endsAt",label:"Interval einde",type:"datetime-local",required:true},
        {name:"expectedGuests",label:"Verwachte gasten",type:"number",required:true},{name:"expectedRevenue",label:"Verwachte omzet (€)",required:true},
        {name:"minimumStaff",label:"Minimale bezetting",type:"number",required:true},{name:"guestsPerStaff",label:"Gasten per medewerker",type:"number",required:true},
        {name:"managerNote",label:"Aannames en context",type:"textarea"},
      ]}/>
      <RecordPanel title="Vraag per tijdsblok" empty="Nog geen intervalforecast.">{intervals.map(row=><div className="record-row" key={row.id}><b>{new Date(row.starts_at).toLocaleString("nl-NL",{dateStyle:"short",timeStyle:"short"})}</b><span>{row.expected_guests} gasten · {row.required_staff} medewerkers vereist</span><em>{euro(row.expected_revenue_minor)}</em></div>)}</RecordPanel>
    </div>
    {!departments.length?<div className="split-workspace">
      <WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="department" title="Eerste afdeling" submitLabel="Afdeling toevoegen" fields={[{name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"name",label:"Afdelingsnaam",required:true,placeholder:"Bar, keuken, bediening…"}]}/>
      <div className="legal-note">Maak eerst een afdeling aan. Daarna kun je operationele rollen en diensten plannen.</div>
    </div>:!roles.length?<WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="role" title="Eerste operationele rol" submitLabel="Rol toevoegen" fields={[
      {name:"departmentId",label:"Afdeling",type:"select",required:true,options:departmentOptions},{name:"name",label:"Rolnaam",required:true},{name:"hourlyCost",label:"All-in uurkosten (€)",required:true},
      {name:"minimumStaff",label:"Minimale bezetting",type:"number",required:true},{name:"guestsPerStaff",label:"Gasten per medewerker",type:"number",required:true},
    ]}/>:<div className="split-workspace">
      <WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="shift" title="Conceptdienst" submitLabel="Dienst toevoegen" fields={[
        {name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"departmentId",label:"Afdeling",type:"select",required:true,options:departmentOptions},
        {name:"roleId",label:"Rol",type:"select",required:true,options:roleOptions},{name:"staffId",label:"Medewerker",type:"select",required:true,options:staffOptions},
        {name:"startsAt",label:"Start",type:"datetime-local",required:true},{name:"endsAt",label:"Einde",type:"datetime-local",required:true},{name:"breakMinutes",label:"Pauze (min)",type:"number",required:true},{name:"hourlyCost",label:"Uurkosten (€)",required:true},
      ]}/>
      <RecordPanel title="Rooster · concept en gepubliceerd" empty="Nog geen diensten.">{shifts.map(row=><div className="record-row" key={row.id}><b>{staff.find(person=>person.id===row.staff_id)?.full_name||"Open dienst"} · {roles.find(role=>role.id===row.role_id)?.name||"Rol"}</b><span>{new Date(row.starts_at).toLocaleString("nl-NL",{dateStyle:"short",timeStyle:"short"})}–{new Date(row.ends_at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</span><em>{row.status}</em></div>)}</RecordPanel>
    </div>}
    <div className="split-workspace">
      <WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="publish" title="Rooster publiceren" submitLabel="Gecontroleerd publiceren" fields={[{name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"startsAt",label:"Periode start",type:"datetime-local",required:true},{name:"endsAt",label:"Periode einde",type:"datetime-local",required:true}]}/>
      <WorkflowForm endpoint="/api/planning" organisationId={organisationId} workflow="proposal" title="Uitlegbare roostercontrole" submitLabel="Voorstel genereren" fields={[{name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues)},{name:"tradingDate",label:"Handelsdatum",type:"date",required:true}]}/>
    </div>
    <RecordPanel title="Governed voorstellen" empty="Nog geen planningvoorstellen.">{proposals.map(row=><div className="record-row" key={row.id}><b>{row.approval_status} · {date(row.created_at)}</b><span>{row.rationale}<small>{row.confidence_basis}</small></span><em>{row.execution_status}{row.missing_data.length?<small>{row.missing_data.join(" ")}</small>:null}</em></div>)}</RecordPanel>
  </div>;
}

async function myWork(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>, organisationId:string, venues:Venue[], userId:string){
  const {data:profile}=await supabase.from("staff_profiles").select("id,full_name").eq("organisation_id",organisationId).eq("auth_user_id",userId).maybeSingle();
  if(!profile)return <section className="panel"><div className="empty-state"><h2>Medewerkersprofiel vereist</h2><p>Vraag je manager om je account aan een medewerkersprofiel te koppelen.</p></div></section>;
  const staff=profile as unknown as {id:string;full_name:string};
  const [{data:shiftData},{data:responseData},{data:timeData},{data:availabilityData}]=await Promise.all([
    supabase.from("shifts").select("id,venue_id,starts_at,ends_at,break_minutes,status").eq("organisation_id",organisationId).eq("staff_id",staff.id).gte("ends_at",new Date().toISOString()).order("starts_at").limit(14),
    supabase.from("shift_responses").select("shift_id,response").eq("organisation_id",organisationId).eq("staff_id",staff.id),
    supabase.from("time_records").select("id,venue_id,clocked_in_at,clocked_out_at,break_minutes,status,approved_at").eq("organisation_id",organisationId).eq("staff_id",staff.id).order("clocked_in_at",{ascending:false}).limit(14),
    supabase.from("staff_availability").select("id,starts_at,ends_at,availability").eq("organisation_id",organisationId).eq("staff_id",staff.id).gte("ends_at",new Date().toISOString()).order("starts_at").limit(14),
  ]);
  const shifts=(shiftData??[]) as unknown as {id:string;venue_id:string;starts_at:string;ends_at:string;break_minutes:number;status:string}[];
  const responses=(responseData??[]) as unknown as {shift_id:string;response:string}[];
  const records=(timeData??[]) as unknown as {id:string;venue_id:string;clocked_in_at:string;clocked_out_at:string|null;break_minutes:number;status:string;approved_at:string|null}[];
  const availability=(availabilityData??[]) as unknown as {id:string;starts_at:string;ends_at:string;availability:string}[];
  const openRecord=records.find(record=>!record.clocked_out_at);
  const next=shifts[0];
  return <div className="workflow-stack employee-work">
    <section className="morning-brief"><div><div className="eyebrow">MIJN WERK · {staff.full_name}</div><h2>{next?`Volgende dienst ${new Date(next.starts_at).toLocaleString("nl-NL",{weekday:"long",hour:"2-digit",minute:"2-digit"})}`:"Geen komende dienst"}</h2><p>Alleen jouw rooster, beschikbaarheid en uren zijn hier zichtbaar.</p></div><span className="status">{openRecord?"ingeklokt":"niet ingeklokt"}</span></section>
    {openRecord?<WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="clock_out" title="Lopende dienst" submitLabel="Uitklokken en indienen" fields={[{name:"timeRecordId",label:"Urenrecord",type:"select",required:true,options:[{label:`Gestart ${new Date(openRecord.clocked_in_at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}`,value:openRecord.id}]}]}/>:next?<WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="clock_in" title="Aanwezigheid" submitLabel="Inklokken" fields={[{name:"venueId",label:"Vestiging",type:"select",required:true,options:venueOptions(venues.filter(v=>v.id===next.venue_id))},{name:"shiftId",label:"Dienst",type:"select",required:true,options:[{label:new Date(next.starts_at).toLocaleString("nl-NL"),value:next.id}]}]}/>:null}
    <section className="mobile-roster" aria-label="Mijn komende rooster">{shifts.length?shifts.map(shift=><article key={shift.id}><div><b>{new Date(shift.starts_at).toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"short"})}</b><span>{new Date(shift.starts_at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}–{new Date(shift.ends_at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})} · pauze {shift.break_minutes} min</span></div><em>{responses.find(r=>r.shift_id===shift.id)?.response||shift.status}</em>{!responses.some(r=>r.shift_id===shift.id)&&shift.status==="published"?<WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="respond" title="Bevestig deze dienst" submitLabel="Antwoord opslaan" fields={[{name:"venueId",label:"Vestiging",type:"select",required:true,options:[{label:venues.find(v=>v.id===shift.venue_id)?.name||"Vestiging",value:shift.venue_id}]},{name:"shiftId",label:"Dienst",type:"select",required:true,options:[{label:new Date(shift.starts_at).toLocaleString("nl-NL"),value:shift.id}]},{name:"staffId",label:"Medewerker",type:"select",required:true,options:[{label:staff.full_name,value:staff.id}]},{name:"response",label:"Antwoord",type:"select",required:true,options:[{label:"Accepteren",value:"accepted"},{label:"Afwijzen",value:"rejected"}]},{name:"reason",label:"Reden bij afwijzing"}]}/>:null}</article>):<div className="empty-state"><p>Je hebt nog geen komende diensten.</p></div>}</section>
    <div className="split-workspace"><RecordPanel title="Beschikbaarheid" empty="Geen komende beschikbaarheid vastgelegd.">{availability.map(row=><div className="record-row" key={row.id}><b>{row.availability}</b><span>{new Date(row.starts_at).toLocaleString("nl-NL")}</span><em>tot {new Date(row.ends_at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</em></div>)}</RecordPanel><RecordPanel title="Ingediende uren" empty="Nog geen uren ingediend.">{records.map(row=><div className="record-row" key={row.id}><b>{date(row.clocked_in_at)}</b><span>{row.status} · pauze {row.break_minutes} min</span><em>{row.approved_at?"goedgekeurd":"in behandeling"}</em></div>)}</RecordPanel></div>
  </div>;
}

function Metric({href,label,value,detail}:{href:string;label:string;value:string;detail:string}) { return <Link href={href} className="metric"><span>{label}</span><strong>{value}</strong><small>{detail} →</small></Link>; }

function closeList(venues:Venue[], closes:Close[]) { return <section className="panel"><header><div><h3>Afsluitingen</h3><p>Nieuwste handelsdatum eerst. Open een record voor bedragen, bewijs en status.</p></div></header>{!closes.length?<div className="empty-state"><h3>Nog geen afsluitingen</h3><p>Start met de eerste handelsdatum; bedragen worden server-side als gehele centen verwerkt.</p><Link className="primary" href="/app/close/new">Eerste afsluiting</Link></div>:<div className="record-list">{closes.map(close=><Link key={close.id} href={`/app/close/${close.id}`}><b>{close.trading_date} · v{close.version}</b><span>{venues.find(v=>v.id===close.venue_id)?.name} · {close.status}</span><em>{euro(close.difference_minor)} →</em></Link>)}</div>}</section>; }

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
