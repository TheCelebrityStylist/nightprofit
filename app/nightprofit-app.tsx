"use client";

import { useMemo, useState } from "react";

type Locale = "nl" | "en";
type Page = "dashboard" | "close" | "events" | "margins" | "invoices" | "imports" | "alerts" | "reports" | "settings";

const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const nav: { id: Page; label: string; mark: string }[] = [
  { id: "dashboard", label: "Overzicht", mark: "⌂" },
  { id: "close", label: "Nachtafsluiting", mark: "✓" },
  { id: "events", label: "Events", mark: "◫" },
  { id: "margins", label: "Margebeheer", mark: "%" },
  { id: "invoices", label: "Facturen", mark: "▤" },
  { id: "imports", label: "Importcentrum", mark: "⇧" },
  { id: "alerts", label: "Signalen", mark: "!" },
  { id: "reports", label: "Rapporten", mark: "↗" },
  { id: "settings", label: "Instellingen", mark: "⚙" },
];

const strings = {
  nl: { period: "Laatste 28 dagen", open: "Open bewijs", resolved: "Opgelost", review: "Beoordelen", synthetic: "SYNTHETISCHE DEMO", greeting: "Goedenavond, Sophie", venue: "Club Meridian · Amsterdam", next: "Volgende opening: vrijdag 22:00" },
  en: { period: "Last 28 days", open: "Open evidence", resolved: "Resolved", review: "Review", synthetic: "SYNTHETIC DEMO", greeting: "Good evening, Sophie", venue: "Club Meridian · Amsterdam", next: "Next opening: Friday 22:00" },
};

const metrics = [
  { label: "Netto omzet", value: "€ 124.680", delta: "+8,4%", tone: "good", note: "vs. vorige 28 dagen" },
  { label: "Eventbijdrage", value: "€ 37.420", delta: "+3,1%", tone: "good", note: "30,0% van netto omzet" },
  { label: "Drankmarge", value: "72,8%", delta: "−1,6 pp", tone: "warn", note: "doel 74,0%" },
  { label: "Onverklaard verschil", value: "€ 486", delta: "0,39%", tone: "bad", note: "3 afsluitingen" },
];

const chart = [41, 56, 48, 70, 63, 82, 75, 90, 74, 96, 84, 102, 92, 111];

function Dashboard({ t, onNavigate }: { t: typeof strings.nl; onNavigate: (p: Page) => void }) {
  return (
    <>
      <section className="hero-row">
        <div>
          <div className="eyebrow">MAANDAG 27 JULI · HANDELSDATUM 26 JULI</div>
          <h1>{t.greeting}</h1>
          <p>{t.next}. Dit vraagt nu je aandacht.</p>
        </div>
        <button className="primary" onClick={() => onNavigate("close")}>+ Nieuwe afsluiting</button>
      </section>

      <section className="briefing">
        <div className="briefing-copy">
          <div className="briefing-kicker"><span>✦</span> DAGELIJKSE OWNER BRIEFING <b>Regelgestuurd · geverifieerd</b></div>
          <h2>De omzet groeide, maar je marge verloor € 1.940 aan terrein.</h2>
          <p>De leverancier verhoogde de inkoopprijs van premium spirits gemiddeld met 6,2%. Twee menuprijzen liggen nu onder je doelmarge. Daarnaast vereist de kaartafwijking van zaterdag controle.</p>
          <div className="brief-actions">
            <button onClick={() => onNavigate("alerts")}>Bekijk 3 acties <span>→</span></button>
            <small>Gebaseerd op 42 bewijsrecords · 100% verifieerbaar</small>
          </div>
        </div>
        <div className="impact">
          <span>GESCHAT HERSTELBAAR</span>
          <strong>€ 2.426</strong>
          <small>per 28 dagen</small>
        </div>
      </section>

      <section className="metric-grid">
        {metrics.map((m) => <button className="metric" key={m.label} onClick={() => onNavigate(m.label.includes("marge") ? "margins" : "reports")}>
          <div><span>{m.label}</span><i>↗</i></div>
          <strong>{m.value}</strong>
          <p className={m.tone}>{m.delta}</p><small>{m.note}</small>
        </button>)}
      </section>

      <section className="dashboard-grid">
        <article className="panel trend-panel">
          <header><div><h3>Omzet & bijdrage</h3><p>Netto omzet versus directe eventbijdrage</p></div><button className="ghost" onClick={() => onNavigate("reports")}>Details ↗</button></header>
          <div className="legend"><span><i className="lime" /> Netto omzet</span><span><i className="gray" /> Eventbijdrage</span></div>
          <div className="chart" aria-label="Netto omzet steeg van 8.200 naar 11.100 euro over veertien handelsdagen">
            {chart.map((h, i) => <div className="bar-group" key={i}><i style={{height: `${h}px`}}/><b style={{height: `${Math.round(h*.31)}px`}}/></div>)}
          </div>
          <div className="axis"><span>29 jun</span><span>6 jul</span><span>13 jul</span><span>20 jul</span><span>26 jul</span></div>
        </article>
        <article className="panel attention">
          <header><div><h3>Vraagt aandacht</h3><p>Gerangschikt op financiële impact</p></div><span className="count">3</span></header>
          <button onClick={() => onNavigate("alerts")}><i className="severity high">!</i><div><b>Kaartafwijking terminal BAR-02</b><p>Zaterdag · verschil € 486</p></div><span>€ 486 →</span></button>
          <button onClick={() => onNavigate("margins")}><i className="severity medium">↗</i><div><b>Leveranciersprijs gestegen</b><p>North Sea Spirits · +6,2%</p></div><span>€ 1.940 →</span></button>
          <button onClick={() => onNavigate("events")}><i className="severity medium">%</i><div><b>Personeelskosten boven doel</b><p>Neon Garden · 24,8% vs 21%</p></div><span>€ 640 →</span></button>
          <a onClick={() => onNavigate("alerts")}>Alle 7 signalen bekijken →</a>
        </article>
      </section>
      <section className="panel recent">
        <header><div><h3>Recente afsluitingen</h3><p>Elke waarde is vastgelegd in een onveranderlijke snapshot</p></div><button className="ghost" onClick={() => onNavigate("close")}>Alle afsluitingen</button></header>
        <div className="table">
          <div className="tr th"><span>Handelsdatum</span><span>Omzet</span><span>Verschil</span><span>Status</span><span></span></div>
          {[
            ["za 26 juli", "€ 16.842", "− € 486", "Controle nodig"],
            ["vr 25 juli", "€ 14.290", "+ € 12", "Goedgekeurd"],
            ["za 19 juli", "€ 17.630", "€ 0", "Vergrendeld"],
          ].map((r, i) => <button className="tr" key={r[0]} onClick={() => onNavigate("close")}><span><b>{r[0]}</b><small>{i===0?"Neon Garden":"Reguliere nacht"}</small></span><span>{r[1]}</span><span className={i===0?"bad":""}>{r[2]}</span><span><em className={i===0?"amber":"green"}>{r[3]}</em></span><span>→</span></button>)}
        </div>
      </section>
    </>
  );
}

function ClosePage({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [card, setCard] = useState("12456.20");
  const [cash, setCash] = useState("3386.00");
  const expected = 15842.2;
  const actual = Number(card) + Number(cash);
  const diff = actual - expected;
  return <section className="workflow">
    <div className="page-title"><div><div className="eyebrow">NACHTAFSLUITING · CONCEPT</div><h1>Afsluiting 26 juli</h1><p>Club Meridian · Neon Garden</p></div><span className="status">Automatisch opgeslagen</span></div>
    <div className="stepper">{["Basis", "Kaart", "Contant", "Overig", "Controle"].map((s,i)=><button key={s} className={step===i+1?"active":step>i+1?"done":""} onClick={()=>setStep(i+1)}><b>{step>i+1?"✓":i+1}</b><span>{s}</span></button>)}</div>
    <div className="form-panel">
      <div><span className="eyebrow">STAP {step} VAN 5</span><h2>{step===1?"Controleer de handelsnacht":step===2?"Kaartbetalingen":step===3?"Contante kas":step===4?"Overige omzetstromen":"Controle & indienen"}</h2><p>{step===5?"Bekijk de deterministische reconciliatie voordat je indient.":"Alle bedragen worden in eurocenten berekend en in de historische snapshot bevroren."}</p></div>
      {step===1 && <div className="form-grid"><label>Vestiging<select><option>Club Meridian · Amsterdam</option></select></label><label>Handelsdatum<input type="date" defaultValue="2026-07-26"/></label><label>Gekoppeld event<select><option>Neon Garden</option></select></label><label>POS verwacht totaal<input value={expected.toFixed(2)} readOnly/></label></div>}
      {step===2 && <div className="form-grid"><label>Terminal BAR-01<input value={card} onChange={e=>setCard(e.target.value)} inputMode="decimal"/></label><label>Settlement referentie<input defaultValue="STL-2607-001"/></label></div>}
      {step===3 && <div><div className="denoms">{[50,20,10,5,2,1].map((d,i)=><label key={d}>€ {d}<input defaultValue={i===0?"24":i===1?"51":"12"} inputMode="numeric"/></label>)}</div><label>Geteld kasgeld<input value={cash} onChange={e=>setCash(e.target.value)} inputMode="decimal"/></label></div>}
      {step===4 && <div className="form-grid"><label>Online tickets<input defaultValue="0.00"/></label><label>Fooien<input defaultValue="248.00"/></label><label>Complimentary waarde<input defaultValue="184.50"/></label><label>Huisrekening<input defaultValue="0.00"/></label></div>}
      {step===5 && <div className="reconcile"><div><span>Verwachte omzet</span><b>{EUR.format(expected)}</b></div><div><span>Verantwoord totaal</span><b>{EUR.format(actual)}</b></div><div className={Math.abs(diff)>25?"problem":""}><span>Onverklaard verschil</span><strong>{EUR.format(diff)}</strong></div><label>Verplichte toelichting<textarea placeholder="Beschrijf controle en mogelijke verklaring…" defaultValue={Math.abs(diff)>25?"Terminal BAR-02 settlement wordt gecontroleerd bij betaalprovider.":""}/></label></div>}
      <footer><button className="ghost" disabled={step===1} onClick={()=>setStep(s=>s-1)}>Vorige</button><button className="primary" onClick={()=>step<5?setStep(s=>s+1):onDone()}>{step<5?"Opslaan & verder":"Afsluiting indienen"}</button></footer>
    </div>
  </section>;
}

function DataPage({ page }: { page: Page }) {
  const config: Record<Exclude<Page,"dashboard"|"close">,{title:string,kicker:string,desc:string,rows:string[][],cols:string[]}> = {
    events:{title:"Eventwinstgevendheid",kicker:"EVENTS",desc:"Bijdrage na alle directe eventkosten — nooit onterecht ‘netto winst’.",cols:["Event","Omzet","Bijdrage","Per bezoeker","Status"],rows:[["Neon Garden","€ 16.842","€ 3.716","€ 23,39","Controle"],["Disco Sundays","€ 11.280","€ 4.180","€ 31,74","Sterk"],["Friday Social","€ 14.290","€ 4.012","€ 28,34","Goedgekeurd"]]},
    margins:{title:"Drank- & menumarges",kicker:"MARGEBEHEER",desc:"Actuele receptkosten, prijsbewegingen en transparante prijsadviezen.",cols:["Menu-item","Verkoopprijs","Directe kost","Marge","Beweging"],rows:[["Vodka Lime","€ 9,50","€ 2,96","68,8%","−4,2 pp"],["Espresso Martini","€ 12,50","€ 3,18","74,6%","−1,1 pp"],["House lager 33cl","€ 4,20","€ 0,91","78,3%","+0,4 pp"],["Bottle service Premium","€ 145,00","€ 38,62","73,4%","−2,8 pp"]]},
    invoices:{title:"Leveranciersfacturen",kicker:"FACTUREN",desc:"Privé opgeslagen, deterministisch gecontroleerd en altijd door een mens bevestigd.",cols:["Factuur","Leverancier","Datum","Totaal","Status"],rows:[["NS-2026-1842","North Sea Spirits","25 jul 2026","€ 4.892,60","Controle nodig"],["FB-009381","Fresh Beverages","21 jul 2026","€ 1.284,22","Bevestigd"],["B-88210","Brouwerij Noord","18 jul 2026","€ 3.710,40","Bevestigd"]]},
    imports:{title:"Importcentrum",kicker:"DATA IMPORT",desc:"CSV-import met localeherkenning, rijvalidatie, deduplicatie en audittrail.",cols:["Bestand","Type","Rijen","Geïmporteerd","Status"],rows:[["pos_2607.csv","Verkooptotalen","184","184","Voltooid"],["terminal_july.csv","Terminals","96","94","2 afwijzingen"],["supplier_northsea.csv","Prijzen","42","42","Voltooid"]]},
    alerts:{title:"Profit-leak signalen",kicker:"SIGNALEN",desc:"Feiten en mogelijke verklaringen — nooit ongefundeerde beschuldigingen.",cols:["Signaal","Gemeten","Vergelijking","Impact","Status"],rows:[["Terminal BAR-02 afwijking","€ 486","doel ≤ € 25","€ 486","Beoordelen"],["Premium spirits prijsstijging","+6,2%","rolling mediaan +0,8%","€ 1.940","Open"],["Personeel Neon Garden","24,8%","doel 21,0%","€ 640","Open"]]},
    reports:{title:"Rapporten & exports",kicker:"RAPPORTAGE",desc:"Herleidbare managementrapportage met gross/net/VAT-labels en bewijsreferenties.",cols:["Rapport","Periode","Gegenereerd","Formaten","Status"],rows:[["Maandelijks management","juli 2026","27 jul 09:04","CSV · Print","Gereed"],["Beveragemarge","juli 2026","27 jul 09:02","CSV · Print","Gereed"],["Event P&L","Neon Garden","26 jul 04:38","CSV · Print","Gereed"]]},
    settings:{title:"Organisatie-instellingen",kicker:"INSTELLINGEN",desc:"Toegang, vestigingen, drempels, privacy en integraties centraal beheerd.",cols:["Onderdeel","Waarde","Scope","Laatst gewijzigd","Toegang"],rows:[["Handelsdag cutoff","06:00","Club Meridian","12 jul 2026","Beheerder"],["Verschildrempel","€ 25 / 0,25%","Club Meridian","18 jul 2026","Eigenaar"],["AI-briefings","Uitgeschakeld","Organisatie","20 jul 2026","Eigenaar"],["Bewaartermijn facturen","7 jaar","Organisatie","1 jul 2026","Eigenaar"]]},
  };
  const c=config[page as keyof typeof config];
  return <section className="workflow data-page"><div className="page-title"><div><div className="eyebrow">{c.kicker}</div><h1>{c.title}</h1><p>{c.desc}</p></div><button className="primary">+ Nieuw</button></div><div className="panel"><div className="toolbar"><input aria-label="Zoeken" placeholder="Zoeken…"/><select aria-label="Periode"><option>Laatste 28 dagen</option></select><button className="ghost">Exporteren</button></div><div className="table"><div className="tr th">{c.cols.map(x=><span key={x}>{x}</span>)}</div>{c.rows.map((r,i)=><button className="tr" key={i}>{r.map((x,j)=><span key={j} className={x.includes("−")||x==="Controle nodig"?"bad":""}>{j===0?<b>{x}</b>:x}</span>)}</button>)}</div></div></section>;
}

function PublicPage({ onDemo }: { onDemo: () => void }) {
  return <div className="public">
    <header><div className="brand"><span className="logo">N</span><b>NightProfit</b></div><nav><a href="#modules">Product</a><a href="#security">Security</a><a href="#pricing">Prijzen</a></nav><button className="ghost" onClick={onDemo}>Bekijk demo</button></header>
    <main>
      <section className="public-hero"><div className="eyebrow">FINANCIËLE CONTROLE VOOR NACHTZAKEN</div><h1>Zie waar je winst verdwijnt.<br/><em>Vóór je volgende opening.</em></h1><p>Je POS toont wat je verkocht. NightProfit reconcilieert de nacht, meet elke eventbijdrage en maakt elke marge-afwijking bewijsbaar.</p><div><button className="primary" onClick={onDemo}>Start winstdiagnose →</button><button className="ghost" onClick={onDemo}>Interactieve demo</button></div></section>
      <section className="proof"><span>GEEN GOKWERK</span><span>EXACTE GELDBEREKENING</span><span>BEWIJS BIJ ELKE WAARDE</span><span>NL + EN</span></section>
      <section id="modules" className="module-grid">{[
        ["01","Sluit elke nacht exact","POS, terminals, kas, tickets en huisrekeningen in één controleerbare snapshot."],
        ["02","Ken de bijdrage per event","Omzet minus alle directe kosten, payout-tiers en break-even bezoek."],
        ["03","Bescherm iedere marge","Receptkosten, opbrengst per fles en leveranciersprijzen met historische context."],
        ["04","Weet wat je morgen doet","Maximaal drie acties, gekoppeld aan geverifieerde cijfers en bronrecords."],
      ].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</section>
      <section id="security" className="security-strip"><div><span className="eyebrow">SECURITY BY DESIGN</span><h2>Financiële waarheid zonder black box.</h2></div><p>Exacte centberekeningen. Onveranderlijke historische snapshots. Tenant-isolatie. AI kan uitleggen, maar berekent nooit je financiële waarheid.</p></section>
      <section id="pricing" className="pricing"><div><span className="eyebrow">TRANSPARANTE PRIJZEN</span><h2>Betaalt zichzelf terug als je één lek vindt.</h2></div><article><small>ESSENTIAL</small><b>€ 299 <i>/ vestiging / maand</i></b><p>Nachtafsluiting · Events · Kernrapporten</p><button className="primary" onClick={onDemo}>Start winstdiagnose</button></article><article className="featured"><small>PROFIT PRO</small><b>€ 499 <i>/ vestiging / maand</i></b><p>Volledige event P&L · Facturen · Margesignalen · Briefings</p><button className="primary" onClick={onDemo}>Bekijk in demo</button></article></section>
    </main>
  </div>;
}

export function NightProfitApp({ initialPath = "/" }: { initialPath?: string }) {
  const initialPage = nav.find(n=>initialPath.includes(n.id))?.id ?? "dashboard";
  const [locale, setLocale] = useState<Locale>("nl");
  const [page, setPage] = useState<Page>(initialPage);
  const [publicView, setPublicView] = useState(!(initialPath.startsWith("/app")||initialPath==="/demo"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const t=useMemo(()=>strings[locale],[locale]);
  const navigate=(p:Page)=>{setPage(p);setPublicView(false);setMenuOpen(false);window.history.replaceState({}, "", `/app/${p}`)};
  const done=()=>{setToast("Afsluiting ingediend voor goedkeuring");setPage("dashboard");setTimeout(()=>setToast(""),3500)};
  if(publicView) return <PublicPage onDemo={()=>{setPublicView(false);window.history.replaceState({},"","/demo")}}/>;
  return <div className="app-shell">
    <aside className={menuOpen?"open":""}>
      <div className="brand"><span className="logo">N</span><b>NightProfit</b></div>
      <button className="venue"><span>CM</span><div><b>Club Meridian</b><small>Amsterdam · EUR</small></div><i>⌄</i></button>
      <nav>{nav.map(n=><button key={n.id} className={page===n.id?"active":""} onClick={()=>navigate(n.id)}><i>{n.mark}</i>{n.label}{n.id==="alerts"&&<em>7</em>}</button>)}</nav>
      <div className="aside-foot"><span>Synthetische demo</span><p>Alle getoonde data is fictief.</p><button onClick={()=>setPublicView(true)}>← Naar website</button></div>
    </aside>
    <main className="app-main">
      <header className="topbar"><button className="mobile-menu" onClick={()=>setMenuOpen(!menuOpen)}>☰</button><div className="crumb">NightProfit <span>/</span> {nav.find(n=>n.id===page)?.label}</div><div className="top-actions"><span className="demo-label">{t.synthetic}</span><button className="date">◷ {t.period}⌄</button><button className="icon">⌕</button><button className="icon">♢<em>3</em></button><select value={locale} onChange={e=>setLocale(e.target.value as Locale)} aria-label="Taal"><option value="nl">NL</option><option value="en">EN</option></select><button className="avatar">SJ</button></div></header>
      <div className="content">{page==="dashboard"?<Dashboard t={t} onNavigate={navigate}/>:page==="close"?<ClosePage onDone={done}/>:<DataPage page={page}/>}</div>
    </main>
    {menuOpen&&<button className="scrim" aria-label="Menu sluiten" onClick={()=>setMenuOpen(false)}/>}
    {toast&&<div className="toast" role="status">✓ {toast}</div>}
  </div>;
}
