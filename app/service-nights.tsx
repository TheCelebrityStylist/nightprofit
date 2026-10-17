"use client";

import { useState } from "react";
import { describeLines, lineMinutes, type LaneKind, type ServiceLine, type ServicePattern } from "@/lib/workforce/service-nights";

type RoleOption = { id: string; name: string; department_id: string; hourly_cost_minor: string; lane: LaneKind };
type DayCount = { date: Date; staff: number; dj: number };

const dayMs = 86400000;
/** "2130" → "21:30", "9:30" → "09:30"; leaves partial input alone while typing. */
const normaliseTime = (value: string) => {
  const digits = value.replace(/[^\d]/g, "").slice(0, 4);
  if (/^\d:\d{2}$/.test(value.trim())) return `0${value.trim()}`;
  return digits.length === 4 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : value.slice(0, 5);
};
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function ServiceNightsPanel({
  organisationId,
  venueId,
  weekStart,
  roles,
  patterns,
  dayCounts,
  hasDjLane,
  locale,
  onSaved,
}: {
  organisationId: string;
  venueId: string;
  weekStart: Date;
  roles: RoleOption[];
  patterns: ServicePattern[];
  dayCounts: DayCount[];
  hasDjLane: boolean;
  locale: "nl" | "en";
  onSaved: (message: string) => void;
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const weekdayName = (iso: number, style: "long" | "short" = "long") => new Date(2026, 0, 4 + iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: style });
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? "?";
  const venuePatterns = patterns.filter((row) => row.venue_id === venueId);
  const patternFor = (iso: number) => venuePatterns.find((row) => row.iso_weekday === iso);
  const openDays = venuePatterns.filter((row) => row.active).sort((a, b) => a.iso_weekday - b.iso_weekday);
  const dayBeforeFirstOpen = openDays.length ? Math.max(1, openDays[0].iso_weekday - 1) : 3;
  const firstClosedDay = !patternFor(dayBeforeFirstOpen)?.active ? dayBeforeFirstOpen : Array.from({ length: 7 }, (_, index) => index + 1).find((iso) => !patternFor(iso)?.active) ?? 3;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"week" | "extra" | "standard" | "rates">(openDays.length ? "week" : "standard");
  const [extraDate, setExtraDate] = useState(() => localDate(new Date(weekStart.getTime() + (firstClosedDay - 1) * dayMs)));
  const [extraLines, setExtraLines] = useState<ServiceLine[]>(() => openDays[0]?.lines.map((line) => ({ ...line })) ?? []);
  const [editDay, setEditDay] = useState<number>(openDays[0]?.iso_weekday ?? 4);
  const [editActive, setEditActive] = useState<boolean>(() => patternFor(openDays[0]?.iso_weekday ?? 4)?.active ?? true);
  const [editLines, setEditLines] = useState<ServiceLine[]>(() => patternFor(openDays[0]?.iso_weekday ?? 4)?.lines.map((line) => ({ ...line })) ?? []);
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(roles.map((role) => [role.id, (Number(role.hourly_cost_minor) / 100).toFixed(2).replace(".", ",")])));

  async function call(action: string, values: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/planning/nights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, action, values }) });
      const result = (await response.json()) as { message?: string; errorCode?: string };
      if (!response.ok) {
        const known: Record<string, string> = {
          NO_STANDARD_WEEK: tx("Er staat nog geen standaardweek. Stel eerst je vaste avonden in.", "No standard week yet. Set up your regular nights first."),
          NO_STANDARD_NIGHT: tx("Deze dag heeft geen standaardavond.", "This day has no standard night."),
          INVALID_SERVICE_ROLE: tx("Kies voor elke regel een bestaande rol.", "Pick an existing role for each line."),
          INVALID_SERVICE_TIME: tx("Begin- en eindtijd moeten verschillen (HH:MM).", "Start and end must differ (HH:MM)."),
          SERVICE_LINES_REQUIRED: tx("Voeg minstens één dienst toe.", "Add at least one shift."),
          INVALID_RATE: tx("Vul een uurtarief in zoals 15,50.", "Enter an hourly rate such as 15.50."),
          FORBIDDEN: tx("Je hebt geen planningsrechten voor deze locatie.", "You don't have planning rights for this venue."),
          VALIDATION_FAILED: tx("Controleer aantallen en tijden.", "Check counts and times."),
        };
        throw new Error(known[result.errorCode ?? ""] ?? tx("Opslaan mislukt.", "Save failed."));
      }
      onSaved(result.message ?? tx("Opgeslagen.", "Saved."));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Opslaan mislukt.", "Save failed."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectDay = (iso: number) => {
    setEditDay(iso);
    const pattern = patternFor(iso);
    setEditActive(pattern ? pattern.active : true);
    setEditLines(pattern?.lines.map((line) => ({ ...line })) ?? openDays[0]?.lines.map((line) => ({ ...line })) ?? []);
  };
  const weekNights = openDays.map((pattern) => {
    const date = new Date(weekStart.getTime() + (pattern.iso_weekday - 1) * dayMs);
    const count = dayCounts.find((row) => row.date.toDateString() === date.toDateString());
    const need = (lane: LaneKind) => pattern.lines.filter((line) => roles.find((role) => role.id === line.role_id)?.lane === lane).reduce((sum, line) => sum + line.count, 0);
    return { pattern, date, staffNeed: need("staff"), djNeed: need("dj"), staffHave: count?.staff ?? 0, djHave: count?.dj ?? 0 };
  });
  const missingThisWeek = weekNights.reduce((sum, night) => sum + Math.max(0, night.staffNeed - night.staffHave) + Math.max(0, night.djNeed - night.djHave), 0);
  const extraDay = new Date(`${extraDate}T12:00:00`);
  const extraCounts = dayCounts.find((row) => row.date.toDateString() === extraDay.toDateString());

  return (
    <section className="context-detail service-nights">
      <span className="eyebrow">{tx("AVONDEN", "NIGHTS")}</span>
      <h3>{tx("Openingsavonden plannen", "Plan opening nights")}</h3>
      <nav className="service-tabs" role="tablist">
        {([["week", tx("Deze week", "This week")], ["extra", tx("Extra avond", "Extra night")], ["standard", tx("Standaardweek", "Standard week")], ["rates", tx("Tarieven", "Rates")]] as const).map(([key, label]) => (
          <button type="button" role="tab" key={key} aria-selected={section === key} className={section === key ? "active" : ""} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>
      {error ? <p className="service-error" role="alert">{error}</p> : null}

      {section === "week" ? (
        <div className="service-section">
          {weekNights.length ? (
            <>
              <ul className="service-week">
                {weekNights.map((night) => (
                  <li key={night.pattern.iso_weekday}>
                    <b>{night.date.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "long", day: "numeric", month: "short" })}</b>
                    <span>{night.staffHave}/{night.staffNeed} {tx("personeel", "staff")}{hasDjLane ? ` · ${night.djHave}/${night.djNeed} DJ` : ""}</span>
                    <small>{[...new Set(night.pattern.lines.map((line) => line.role_id))].map((roleId) => `${roleName(roleId)}: ${describeLines(night.pattern.lines.filter((line) => line.role_id === roleId), roleName)}`).join("  ·  ")}</small>
                  </li>
                ))}
              </ul>
              <button type="button" className="primary" disabled={busy || !missingThisWeek} onClick={() => void call("week_apply", { venueId, weekStart: localDate(weekStart) })}>
                {missingThisWeek ? tx(`Standaardweek invullen · ${missingThisWeek} open diensten`, `Fill standard week · ${missingThisWeek} open shifts`) : tx("Deze week staat al klaar", "This week is already set up")}
              </button>
              <p className="quiet">{tx("Maakt alleen open diensten die nog ontbreken. Daarna sleep of kies je per dienst wie er werkt.", "Only creates open shifts that are still missing. Then assign who works each shift.")}</p>
            </>
          ) : (
            <p>{tx("Nog geen vaste avonden. Stel je standaardweek in, dan vul je elke week met één klik.", "No regular nights yet. Set up your standard week, then fill each week in one click.")} <button type="button" onClick={() => setSection("standard")}>{tx("Standaardweek instellen", "Set up standard week")}</button></p>
          )}
        </div>
      ) : null}

      {section === "extra" ? (
        <div className="service-section">
          <p>{tx("Voor een event op een dag dat je normaal dicht bent, of een extra avond.", "For an event on a day you're normally closed, or an extra night.")}</p>
          <label>{tx("Datum", "Date")}<input type="date" value={extraDate} onChange={(event) => setExtraDate(event.target.value)} /></label>
          {openDays.length ? (
            <div className="service-copy">
              <small>{tx("Begin met de bezetting van:", "Start from the staffing of:")}</small>
              {openDays.map((pattern) => <button type="button" key={pattern.iso_weekday} onClick={() => setExtraLines(pattern.lines.map((line) => ({ ...line })))}>{weekdayName(pattern.iso_weekday, "short")}</button>)}
            </div>
          ) : null}
          <LinesEditor lines={extraLines} setLines={setExtraLines} roles={roles} tx={tx} />
          {extraCounts && extraCounts.staff + extraCounts.dj ? <p className="quiet">{tx(`Op deze dag staan al ${extraCounts.staff + extraCounts.dj} diensten. Alleen wat ontbreekt wordt toegevoegd.`, `This day already has ${extraCounts.staff + extraCounts.dj} shifts. Only what's missing is added.`)}</p> : null}
          <button type="button" className="primary" disabled={busy || !extraLines.length || !extraDate} onClick={() => void call("night_plan", { venueId, serviceDate: extraDate, lines: JSON.stringify(extraLines) })}>
            {tx(`${extraDay.toLocaleDateString("nl-NL", { weekday: "long" })} openen · ${extraLines.reduce((sum, line) => sum + line.count, 0)} diensten`, `Open ${extraDay.toLocaleDateString("en-GB", { weekday: "long" })} · ${extraLines.reduce((sum, line) => sum + line.count, 0)} shifts`)}
          </button>
        </div>
      ) : null}

      {section === "standard" ? (
        <div className="service-section">
          <div className="service-days" role="tablist">
            {Array.from({ length: 7 }, (_, index) => index + 1).map((iso) => (
              <button type="button" key={iso} className={`${editDay === iso ? "active" : ""} ${patternFor(iso)?.active ? "open" : ""}`} onClick={() => selectDay(iso)}>
                <b>{weekdayName(iso, "short")}</b>
                <small>{patternFor(iso)?.active ? patternFor(iso)!.lines.reduce((sum, line) => sum + line.count, 0) : tx("dicht", "closed")}</small>
              </button>
            ))}
          </div>
          <label className="service-toggle"><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> {tx(`Normaal open op ${weekdayName(editDay)}`, `Normally open on ${weekdayName(editDay)}`)}</label>
          {editActive ? <LinesEditor lines={editLines} setLines={setEditLines} roles={roles} tx={tx} /> : null}
          <button type="button" className="primary" disabled={busy || (editActive && !editLines.length)} onClick={() => void call("pattern_save", { venueId, isoWeekday: String(editDay), active: String(editActive), lines: JSON.stringify(editActive ? editLines : []) })}>
            {tx(`${weekdayName(editDay)} opslaan`, `Save ${weekdayName(editDay)}`)}
          </button>
          <p className="quiet">{tx("Wijzigen geldt voor weken die je hierna invult. Bestaande diensten blijven staan.", "Changes apply to weeks you fill from now on. Existing shifts stay.")}</p>
        </div>
      ) : null}

      {section === "rates" ? (
        <div className="service-section">
          <p>{tx("Uurtarief per rol voor de loonkosten. Voor een DJ: gage gedeeld door het aantal uur.", "Hourly rate per role for labour cost. For a DJ: fee divided by hours played.")}</p>
          <ul className="service-rates">
            {roles.map((role) => (
              <li key={role.id}>
                <span><b>{role.name}</b><small>{role.lane === "dj" ? "DJ" : tx("Personeel", "Staff")}</small></span>
                <input inputMode="decimal" value={rates[role.id] ?? ""} onChange={(event) => setRates((current) => ({ ...current, [role.id]: event.target.value }))} aria-label={tx(`Uurtarief ${role.name}`, `Hourly rate ${role.name}`)} />
                <button type="button" disabled={busy} onClick={() => void call("role_rate", { venueId, roleId: role.id, hourlyCost: rates[role.id] ?? "" })}>{tx("Opslaan", "Save")}</button>
              </li>
            ))}
          </ul>
          {!hasDjLane ? <button type="button" disabled={busy} onClick={() => void call("dj_setup", { venueId, hourlyCost: "0" })}>{tx("DJ-planning toevoegen", "Add DJ planning")}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function LinesEditor({ lines, setLines, roles, tx }: { lines: ServiceLine[]; setLines: (lines: ServiceLine[]) => void; roles: RoleOption[]; tx: (nl: string, en: string) => string }) {
  const update = (index: number, patch: Partial<ServiceLine>) => setLines(lines.map((line, current) => (current === index ? { ...line, ...patch } : line)));
  const fallbackRole = roles.find((role) => role.lane === "staff") ?? roles[0];
  return (
    <div className="service-lines">
      {lines.map((line, index) => (
        <div className="service-line" key={index}>
          <select value={line.role_id} onChange={(event) => update(index, { role_id: event.target.value })} aria-label={tx("Rol", "Role")}>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
          <input type="number" min={1} max={50} value={line.count} onChange={(event) => update(index, { count: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} aria-label={tx("Aantal", "Count")} />
          <span>×</span>
          <input inputMode="numeric" maxLength={5} placeholder="21:30" value={line.start} onChange={(event) => update(index, { start: normaliseTime(event.target.value) })} aria-label={tx("Begin", "Start")} />
          <span>–</span>
          <input inputMode="numeric" maxLength={5} placeholder="03:00" value={line.end} onChange={(event) => update(index, { end: normaliseTime(event.target.value) })} aria-label={tx("Einde", "End")} />
          <small>{/^\d{2}:\d{2}$/.test(line.start) && /^\d{2}:\d{2}$/.test(line.end) && line.start !== line.end ? `${Math.round(lineMinutes(line) / 6) / 10} u` : ""}</small>
          <button type="button" className="ghost" onClick={() => setLines(lines.filter((_, current) => current !== index))} aria-label={tx("Regel verwijderen", "Remove line")}>×</button>
        </div>
      ))}
      {fallbackRole ? <button type="button" onClick={() => setLines([...lines, { role_id: fallbackRole.id, count: 1, start: lines.at(-1)?.start ?? "23:00", end: lines.at(-1)?.end ?? "03:00", break_minutes: 0 }])}>{tx("+ Dienst toevoegen", "+ Add shift")}</button> : <p className="quiet">{tx("Maak eerst een rol aan in Team.", "Create a role in Team first.")}</p>}
    </div>
  );
}

