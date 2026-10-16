"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import type { RosterAvailabilityRow, RosterEmployeeRow, RosterLeaveRow, RosterPublicationRow, RosterShiftRow } from "../../lib/supabase/types";
import { decimalToMinor } from "../../lib/imports/locale-number";
import {
  addDays, formatMinor, formatMinutes, isoWeekNumber, leaveOn, localTime, paidMinutes, rankCandidates,
  shiftCostMinor, shiftWarnings, shiftWindow, todayIn, weekDays, weekStartOf, whatsappLink, type ShiftWarning,
} from "../../lib/roster";
import "./roster.css";

type Venue = { id: string; name: string; timezone: string };
type Props = {
  organisation: { id: string; name: string; currency: string };
  venues: Venue[];
  canManage: boolean;
  canPublish: boolean;
};
type Tab = "roster" | "availability" | "leave" | "team" | "publications";
type ShiftDraft = { id?: string; serviceDate: string; employeeId: string; role: string; start: string; end: string; breakMinutes: string; notes: string; published: boolean; status: "scheduled" | "cancelled" };
type EmployeeDraft = { id?: string; fullName: string; phone: string; email: string; defaultRole: string; hourlyCost: string; contractHours: string; active: boolean; notes: string };

const ROLES = ["bar", "floor", "security", "host", "garderobe", "kassa", "dj", "schoonmaak", "manager"];
const WARNING_TEXT: Record<ShiftWarning, string> = {
  unavailable: "Heeft zich onbeschikbaar gemeld",
  on_leave: "Heeft goedgekeurd verlof of is ziek gemeld",
  leave_requested: "Heeft verlof aangevraagd (nog niet beslist)",
  overlap: "Staat al ingeroosterd op dit tijdstip",
};
const AVAILABILITY_CYCLE: (RosterAvailabilityRow["status"] | null)[] = [null, "available", "preferred", "unavailable"];
const AVAILABILITY_LABEL: Record<RosterAvailabilityRow["status"], string> = { available: "Kan", preferred: "Liefst", unavailable: "Kan niet" };
const LEAVE_LABEL: Record<RosterLeaveRow["kind"], string> = { leave: "Verlof", sick: "Ziek", other: "Afwezig" };
const STATUS_LABEL: Record<RosterLeaveRow["status"], string> = { requested: "Aangevraagd", approved: "Goedgekeurd", rejected: "Afgewezen" };

const dayLabel = (date: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("nl-NL", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const minutesToHoursText = (minutes: number | null) => minutes === null ? "" : (minutes % 60 === 0 ? String(minutes / 60) : (minutes / 60).toFixed(2).replace(".", ","));
const minorToInput = (minor: number) => `${Math.trunc(minor / 100)},${String(Math.abs(minor % 100)).padStart(2, "0")}`;

function friendlyError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Er ging iets mis. Probeer het opnieuw.";
  const message = error.message ?? "";
  if (error.code === "23P01") return "Dubbele boeking: deze medewerker staat op dat tijdstip al ingeroosterd.";
  if (error.code === "42501" || message.includes("FORBIDDEN") || message.includes("row-level security")) return "Je hebt geen rechten voor deze actie.";
  if (message.includes("PUBLISHED_SHIFT_CANNOT_BE_DELETED")) return "Deze dienst is al gepubliceerd. Annuleer hem en publiceer de week opnieuw.";
  if (message.includes("NO_CHANGES_TO_PUBLISH")) return "Er zijn geen wijzigingen sinds de laatste publicatie.";
  if (message.includes("EMPLOYEE_INACTIVE")) return "Deze medewerker staat op inactief.";
  if (message.includes("SHIFT_OUTSIDE_SERVICE_DATE")) return "De starttijd valt buiten de gekozen dienstdatum.";
  if (message.includes("roster_shift_break")) return "De pauze is langer dan de dienst.";
  if (message.includes("roster_shift_window")) return "Een dienst duurt maximaal 16 uur en moet na de start eindigen.";
  if (error.code === "23514") return "Een of meer velden zijn ongeldig.";
  if (error.code === "23503") return "Deze medewerker heeft diensten en kan niet worden verwijderd. Zet hem op inactief.";
  return "Er ging iets mis. Probeer het opnieuw.";
}

export function RosterPlanner({ organisation, venues, canManage, canPublish }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const venue = venues.find((item) => item.id === venueId) ?? venues[0];
  const timezone = venue?.timezone ?? "Europe/Amsterdam";
  const today = todayIn(timezone);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = days[6];
  const [tab, setTab] = useState<Tab>("roster");

  const [employees, setEmployees] = useState<RosterEmployeeRow[]>([]);
  const [shifts, setShifts] = useState<RosterShiftRow[]>([]);
  const [availability, setAvailability] = useState<RosterAvailabilityRow[]>([]);
  const [leave, setLeave] = useState<RosterLeaveRow[]>([]);
  const [publications, setPublications] = useState<RosterPublicationRow[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [loaded, setLoaded] = useState<{ view: string; error: string } | null>(null);
  const viewKey = `${venueId}|${weekStart}`;
  const loading = loaded?.view !== viewKey;
  const loadError = loaded?.view === viewKey ? loaded.error : "";
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft | null>(null);
  const [employeeDraft, setEmployeeDraft] = useState<EmployeeDraft | null>(null);
  const [availabilitySource, setAvailabilitySource] = useState<RosterAvailabilityRow["source"]>("whatsapp");
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!venueId) return;
    let active = true;
    const view = `${venueId}|${weekStart}`;
    void (async () => {
    const [employeeResult, shiftResult, availabilityResult, leaveResult, publicationResult] = await Promise.all([
      supabase.from("roster_employees").select("*").eq("organisation_id", organisation.id).order("full_name"),
      supabase.from("roster_shifts").select("*").eq("venue_id", venueId).gte("service_date", weekStart).lte("service_date", weekEnd).order("starts_at"),
      supabase.from("roster_availability").select("*").eq("organisation_id", organisation.id).gte("service_date", weekStart).lte("service_date", weekEnd),
      supabase.from("roster_leave").select("*").eq("organisation_id", organisation.id).gte("ends_on", weekStart < today ? weekStart : today).order("starts_on"),
      supabase.from("roster_publications").select("*").eq("venue_id", venueId).eq("week_start", weekStart).order("version", { ascending: false }),
    ]);
    if (!active) return;
    const failed = [employeeResult, shiftResult, availabilityResult, leaveResult, publicationResult].find((result) => result.error);
    if (failed?.error) { setLoaded({ view, error: friendlyError(failed.error) }); return; }
    setEmployees(employeeResult.data ?? []);
    setShifts(shiftResult.data ?? []);
    setAvailability(availabilityResult.data ?? []);
    setLeave(leaveResult.data ?? []);
    setPublications(publicationResult.data ?? []);
    setLoaded({ view, error: "" });
    })();
    return () => { active = false; };
  }, [supabase, organisation.id, venueId, weekStart, weekEnd, today, reloadToken]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);
  const scheduled = useMemo(() => shifts.filter((shift) => shift.status === "scheduled"), [shifts]);
  const context = useMemo(() => ({ shifts: scheduled, availability, leave }), [scheduled, availability, leave]);
  const latest = publications[0] ?? null;
  const pendingChanges = shifts.filter((shift) => shift.changed_since_publish && (shift.status === "scheduled" || shift.published_version !== null)).length;

  const totals = useMemo(() => {
    let minutes = 0; let cost = 0n; let openShifts = 0; let warnings = 0;
    const perDay = new Map<string, { minutes: number; cost: bigint; open: number }>();
    const perEmployee = new Map<string, { minutes: number; cost: bigint }>();
    for (const shift of scheduled) {
      const paid = paidMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
      const shiftCost = shift.employee_id ? shiftCostMinor(paid, shift.hourly_cost_minor) : 0n;
      minutes += paid; cost += shiftCost;
      if (!shift.employee_id) openShifts += 1;
      if (shiftWarnings(shift, context).length) warnings += 1;
      const day = perDay.get(shift.service_date) ?? { minutes: 0, cost: 0n, open: 0 };
      day.minutes += paid; day.cost += shiftCost; if (!shift.employee_id) day.open += 1;
      perDay.set(shift.service_date, day);
      if (shift.employee_id) {
        const person = perEmployee.get(shift.employee_id) ?? { minutes: 0, cost: 0n };
        person.minutes += paid; person.cost += shiftCost; perEmployee.set(shift.employee_id, person);
      }
    }
    return { minutes, cost, openShifts, warnings, perDay, perEmployee };
  }, [scheduled, context]);

  const rosterRows = useMemo(() => {
    const ids = new Set(activeEmployees.map((employee) => employee.id));
    const inactiveWithShifts = employees.filter((employee) => !employee.active && scheduled.some((shift) => shift.employee_id === employee.id));
    inactiveWithShifts.forEach((employee) => ids.add(employee.id));
    return employees.filter((employee) => ids.has(employee.id));
  }, [employees, activeEmployees, scheduled]);

  function flash(text: string, tone: "ok" | "error" = "ok") { setNotice({ text, tone }); }

  function openNewShift(serviceDate: string, employeeId = "") {
    if (!canManage) return;
    const employee = employeeId ? employeeById.get(employeeId) : undefined;
    setShiftDraft({ serviceDate, employeeId, role: employee?.default_role ?? "bar", start: "22:00", end: "04:00", breakMinutes: "0", notes: "", published: false, status: "scheduled" });
  }
  function openShift(shift: RosterShiftRow) {
    setShiftDraft({
      id: shift.id, serviceDate: shift.service_date, employeeId: shift.employee_id ?? "", role: shift.role,
      start: localTime(shift.starts_at, timezone), end: localTime(shift.ends_at, timezone),
      breakMinutes: String(shift.break_minutes), notes: shift.notes ?? "", published: shift.published_version !== null, status: shift.status,
    });
  }

  const draftWindow = useMemo(() => {
    if (!shiftDraft || !/^\d{2}:\d{2}$/.test(shiftDraft.start) || !/^\d{2}:\d{2}$/.test(shiftDraft.end)) return null;
    try { return shiftWindow(shiftDraft.serviceDate, shiftDraft.start, shiftDraft.end, timezone); } catch { return null; }
  }, [shiftDraft, timezone]);
  const draftBreak = Number.parseInt(shiftDraft?.breakMinutes || "0", 10);
  const draftPaid = draftWindow ? paidMinutes(draftWindow.startsAt, draftWindow.endsAt, Number.isFinite(draftBreak) ? draftBreak : 0) : 0;
  const draftEmployee = shiftDraft?.employeeId ? employeeById.get(shiftDraft.employeeId) : undefined;
  const draftWarnings = shiftDraft && draftWindow ? shiftWarnings({ id: shiftDraft.id ?? "draft", employee_id: shiftDraft.employeeId || null, service_date: shiftDraft.serviceDate, starts_at: draftWindow.startsAt, ends_at: draftWindow.endsAt }, context) : [];
  const draftCandidates = shiftDraft && draftWindow
    ? rankCandidates({ id: shiftDraft.id ?? "draft", service_date: shiftDraft.serviceDate, starts_at: draftWindow.startsAt, ends_at: draftWindow.endsAt }, employees, context).slice(0, 6)
    : [];

  async function saveShift() {
    if (!shiftDraft || !venue || !draftWindow) { flash("Vul geldige tijden in.", "error"); return; }
    const breakMinutes = Number.parseInt(shiftDraft.breakMinutes || "0", 10);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 180) { flash("Pauze moet tussen 0 en 180 minuten liggen.", "error"); return; }
    if (draftPaid <= 0) { flash("De pauze is langer dan de dienst.", "error"); return; }
    setBusy(true);
    const values = {
      service_date: shiftDraft.serviceDate, employee_id: shiftDraft.employeeId || null, role: shiftDraft.role.trim() || "bar",
      starts_at: draftWindow.startsAt, ends_at: draftWindow.endsAt, break_minutes: breakMinutes, notes: shiftDraft.notes.trim() || null,
    };
    const { error } = shiftDraft.id
      ? await supabase.from("roster_shifts").update(values).eq("id", shiftDraft.id)
      : await supabase.from("roster_shifts").insert({ ...values, organisation_id: organisation.id, venue_id: venue.id });
    setBusy(false);
    if (error) { flash(friendlyError(error), "error"); return; }
    setShiftDraft(null); flash(shiftDraft.id ? "Dienst bijgewerkt." : "Dienst toegevoegd."); void load();
  }

  async function removeShift() {
    if (!shiftDraft?.id) return;
    setBusy(true);
    const { error } = shiftDraft.published
      ? await supabase.from("roster_shifts").update({ status: shiftDraft.status === "cancelled" ? "scheduled" : "cancelled" }).eq("id", shiftDraft.id)
      : await supabase.from("roster_shifts").delete().eq("id", shiftDraft.id);
    setBusy(false);
    if (error) { flash(friendlyError(error), "error"); return; }
    flash(shiftDraft.published ? (shiftDraft.status === "cancelled" ? "Dienst hersteld." : "Dienst geannuleerd. Publiceer de week opnieuw om het team te informeren.") : "Dienst verwijderd.");
    setShiftDraft(null); void load();
  }

  async function copyPreviousWeek() {
    if (!venue) return;
    if (scheduled.length && !window.confirm("Deze week bevat al diensten. Diensten uit vorige week worden toegevoegd; dubbele boekingen worden overgeslagen. Doorgaan?")) return;
    setBusy(true);
    const previousStart = addDays(weekStart, -7);
    const { data, error } = await supabase.from("roster_shifts").select("*").eq("venue_id", venue.id).eq("status", "scheduled")
      .gte("service_date", previousStart).lte("service_date", addDays(previousStart, 6));
    if (error) { setBusy(false); flash(friendlyError(error), "error"); return; }
    if (!data?.length) { setBusy(false); flash("Vorige week bevat geen diensten om te kopiëren.", "error"); return; }
    let created = 0; let skipped = 0;
    for (const shift of data) {
      const serviceDate = addDays(shift.service_date, 7);
      const window = shiftWindow(serviceDate, localTime(shift.starts_at, timezone), localTime(shift.ends_at, timezone), timezone);
      const employee = shift.employee_id ? employeeById.get(shift.employee_id) : undefined;
      const blocked = employee && (!employee.active || leaveOn(leave, employee.id, serviceDate)?.status === "approved");
      const result = await supabase.from("roster_shifts").insert({
        organisation_id: organisation.id, venue_id: venue.id, service_date: serviceDate, employee_id: blocked ? null : shift.employee_id,
        role: shift.role, starts_at: window.startsAt, ends_at: window.endsAt, break_minutes: shift.break_minutes,
        hourly_cost_minor: blocked ? 0 : shift.hourly_cost_minor, notes: shift.notes,
      });
      if (result.error) skipped += 1; else created += 1;
    }
    setBusy(false);
    flash(`${created} dienst(en) gekopieerd${skipped ? `, ${skipped} overgeslagen (dubbele boeking)` : ""}. Afwezige of inactieve medewerkers zijn als open dienst gezet.`);
    void load();
  }

  async function publishWeek() {
    if (!venue) return;
    const unresolved = totals.warnings + totals.openShifts;
    if (unresolved && !window.confirm(`Er ${unresolved === 1 ? "staat" : "staan"} nog ${totals.openShifts} open dienst(en) en ${totals.warnings} conflict(en). Toch publiceren?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("publish_roster_week", { target_venue_id: venue.id, target_week_start: weekStart, publish_note: null });
    setBusy(false);
    if (error) { flash(friendlyError(error), "error"); return; }
    flash("Week gepubliceerd. Deel het rooster nu met je team."); setShowShare(true); void load();
  }

  async function cycleAvailability(employeeId: string, date: string) {
    if (!canManage) return;
    const current = availability.find((item) => item.employee_id === employeeId && item.service_date === date);
    const next = AVAILABILITY_CYCLE[(AVAILABILITY_CYCLE.indexOf(current?.status ?? null) + 1) % AVAILABILITY_CYCLE.length];
    const { error } = next === null
      ? await supabase.from("roster_availability").delete().eq("id", current!.id)
      : await supabase.from("roster_availability").upsert({ organisation_id: organisation.id, employee_id: employeeId, service_date: date, status: next, source: availabilitySource }, { onConflict: "employee_id,service_date" });
    if (error) { flash(friendlyError(error), "error"); return; }
    void load();
  }

  async function saveEmployee() {
    if (!employeeDraft) return;
    let hourly = 0; let contract: number | null = null;
    try {
      hourly = employeeDraft.hourlyCost.trim() ? Number(decimalToMinor(employeeDraft.hourlyCost.replace("€", ""), "nl-NL")) : 0;
      if (employeeDraft.contractHours.trim()) {
        const hoursMinor = decimalToMinor(employeeDraft.contractHours, "nl-NL"); // hours × 100
        contract = Number((hoursMinor * 60n) / 100n);
      }
    } catch { flash("Controleer uurkosten en contracturen (bijv. 18,50 en 24).", "error"); return; }
    if (hourly < 0 || hourly > 100000) { flash("Uurkosten moeten tussen € 0 en € 1.000 liggen.", "error"); return; }
    if (contract !== null && (contract < 0 || contract > 4800)) { flash("Contracturen moeten tussen 0 en 80 per week liggen.", "error"); return; }
    if (!employeeDraft.fullName.trim()) { flash("Naam is verplicht.", "error"); return; }
    setBusy(true);
    const values = {
      full_name: employeeDraft.fullName.trim(), phone: employeeDraft.phone.trim() || null, email: employeeDraft.email.trim() || null,
      default_role: employeeDraft.defaultRole.trim() || "bar", hourly_cost_minor: hourly, contract_minutes_week: contract,
      active: employeeDraft.active, notes: employeeDraft.notes.trim() || null,
    };
    const { error } = employeeDraft.id
      ? await supabase.from("roster_employees").update(values).eq("id", employeeDraft.id)
      : await supabase.from("roster_employees").insert({ ...values, organisation_id: organisation.id });
    setBusy(false);
    if (error) { flash(error.code === "23514" ? "Controleer het telefoonnummer (bijv. 06 12345678) en de overige velden." : friendlyError(error), "error"); return; }
    setEmployeeDraft(null); flash(employeeDraft.id ? "Medewerker bijgewerkt." : "Medewerker toegevoegd."); void load();
  }

  async function addLeave(form: FormData) {
    const employeeId = String(form.get("employeeId") ?? "");
    const kind = String(form.get("kind") ?? "leave") as RosterLeaveRow["kind"];
    const startsOn = String(form.get("startsOn") ?? ""); const endsOn = String(form.get("endsOn") ?? "") || startsOn;
    if (!employeeId || !startsOn) { flash("Kies een medewerker en een startdatum.", "error"); return; }
    if (endsOn < startsOn) { flash("De einddatum ligt vóór de startdatum.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("roster_leave").insert({ organisation_id: organisation.id, employee_id: employeeId, kind, starts_on: startsOn, ends_on: endsOn, note: String(form.get("note") ?? "").trim() || null });
    setBusy(false);
    if (error) { flash(friendlyError(error), "error"); return; }
    flash(kind === "sick" ? "Ziekmelding vastgelegd." : "Verlof vastgelegd."); void load();
  }
  async function decideLeave(id: string, status: RosterLeaveRow["status"]) {
    const { error } = await supabase.from("roster_leave").update({ status }).eq("id", id);
    if (error) { flash(friendlyError(error), "error"); return; }
    void load();
  }
  async function deleteLeave(id: string) {
    if (!window.confirm("Deze registratie verwijderen?")) return;
    const { error } = await supabase.from("roster_leave").delete().eq("id", id);
    if (error) { flash(friendlyError(error), "error"); return; }
    void load();
  }

  function rosterMessage(employee: RosterEmployeeRow) {
    const mine = scheduled.filter((shift) => shift.employee_id === employee.id);
    const lines = mine.map((shift) => `• ${dayLabel(shift.service_date)} ${localTime(shift.starts_at, timezone)}–${localTime(shift.ends_at, timezone)} (${shift.role})`);
    return `Hoi ${firstName(employee.full_name)}, je rooster bij ${venue?.name} voor week ${isoWeekNumber(weekStart)}:\n${lines.join("\n")}\n\nKlopt er iets niet? Laat het zo snel mogelijk weten.`;
  }
  function availabilityMessage(employee: RosterEmployeeRow) {
    return `Hoi ${firstName(employee.full_name)}, wil je je beschikbaarheid doorgeven voor ${venue?.name}, week ${isoWeekNumber(weekStart)} (${dayLabel(weekStart, { day: "numeric", month: "short" })} – ${dayLabel(weekEnd, { day: "numeric", month: "short" })})?\n\n${days.map((day) => `${dayLabel(day, { weekday: "long", day: "numeric", month: "short" })}: `).join("\n")}\n\nAntwoord per dag met: kan / liefst / kan niet.`;
  }
  function openShiftMessage(employee: RosterEmployeeRow, draft: ShiftDraft) {
    return `Hoi ${firstName(employee.full_name)}, er staat een open dienst bij ${venue?.name}: ${dayLabel(draft.serviceDate, { weekday: "long", day: "numeric", month: "long" })}, ${draft.start}–${draft.end} (${draft.role}). Kun je? Reageer met ja of nee.`;
  }

  if (!venues.length) {
    return <section className="panel roster-empty"><h2>Nog geen vestiging</h2><p>Voeg eerst een vestiging toe in Instellingen. Een rooster hoort altijd bij één vestiging.</p></section>;
  }

  const weekLabel = `Week ${isoWeekNumber(weekStart)} · ${dayLabel(weekStart, { day: "numeric", month: "short" })} – ${dayLabel(weekEnd, { day: "numeric", month: "short", year: "numeric" })}`;
  const publicationState = !latest
    ? { tone: "draft", text: pendingChanges ? "Concept · nog niet gepubliceerd" : "Leeg" }
    : pendingChanges
      ? { tone: "changed", text: `Versie ${latest.version} gepubliceerd · ${pendingChanges} wijziging${pendingChanges === 1 ? "" : "en"} niet gepubliceerd` }
      : { tone: "live", text: `Gepubliceerd · versie ${latest.version}` };

  return <div className="roster">
    <header className="roster-head">
      <div className="roster-title">
        <h1>Team &amp; Rooster</h1>
        <span className={`roster-state ${publicationState.tone}`}>{publicationState.text}</span>
      </div>
      <div className="roster-controls">
        {venues.length > 1 && <select aria-label="Vestiging" value={venueId} onChange={(event) => setVenueId(event.target.value)}>{venues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <div className="week-nav" role="group" aria-label="Week">
          <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorige week">‹</button>
          <span>{weekLabel}</span>
          <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Volgende week">›</button>
          {weekStart !== weekStartOf(today) && <button className="ghost" onClick={() => setWeekStart(weekStartOf(today))}>Deze week</button>}
        </div>
        {canManage && <button className="ghost" disabled={busy} onClick={copyPreviousWeek}>Kopieer vorige week</button>}
        {canPublish && <button className="primary" disabled={busy || pendingChanges === 0} onClick={publishWeek}>{latest ? "Publiceer wijzigingen" : "Publiceer week"}</button>}
      </div>
    </header>

    <section className="roster-metrics" aria-label="Weekoverzicht">
      <div><span>Geplande uren</span><strong>{formatMinutes(totals.minutes)}</strong></div>
      <div><span>Loonkosten</span><strong>{formatMinor(totals.cost, organisation.currency)}</strong><small>{totals.openShifts ? "excl. open diensten" : "alle diensten bezet"}</small></div>
      <div className={totals.openShifts ? "attention" : ""}><span>Open diensten</span><strong>{totals.openShifts}</strong></div>
      <div className={totals.warnings ? "danger" : ""}><span>Conflicten</span><strong>{totals.warnings}</strong></div>
    </section>

    <nav className="roster-tabs" role="tablist">
      {([["roster", "Rooster"], ["availability", "Beschikbaarheid"], ["leave", "Verlof & ziek"], ["team", `Team (${activeEmployees.length})`], ["publications", "Publicaties"]] as [Tab, string][])
        .map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {notice && <div className={`roster-notice ${notice.tone}`} role="status">{notice.text}</div>}
    {loadError && <div className="roster-notice error" role="alert">{loadError} <button className="ghost" onClick={() => void load()}>Opnieuw laden</button></div>}

    {showShare && latest && <section className="panel share-panel">
      <header><div><h3>Rooster delen via WhatsApp</h3><p>Opent WhatsApp met een kant-en-klaar bericht per medewerker. Versie {latest.version}.</p></div><button className="ghost" onClick={() => setShowShare(false)}>Sluiten</button></header>
      <div className="share-list">{employees.filter((employee) => scheduled.some((shift) => shift.employee_id === employee.id)).map((employee) => {
        const link = whatsappLink(employee.phone, rosterMessage(employee));
        return <div key={employee.id}><b>{employee.full_name}</b><span>{scheduled.filter((shift) => shift.employee_id === employee.id).length} dienst(en)</span>
          {link ? <a className="ghost" href={link} target="_blank" rel="noreferrer">Stuur via WhatsApp</a> : <em>Geen geldig telefoonnummer</em>}</div>;
      })}</div>
    </section>}

    {loading ? <section className="panel roster-loading" aria-busy="true">Rooster laden…</section> : <>
      {tab === "roster" && (employees.length === 0
        ? <section className="panel roster-empty"><h2>Begin met je team</h2><p>Voeg medewerkers toe met hun uurkosten. Daarna plan je diensten en zie je direct de loonkosten per avond.</p>{canManage && <button className="primary" onClick={() => { setTab("team"); setEmployeeDraft(emptyEmployee()); }}>Medewerker toevoegen</button>}</section>
        : <section className="panel grid-panel">
          <div className="roster-grid" style={{ gridTemplateColumns: `minmax(170px,1.3fr) repeat(7,minmax(118px,1fr))` }}>
            <div className="cell head sticky">Medewerker</div>
            {days.map((day) => <div key={day} className={`cell head ${day === today ? "today" : ""}`}>{dayLabel(day)}</div>)}

            <div className="cell sticky name open-row"><b>Open diensten</b><small>Nog niet ingevuld</small></div>
            {days.map((day) => <div key={day} className={`cell slot ${day === today ? "today" : ""}`}>
              {scheduled.filter((shift) => !shift.employee_id && shift.service_date === day).map((shift) => <ShiftChip key={shift.id} shift={shift} timezone={timezone} warnings={[]} onOpen={() => openShift(shift)} />)}
              {canManage && <button className="add" onClick={() => openNewShift(day)} aria-label={`Open dienst toevoegen op ${dayLabel(day)}`}>+</button>}
            </div>)}

            {rosterRows.map((employee) => {
              const person = totals.perEmployee.get(employee.id);
              const over = employee.contract_minutes_week !== null && (person?.minutes ?? 0) > employee.contract_minutes_week;
              return <RowFragment key={employee.id}>
                <div className="cell sticky name">
                  <b>{employee.full_name}{!employee.active && <em> (inactief)</em>}</b>
                  <small className={over ? "over" : ""}>{formatMinutes(person?.minutes ?? 0)}{employee.contract_minutes_week !== null ? ` / ${formatMinutes(employee.contract_minutes_week)}` : ""} · {formatMinor(person?.cost ?? 0n, organisation.currency)}</small>
                </div>
                {days.map((day) => {
                  const mark = availability.find((item) => item.employee_id === employee.id && item.service_date === day);
                  const absence = leaveOn(leave, employee.id, day);
                  const blocked = absence?.status === "approved" || mark?.status === "unavailable";
                  return <div key={day} className={`cell slot ${day === today ? "today" : ""} ${blocked ? "blocked" : ""} ${mark?.status === "preferred" ? "preferred" : ""}`}>
                    {absence && <span className={`tag ${absence.status}`}>{LEAVE_LABEL[absence.kind]}{absence.status === "requested" ? "?" : ""}</span>}
                    {!absence && mark && <span className={`tag avail-${mark.status}`}>{AVAILABILITY_LABEL[mark.status]}</span>}
                    {scheduled.filter((shift) => shift.employee_id === employee.id && shift.service_date === day).map((shift) => <ShiftChip key={shift.id} shift={shift} timezone={timezone} warnings={shiftWarnings(shift, context)} onOpen={() => openShift(shift)} />)}
                    {canManage && employee.active && <button className="add" onClick={() => openNewShift(day, employee.id)} aria-label={`Dienst toevoegen voor ${employee.full_name} op ${dayLabel(day)}`}>+</button>}
                  </div>;
                })}
              </RowFragment>;
            })}

            <div className="cell sticky foot">Totaal per dag</div>
            {days.map((day) => { const summary = totals.perDay.get(day); return <div key={day} className="cell foot">
              <b>{formatMinutes(summary?.minutes ?? 0)}</b><small>{formatMinor(summary?.cost ?? 0n, organisation.currency)}{summary?.open ? ` · ${summary.open} open` : ""}</small>
            </div>; })}
          </div>
          {shifts.some((shift) => shift.status === "cancelled") && <p className="grid-note">{shifts.filter((shift) => shift.status === "cancelled").length} geannuleerde dienst(en) zijn verborgen; ze verdwijnen uit het rooster bij de volgende publicatie.</p>}
        </section>)}

      {tab === "availability" && <section className="panel">
        <header><div><h3>Beschikbaarheid · {weekLabel}</h3><p>Tik op een vakje: leeg → kan → liefst → kan niet. Leg vast waar het antwoord vandaan kwam.</p></div>
          {canManage && <label className="inline">Bron <select value={availabilitySource} onChange={(event) => setAvailabilitySource(event.target.value as RosterAvailabilityRow["source"])}><option value="whatsapp">WhatsApp</option><option value="phone">Telefoon</option><option value="manager">Manager</option></select></label>}
        </header>
        {activeEmployees.length === 0 ? <div className="roster-empty"><p>Voeg eerst medewerkers toe.</p></div> :
          <div className="grid-panel"><div className="roster-grid availability" style={{ gridTemplateColumns: `minmax(170px,1.3fr) repeat(7,minmax(84px,1fr)) minmax(150px,1fr)` }}>
            <div className="cell head sticky">Medewerker</div>
            {days.map((day) => <div key={day} className="cell head">{dayLabel(day)}</div>)}
            <div className="cell head">Uitvragen</div>
            {activeEmployees.map((employee) => <RowFragment key={employee.id}>
              <div className="cell sticky name"><b>{employee.full_name}</b></div>
              {days.map((day) => {
                const mark = availability.find((item) => item.employee_id === employee.id && item.service_date === day);
                const absence = leaveOn(leave, employee.id, day);
                return <div key={day} className="cell slot center">
                  {absence?.status === "approved" ? <span className="tag approved">{LEAVE_LABEL[absence.kind]}</span> :
                    <button className={`avail ${mark?.status ?? "none"}`} disabled={!canManage} onClick={() => void cycleAvailability(employee.id, day)} title={mark ? `Bron: ${mark.source}` : "Nog onbekend"}>{mark ? AVAILABILITY_LABEL[mark.status] : "—"}</button>}
                </div>;
              })}
              <div className="cell slot center">{(() => { const link = whatsappLink(employee.phone, availabilityMessage(employee)); return link ? <a className="ghost" href={link} target="_blank" rel="noreferrer">Vraag via WhatsApp</a> : <em className="muted">Geen nummer</em>; })()}</div>
            </RowFragment>)}
          </div></div>}
      </section>}

      {tab === "leave" && <section className="panel">
        <header><div><h3>Verlof &amp; ziekmeldingen</h3><p>Ziekmeldingen gelden direct. Verlofaanvragen moeten worden goedgekeurd. Leg geen medische details vast.</p></div></header>
        {canManage && activeEmployees.length > 0 && <form className="leave-form" action={addLeave}>
          <label>Medewerker<select name="employeeId" required defaultValue=""><option value="" disabled>Kies</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
          <label>Soort<select name="kind" defaultValue="leave"><option value="leave">Verlof</option><option value="sick">Ziek</option><option value="other">Overig afwezig</option></select></label>
          <label>Van<input type="date" name="startsOn" required defaultValue={today} /></label>
          <label>Tot en met<input type="date" name="endsOn" /></label>
          <label className="wide">Notitie<input name="note" maxLength={300} placeholder="Optioneel, zonder medische details" /></label>
          <button className="primary" disabled={busy}>Vastleggen</button>
        </form>}
        {leave.length === 0 ? <div className="roster-empty"><p>Geen lopend of komend verlof.</p></div> :
          <div className="list">{leave.map((item) => <div key={item.id} className="list-row">
            <div><b>{employeeById.get(item.employee_id)?.full_name ?? "Onbekend"}</b><small>{LEAVE_LABEL[item.kind]} · {dayLabel(item.starts_on)}{item.ends_on !== item.starts_on ? ` – ${dayLabel(item.ends_on)}` : ""}{item.note ? ` · ${item.note}` : ""}</small></div>
            <span className={`tag ${item.status}`}>{item.kind === "sick" ? "Ziek gemeld" : STATUS_LABEL[item.status]}</span>
            <div className="row-actions">
              {canPublish && item.kind !== "sick" && item.status === "requested" && <><button className="ghost" onClick={() => void decideLeave(item.id, "approved")}>Goedkeuren</button><button className="ghost" onClick={() => void decideLeave(item.id, "rejected")}>Afwijzen</button></>}
              {canManage && <button className="ghost" onClick={() => void deleteLeave(item.id)}>Verwijderen</button>}
            </div>
          </div>)}</div>}
      </section>}

      {tab === "team" && <section className="panel">
        <header><div><h3>Team</h3><p>Uurkosten = totale loonkosten per uur incl. werkgeverslasten. Hiermee berekent NightProfit de loonkosten per dienst.</p></div>
          {canManage && <button className="primary" onClick={() => setEmployeeDraft(emptyEmployee())}>Medewerker toevoegen</button>}</header>
        {employees.length === 0 ? <div className="roster-empty"><p>Nog geen medewerkers.</p></div> :
          <div className="list">{employees.map((employee) => <div key={employee.id} className={`list-row ${employee.active ? "" : "inactive"}`}>
            <div><b>{employee.full_name}</b><small>{employee.default_role} · {formatMinor(employee.hourly_cost_minor, organisation.currency)}/u{employee.contract_minutes_week !== null ? ` · ${minutesToHoursText(employee.contract_minutes_week)} u/week` : ""}{employee.phone ? ` · ${employee.phone}` : " · geen telefoonnummer"}</small></div>
            <span className={`tag ${employee.active ? "approved" : "rejected"}`}>{employee.active ? "Actief" : "Inactief"}</span>
            <div className="row-actions">{canManage && <button className="ghost" onClick={() => setEmployeeDraft({ id: employee.id, fullName: employee.full_name, phone: employee.phone ?? "", email: employee.email ?? "", defaultRole: employee.default_role, hourlyCost: minorToInput(employee.hourly_cost_minor), contractHours: minutesToHoursText(employee.contract_minutes_week), active: employee.active, notes: employee.notes ?? "" })}>Bewerken</button>}</div>
          </div>)}</div>}
      </section>}

      {tab === "publications" && <section className="panel">
        <header><div><h3>Publicaties · {weekLabel}</h3><p>Elke publicatie is een onveranderbare momentopname met vingerafdruk. Wijzigingen daarna vragen om een nieuwe versie.</p></div>
          {latest && <button className="ghost" onClick={() => setShowShare(true)}>Deel via WhatsApp</button>}</header>
        {publications.length === 0 ? <div className="roster-empty"><p>Deze week is nog niet gepubliceerd.</p></div> :
          <div className="list">{publications.map((publication) => <div key={publication.id} className="list-row">
            <div><b>Versie {publication.version}</b><small>{new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(publication.published_at))} · {publication.shift_count} diensten · {publication.open_shift_count} open · {formatMinutes(Number(publication.paid_minutes))} · {formatMinor(publication.labour_cost_minor, organisation.currency)}</small></div>
            <code title={publication.content_hash}>{publication.content_hash.slice(0, 12)}</code>
          </div>)}</div>}
      </section>}
    </>}

    {shiftDraft && <div className="roster-modal" role="dialog" aria-modal="true" aria-label="Dienst" onKeyDown={(event) => { if (event.key === "Escape") setShiftDraft(null); }}>
      <button className="scrim-btn" aria-label="Sluiten" onClick={() => setShiftDraft(null)} />
      <div className="modal-card">
        <header><h3>{shiftDraft.id ? "Dienst bewerken" : "Nieuwe dienst"}</h3>{shiftDraft.published && <span className="roster-state live">Gepubliceerd</span>}{shiftDraft.status === "cancelled" && <span className="roster-state changed">Geannuleerd</span>}</header>
        <fieldset disabled={!canManage || busy}>
          <label>Dag<select value={shiftDraft.serviceDate} onChange={(event) => setShiftDraft({ ...shiftDraft, serviceDate: event.target.value })}>{days.map((day) => <option key={day} value={day}>{dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}</option>)}</select></label>
          <label>Medewerker<select value={shiftDraft.employeeId} onChange={(event) => { const employee = employeeById.get(event.target.value); setShiftDraft({ ...shiftDraft, employeeId: event.target.value, role: employee && !shiftDraft.id ? employee.default_role : shiftDraft.role }); }}>
            <option value="">Open dienst (nog niet ingevuld)</option>
            {employees.filter((employee) => employee.active || employee.id === shiftDraft.employeeId).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
          </select></label>
          <label>Functie<input list="roster-roles" value={shiftDraft.role} maxLength={40} onChange={(event) => setShiftDraft({ ...shiftDraft, role: event.target.value })} /><datalist id="roster-roles">{ROLES.map((role) => <option key={role} value={role} />)}</datalist></label>
          <div className="pair">
            <label>Start<input type="time" value={shiftDraft.start} onChange={(event) => setShiftDraft({ ...shiftDraft, start: event.target.value })} /></label>
            <label>Einde<input type="time" value={shiftDraft.end} onChange={(event) => setShiftDraft({ ...shiftDraft, end: event.target.value })} /></label>
            <label>Pauze (min)<input type="number" min={0} max={180} step={5} value={shiftDraft.breakMinutes} onChange={(event) => setShiftDraft({ ...shiftDraft, breakMinutes: event.target.value })} /></label>
          </div>
          <label>Notitie<input value={shiftDraft.notes} maxLength={500} onChange={(event) => setShiftDraft({ ...shiftDraft, notes: event.target.value })} placeholder="Bijv. sluiten, kassa tellen" /></label>
        </fieldset>
        <div className="modal-summary">
          <span>{draftWindow ? `${formatMinutes(Math.max(draftPaid, 0))} betaald${draftWindow && shiftDraft.end <= shiftDraft.start ? " · eindigt volgende dag" : ""}` : "Ongeldige tijden"}</span>
          <b>{draftEmployee ? formatMinor(shiftCostMinor(Math.max(draftPaid, 0), draftEmployee.hourly_cost_minor), organisation.currency) : "Kosten bekend na invulling"}</b>
        </div>
        {draftWarnings.length > 0 && <ul className="warnings">{draftWarnings.map((warning) => <li key={warning}>{WARNING_TEXT[warning]}</li>)}</ul>}
        {canManage && !shiftDraft.employeeId && draftWindow && <div className="candidates">
          <h4>Wie kan deze dienst draaien?</h4>
          {draftCandidates.length === 0 ? <p className="muted">Niemand beschikbaar zonder conflict. Vraag beschikbaarheid uit of pas de tijden aan.</p> :
            draftCandidates.map((candidate) => { const employee = employeeById.get(candidate.employeeId)!; const link = whatsappLink(employee.phone, openShiftMessage(employee, shiftDraft)); return <div key={candidate.employeeId} className="candidate">
              <div><b>{employee.full_name}</b><small>{candidate.availability === "unknown" ? "Beschikbaarheid onbekend" : AVAILABILITY_LABEL[candidate.availability]} · {formatMinutes(candidate.weekMinutes)}{candidate.contractMinutes !== null ? ` / ${formatMinutes(candidate.contractMinutes)}` : ""} deze week · {formatMinor(employee.hourly_cost_minor, organisation.currency)}/u</small></div>
              <div className="row-actions">{link && <a className="ghost" href={link} target="_blank" rel="noreferrer">Vraag</a>}<button className="ghost" onClick={() => setShiftDraft({ ...shiftDraft, employeeId: employee.id })}>Inplannen</button></div>
            </div>; })}
        </div>}
        <footer>
          {canManage && shiftDraft.id && <button className="ghost danger" disabled={busy} onClick={() => void removeShift()}>{shiftDraft.published ? (shiftDraft.status === "cancelled" ? "Herstellen" : "Annuleren") : "Verwijderen"}</button>}
          <span className="spacer" />
          <button className="ghost" onClick={() => setShiftDraft(null)}>Sluiten</button>
          {canManage && shiftDraft.status === "scheduled" && <button className="primary" disabled={busy || !draftWindow} onClick={() => void saveShift()}>{busy ? "Opslaan…" : "Opslaan"}</button>}
        </footer>
      </div>
    </div>}

    {employeeDraft && <div className="roster-modal" role="dialog" aria-modal="true" aria-label="Medewerker">
      <button className="scrim-btn" aria-label="Sluiten" onClick={() => setEmployeeDraft(null)} />
      <div className="modal-card">
        <header><h3>{employeeDraft.id ? "Medewerker bewerken" : "Nieuwe medewerker"}</h3></header>
        <fieldset disabled={busy}>
          <label>Naam<input value={employeeDraft.fullName} maxLength={120} onChange={(event) => setEmployeeDraft({ ...employeeDraft, fullName: event.target.value })} autoFocus /></label>
          <div className="pair">
            <label>Telefoon (WhatsApp)<input value={employeeDraft.phone} inputMode="tel" placeholder="06 12345678" onChange={(event) => setEmployeeDraft({ ...employeeDraft, phone: event.target.value })} /></label>
            <label>E-mail<input type="email" value={employeeDraft.email} onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })} /></label>
          </div>
          <div className="pair">
            <label>Standaardfunctie<input list="roster-roles" value={employeeDraft.defaultRole} onChange={(event) => setEmployeeDraft({ ...employeeDraft, defaultRole: event.target.value })} /><datalist id="roster-roles">{ROLES.map((role) => <option key={role} value={role} />)}</datalist></label>
            <label>Uurkosten (€)<input inputMode="decimal" value={employeeDraft.hourlyCost} placeholder="18,50" onChange={(event) => setEmployeeDraft({ ...employeeDraft, hourlyCost: event.target.value })} /></label>
            <label>Contracturen/week<input inputMode="decimal" value={employeeDraft.contractHours} placeholder="Leeg = oproep" onChange={(event) => setEmployeeDraft({ ...employeeDraft, contractHours: event.target.value })} /></label>
          </div>
          <label>Notitie<input value={employeeDraft.notes} maxLength={500} onChange={(event) => setEmployeeDraft({ ...employeeDraft, notes: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={employeeDraft.active} onChange={(event) => setEmployeeDraft({ ...employeeDraft, active: event.target.checked })} /> Actief (inplanbaar)</label>
        </fieldset>
        <footer><span className="spacer" /><button className="ghost" onClick={() => setEmployeeDraft(null)}>Annuleren</button><button className="primary" disabled={busy} onClick={() => void saveEmployee()}>{busy ? "Opslaan…" : "Opslaan"}</button></footer>
      </div>
    </div>}
  </div>;
}

function emptyEmployee(): EmployeeDraft {
  return { fullName: "", phone: "", email: "", defaultRole: "bar", hourlyCost: "", contractHours: "", active: true, notes: "" };
}

function RowFragment({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function ShiftChip({ shift, timezone, warnings, onOpen }: { shift: RosterShiftRow; timezone: string; warnings: ShiftWarning[]; onOpen: () => void }) {
  return <button className={`shift ${warnings.length ? "warn" : ""} ${shift.changed_since_publish ? "changed" : ""} ${shift.employee_id ? "" : "open"}`} onClick={onOpen}
    title={warnings.map((warning) => WARNING_TEXT[warning]).join(" · ") || undefined}>
    <b>{localTime(shift.starts_at, timezone)}–{localTime(shift.ends_at, timezone)}</b>
    <span>{shift.role}{shift.break_minutes ? ` · ${shift.break_minutes}m pauze` : ""}</span>
    {warnings.length > 0 && <i aria-label="Conflict">!</i>}
  </button>;
}
