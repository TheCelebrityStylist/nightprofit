"use client";

import { useEffect, useState } from "react";

type Template = { key: string; name: string; title: string; text: string; status: string; reason: string | null };
type Status = {
  source: "none" | "app" | "hosting";
  connected: boolean;
  phone: { number: string; name: string; quality: string; nameStatus: string } | { error: string } | null;
  templates: Template[] | { error: string } | null;
  webhook: { status: string; lastEventAt: string | null } | null;
  error?: string;
};

const TEMPLATE_STATE: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Goedgekeurd", tone: "ok" },
  PENDING: { label: "In beoordeling bij Meta", tone: "wait" },
  IN_APPEAL: { label: "In beoordeling bij Meta", tone: "wait" },
  REJECTED: { label: "Afgewezen", tone: "bad" },
  PAUSED: { label: "Gepauzeerd door Meta", tone: "bad" },
  DISABLED: { label: "Uitgeschakeld door Meta", tone: "bad" },
  MISSING: { label: "Nog niet ingediend", tone: "idle" },
};

export function WhatsappSetup({ organisationId, venueId, onChanged }: { organisationId: string; venueId: string; onChanged: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testSent, setTestSent] = useState(false);

  async function call(action: string, extra: Record<string, string> = {}) {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/whatsapp/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, organisationId, venueId, ...extra }) });
      const body = (await response.json().catch(() => ({}))) as Status & { error?: string; sent?: boolean };
      if (body.error) setError(body.error);
      if (!response.ok && response.status !== 207) return null;
      if (action !== "test") setStatus(body);
      if (action === "save" || action === "disconnect") { setEditing(false); onChanged(); }
      return body;
    } catch {
      setError("Geen verbinding. Probeer het opnieuw.");
      return null;
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let live = true;
    void fetch("/api/whatsapp/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", organisationId, venueId }) })
      .then((response) => response.json() as Promise<Status>)
      .then((body) => { if (live) setStatus(body); })
      .catch(() => { if (live) setError("Status ophalen lukte niet."); });
    return () => { live = false; };
  }, [organisationId, venueId]);

  if (!status) return <p className="pl-note">Status ophalen…</p>;

  if (status.source === "hosting") {
    return <div className="wa"><p className="pl-ok">WhatsApp is gekoppeld via de instellingen van de hosting. Berichten gaan automatisch via het Cliniq-nummer.</p></div>;
  }

  const phone = status.phone && "number" in status.phone ? status.phone : null;
  const templates = Array.isArray(status.templates) ? status.templates : null;
  const allApproved = Boolean(templates?.every((row) => row.status === "APPROVED"));
  const needsSubmit = Boolean(templates?.some((row) => row.status === "MISSING" || row.status === "REJECTED"));
  const webhookOn = status.webhook?.status === "connected" || status.webhook?.status === "receiving";
  const ready = status.connected && allApproved;
  const showForm = !status.connected || editing;

  return (
    <div className="wa">
      <div className={`wa-state${ready ? " is-ready" : ""}`}>
        <b>{ready ? "Alles werkt" : status.connected ? "Bijna klaar" : "Nog niet gekoppeld"}</b>
        <span>
          {ready
            ? `Roosters, vragen en uitnodigingen gaan automatisch via ${phone?.name || "jullie nummer"} (${phone?.number}).`
            : status.connected
              ? "Het nummer is gekoppeld. Zodra Meta de drie berichten heeft goedgekeurd, gaat alles automatisch."
              : "Nu open je WhatsApp zelf en tik je op versturen. Koppel het Cliniq-nummer om dat automatisch te laten gaan."}
        </span>
      </div>

      {error ? <p className="pl-warn" role="alert">{error}</p> : null}

      <ol className="wa-steps">
        <li className={status.connected ? "is-done" : "is-now"}>
          <h3><span className="wa-n">{status.connected ? "✓" : 1}</span>Nummer koppelen</h3>
          {phone && !editing ? (
            <div className="wa-row">
              <p><b>{phone.name || "Naam nog niet goedgekeurd"}</b> {phone.number}{phone.quality ? <small>Kwaliteit: {phone.quality === "GREEN" ? "goed" : phone.quality === "YELLOW" ? "matig" : phone.quality === "RED" ? "laag" : phone.quality.toLowerCase()}</small> : null}</p>
              <button type="button" className="pl-link" onClick={() => setEditing(true)}>Wijzigen</button>
            </div>
          ) : null}
          {status.phone && "error" in status.phone ? <p className="pl-warn">{status.phone.error}</p> : null}
          {showForm ? (
            <form className="wa-form" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>; void call("save", values); }}>
              <p className="pl-note">Vijf gegevens uit je Meta-account. Ze worden versleuteld bewaard en alleen gebruikt om berichten te versturen. <button type="button" className="pl-link" onClick={() => setHelp(!help)}>{help ? "Verberg uitleg" : "Waar vind ik dit?"}</button></p>
              {help ? (
                <ol className="wa-help">
                  <li>Ga naar <b>developers.facebook.com</b>, open je app (of maak er een: type Business) en voeg het product <b>WhatsApp</b> toe.</li>
                  <li>Onder <b>WhatsApp → API Setup</b> voeg je het Cliniq-nummer toe. Daar staan het <b>telefoonnummer-ID</b> en het <b>WhatsApp Business-account-ID</b>.</li>
                  <li>Onder <b>App settings → Basic</b> staan het <b>app-ID</b> en het <b>app-geheim</b> (klik op tonen).</li>
                  <li>In <b>business.facebook.com → Instellingen → Systeemgebruikers</b> maak je een systeemgebruiker (beheerder), koppel je de app en het WhatsApp-account, en genereer je een token zonder vervaldatum met de rechten <b>whatsapp_business_messaging</b> en <b>whatsapp_business_management</b>.</li>
                  <li>Het nummer mag niet tegelijk in de gewone WhatsApp-app actief zijn.</li>
                </ol>
              ) : null}
              <label>Telefoonnummer-ID<input name="phoneNumberId" inputMode="numeric" required autoComplete="off" /></label>
              <label>WhatsApp Business-account-ID<input name="wabaId" inputMode="numeric" required autoComplete="off" /></label>
              <label>App-ID<input name="appId" inputMode="numeric" required autoComplete="off" /></label>
              <label>App-geheim<input name="appSecret" required autoComplete="off" spellCheck={false} /></label>
              <label>Permanente token<input name="token" required autoComplete="off" spellCheck={false} type="password" /></label>
              <div className="wa-actions">
                <button className="pl-btn pl-btn--go" disabled={Boolean(busy)}>{busy === "save" ? "Controleren bij Meta…" : "Opslaan en controleren"}</button>
                {editing ? <button type="button" className="pl-btn pl-btn--quiet" onClick={() => setEditing(false)}>Annuleren</button> : null}
              </div>
            </form>
          ) : null}
        </li>

        <li className={!status.connected ? "is-todo" : allApproved ? "is-done" : "is-now"}>
          <h3><span className="wa-n">{allApproved ? "✓" : 2}</span>Berichten laten goedkeuren</h3>
          <p className="pl-note">Meta keurt elk bericht dat jij als bedrijf als eerste stuurt vooraf goed. Meestal binnen een paar minuten tot een dag.</p>
          {templates ? (
            <ul className="wa-templates">
              {templates.map((row) => {
                const state = TEMPLATE_STATE[row.status] ?? { label: row.status.toLowerCase(), tone: "idle" };
                return (
                  <li key={row.key}>
                    <div><b>{row.title}</b><span className={`wa-chip is-${state.tone}`}>{state.label}</span></div>
                    <p>{row.text}</p>
                    {row.reason ? <small className="a-no">Reden: {row.reason.toLowerCase().replaceAll("_", " ")}</small> : null}
                  </li>
                );
              })}
            </ul>
          ) : status.templates && "error" in status.templates ? <p className="pl-warn">{status.templates.error}</p> : null}
          {status.connected ? (
            <div className="wa-actions">
              {needsSubmit ? <button type="button" className="pl-btn pl-btn--go" disabled={Boolean(busy)} onClick={() => void call("templates")}>{busy === "templates" ? "Indienen…" : "Dien in bij Meta"}</button> : null}
              {!allApproved ? <button type="button" className="pl-btn pl-btn--quiet" disabled={Boolean(busy)} onClick={() => void call("status")}>{busy === "status" ? "Vernieuwen…" : "Status vernieuwen"}</button> : null}
            </div>
          ) : null}
        </li>

        <li className={!status.connected ? "is-todo" : webhookOn ? "is-done" : "is-now"}>
          <h3><span className="wa-n">{webhookOn ? "✓" : 3}</span>Afgeleverd en gelezen zien</h3>
          <p className="pl-note">{webhookOn ? (status.webhook?.lastEventAt ? `Gekoppeld. Laatste melding van Meta: ${new Date(status.webhook.lastEventAt).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "Gekoppeld. Je ziet per bericht of het is afgeleverd en gelezen.") : "Meta laat de app weten of een bericht is afgeleverd, gelezen of mislukt."}</p>
          {status.connected ? <div className="wa-actions"><button type="button" className={`pl-btn${webhookOn ? " pl-btn--quiet" : ""}`} disabled={Boolean(busy)} onClick={() => void call("webhook")}>{busy === "webhook" ? "Koppelen…" : webhookOn ? "Opnieuw koppelen" : "Koppel afleverstatus"}</button></div> : null}
          {typeof window !== "undefined" && window.location.hostname.includes("preview") && status.connected ? <small className="pl-note">Doe dit vanuit de gepubliceerde app, niet vanuit een voorbeeldversie: Meta onthoudt het adres.</small> : null}
        </li>

        <li className={!status.connected ? "is-todo" : testSent ? "is-done" : ""}>
          <h3><span className="wa-n">{testSent ? "✓" : 4}</span>Testbericht</h3>
          <p className="pl-note">Stuurt Meta&apos;s standaard testbericht (Engels, &quot;Hello World&quot;) naar je eigen nummer. Werkt al voordat de berichten zijn goedgekeurd.</p>
          {status.connected ? (
            <form className="wa-test" onSubmit={async (event) => { event.preventDefault(); const result = await call("test", { to: testTo }); if (result && (result as { sent?: boolean }).sent) setTestSent(true); }}>
              <input value={testTo} onChange={(event) => setTestTo(event.target.value)} inputMode="tel" placeholder="06 …" aria-label="Jouw nummer" required />
              <button className="pl-btn" disabled={Boolean(busy)}>{busy === "test" ? "Versturen…" : testSent ? "Nog een keer" : "Stuur test"}</button>
            </form>
          ) : null}
          {testSent ? <small className="a-yes">Verstuurd. Kijk op je telefoon.</small> : null}
        </li>
      </ol>

      {status.connected ? <button type="button" className="pl-link wa-disconnect" disabled={Boolean(busy)} onClick={() => { if (window.confirm("WhatsApp ontkoppelen? Berichten gaan dan weer via je eigen telefoon.")) void call("disconnect"); }}>Ontkoppelen</button> : null}
    </div>
  );
}
