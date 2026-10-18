"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AddPersonPanel } from "./add-person";
import { ServiceNightsPanel } from "./service-nights";
import { addDays, deadlineLabel, firstName, isoWeekNumber, mondayOf, nightOf, nightsLabel, zonedInstant } from "../lib/planning/nights";

type Lane = "staff" | "dj";
type Answer = "available" | "preferably_not" | "unavailable";
type Venue = { id: string; name: string; timezone: string };
type Department = { id: string; venue_id: string; name: string; kind?: Lane };
type Role = { id: string; department_id: string; name: string; hourly_cost_minor: string };
export type PlannerStaff = { id: string; full_name: string; contact_phone: string | null; preferred_language: string; employment_status: string; invitation_state: string; auth_user_id: string | null };
export type PlannerShift = { id: string; venue_id: string; department_id: string; role_id: string; staff_id: string | null; starts_at: string; ends_at: string; status: string; revision: number; locked: boolean };
type AvailabilityRow = { staff_id: string; venue_id: string; starts_at: string; availability: string; submitted_at: string | null };
type RequestRow = { id: string; venue_id: string; starts_at: string; ends_at: string; deadline_at: string; status: string; created_at: string; requested_dates: string[] | null };
type RecipientRow = { id: string; request_id: string; staff_id: string; status: string };
type Pattern = { venue_id: string; iso_weekday: number; active: boolean; lines: { role_id: string; count: number; start: string; end: string; break_minutes: number }[] };

type Sheet =
  | { kind: "slot"; shiftId: string }
  | { kind: "cell"; staffId: string; night: string }
  | { kind: "request" }
  | { kind: "responses" }
  | { kind: "publish" }
  | { kind: "team" }
  | { kind: "person" }
  | { kind: "nights" }
  | { kind: "open"; date: string };

type Toast = { text: string; tone?: "bad"; undo?: () => void };

const ANSWERED = ["submitted", "partial", "responded"];
const parse = (date: string) => new Date(`${date}T12:00:00Z`);
const weekdayIndex = (date: string) => ((parse(date).getUTCDay() + 6) % 7) + 1;
const dayLong = (date: string) => parse(date).toLocaleDateString("nl-NL", { weekday: "long", timeZone: "UTC" });
const dayShort = (date: string) => parse(date).toLocaleDateString("nl-NL", { weekday: "short", timeZone: "UTC" }).replace(".", "");
const dateShort = (date: string) => parse(date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
const addMonths = (date: string, months: number) => { const [year, month] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1 + months, 1, 12)).toISOString().slice(0, 10); };
const monthLabel = (date: string) => parse(date).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const initials = (name: string) => { const parts = name.trim().split(/\s+/); return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)![0] : ""}`.toUpperCase(); };
const shortName = (name: string) => { const parts = name.trim().split(/\s+/); return parts.length > 1 ? `${parts[0]} ${parts.at(-1)![0]}.` : parts[0]; };
const normalizeAnswer = (value: string | undefined): Answer | undefined => (value === "preferred" ? "available" : (value as Answer | undefined));
const stableHash = (value: string) => { let hash = 0; for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0; return hash; };
const waNumber = (phone: string | null) => (phone ? phone.replace(/[^\d]/g, "").replace(/^0(?=6)/, "31") : "");

export function Planner({
  organisationId,
  venue,
  plannerName,
  departments,
  roles,
  staff,
  initialShifts,
  availability,
  requests,
  recipients,
  qualifications,
  patterns,
  plannerUserIds,
  canManageMembers,
  whatsappReady,
}: {
  organisationId: string;
  venue: Venue;
  plannerName: string;
  departments: Department[];
  roles: Role[];
  staff: PlannerStaff[];
  initialShifts: PlannerShift[];
  availability: AvailabilityRow[];
  requests: RequestRow[];
  recipients: RecipientRow[];
  qualifications: { staff_id: string; role_id: string }[];
  patterns: Pattern[];
  plannerUserIds: string[];
  canManageMembers: boolean;
  whatsappReady: boolean;
}) {
  const router = useRouter();
  const tz = venue.timezone || "Europe/Amsterdam";
  const [now] = useState(() => Date.now());
  const today = nightOf(new Date(now).toISOString(), tz);
  // On Sunday the week is over; open on the coming week.
  const homeFocus = weekdayIndex(today) === 7 ? addDays(today, 1) : today;
  const homeWeek = mondayOf(homeFocus);
  const [focus, setFocus] = useState(homeFocus);
  const [mode, setMode] = useState<"day" | "week" | "month">("week");
  const week = mondayOf(focus);
  const [lane, setLane] = useState<Lane>("staff");
  const [view, setView] = useState<"nights" | "people">("nights");
  const [shifts, setShifts] = useState(initialShifts);
  const [sourceShifts, setSourceShifts] = useState(initialShifts);
  if (sourceShifts !== initialShifts) { setSourceShifts(initialShifts); setShifts(initialShifts); }
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobileNight, setMobileNight] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.undo ? 9000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const say = (next: Toast) => setToast(next);

  // ---------- lanes, people, answers ----------
  const venueDepartments = departments.filter((department) => department.venue_id === venue.id);
  const laneOfDepartment = (id: string): Lane => (venueDepartments.find((department) => department.id === id)?.kind === "dj" ? "dj" : "staff");
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const laneOfRole = (id: string): Lane => laneOfDepartment(roleById.get(id)?.department_id ?? "");
  const venueRoles = roles.filter((role) => venueDepartments.some((department) => department.id === role.department_id));
  const hasDj = venueDepartments.some((department) => department.kind === "dj");
  const team = staff.filter((person) => person.employment_status !== "deactivated");
  const lanesOf = (staffId: string) => new Set(qualifications.filter((row) => row.staff_id === staffId).map((row) => laneOfRole(row.role_id)));
  const inLane = (staffId: string, which: Lane) => { const lanes = lanesOf(staffId); return lanes.size ? lanes.has(which) : which === "staff"; };
  const laneTeam = team.filter((person) => inLane(person.id, lane)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const personById = new Map(staff.map((person) => [person.id, person]));

  const answers = useMemo(() => {
    const map = new Map<string, { value: Answer; at: string }>();
    for (const row of availability) {
      if (row.venue_id !== venue.id) continue;
      const key = `${row.staff_id}|${nightOf(row.starts_at, tz)}`;
      const at = row.submitted_at ?? "";
      const current = map.get(key);
      const value = normalizeAnswer(row.availability);
      if (value && (!current || at >= current.at)) map.set(key, { value, at });
    }
    return map;
  }, [availability, venue.id, tz]);
  const answerOf = (staffId: string, night: string) => answers.get(`${staffId}|${night}`)?.value;

  // ---------- the week ----------
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const activeWeekdays = new Set(patterns.filter((pattern) => pattern.venue_id === venue.id && pattern.active).map((pattern) => pattern.iso_weekday));
  const live = shifts.filter((shift) => shift.venue_id === venue.id && shift.status !== "cancelled" && shift.status !== "rejected");
  const weekShifts = live.filter((shift) => weekDates.includes(nightOf(shift.starts_at, tz)));
  const plannedNights = new Set(weekShifts.map((shift) => nightOf(shift.starts_at, tz)));
  const nights = weekDates.filter((date) => plannedNights.has(date) || activeWeekdays.has(weekdayIndex(date)));
  const missingNights = weekDates.filter((date) => activeWeekdays.has(weekdayIndex(date)) && !plannedNights.has(date) && date >= today);
  const laneShifts = weekShifts.filter((shift) => laneOfRole(shift.role_id) === lane);
  const slotsOf = (night: string) => laneShifts.filter((shift) => nightOf(shift.starts_at, tz) === night).sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at) || a.role_id.localeCompare(b.role_id) || (a.staff_id ? 0 : 1) - (b.staff_id ? 0 : 1) || a.id.localeCompare(b.id));
  const time = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const weekLoad = (staffId: string) => weekShifts.filter((shift) => shift.staff_id === staffId).length;
  const shiftOn = (staffId: string, night: string) => weekShifts.find((shift) => shift.staff_id === staffId && nightOf(shift.starts_at, tz) === night);

  const filled = laneShifts.filter((shift) => shift.staff_id).length;
  const open = laneShifts.length - filled;
  const drafts = weekShifts.filter((shift) => shift.status === "draft");
  const published = weekShifts.filter((shift) => shift.status === "published");
  const weekNumber = isoWeekNumber(week);
  const firstNight = nights.find((night) => night >= today) ?? nights[0];
  const shownNight = mobileNight && nights.includes(mobileNight) ? mobileNight : firstNight;

  // ---------- availability request for this week ----------
  const weekRequests = requests
    .filter((request) => request.venue_id === venue.id && request.status !== "cancelled")
    .filter((request) => (request.requested_dates ? request.requested_dates.some((date) => weekDates.includes(date)) : new Date(request.starts_at).getTime() < parse(addDays(week, 7)).getTime() && new Date(request.ends_at).getTime() > parse(week).getTime()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const currentRequest = weekRequests[0];
  const requestRecipients = currentRequest ? recipients.filter((row) => row.request_id === currentRequest.id) : [];
  const answeredCount = requestRecipients.filter((row) => ANSWERED.includes(row.status)).length;
  const deadlinePassed = currentRequest ? new Date(currentRequest.deadline_at).getTime() < now : false;

  // ---------- writes ----------
  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/planner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, venueId: venue.id, ...body }) });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { errorCode?: string };
    if (!response.ok) throw new Error(result.errorCode ?? "FAILED");
    return result;
  }
  const errorText = (code: string) =>
    ({
      SHIFT_OVERLAP: "Die persoon staat op dat moment al ergens anders ingepland.",
      STAFF_NOT_IN_TEAM: "Die persoon hoort niet (meer) bij dit team.",
      SHIFT_LOCKED: "Deze plek is vergrendeld in de uitgebreide planner.",
      SHIFT_NOT_EDITABLE: "Deze dienst is al afgerond en kan niet meer veranderen.",
      FORBIDDEN: "Je hebt geen planningsrechten.",
      OVERLAPPING_SHIFTS: "Iemand staat dubbel ingepland. Haal één van de twee weg.",
      ABSENCE_CONFLICT: "Iemand staat ingepland tijdens goedgekeurd verlof.",
    })[code] ?? "Dat lukte niet. Probeer het opnieuw.";

  async function assign(changes: { shiftId: string; staffId: string | null }[], message?: string, undoable = true) {
    if (!changes.length) return;
    const before = new Map(shifts.map((shift) => [shift.id, shift]));
    const previous = changes.map((change) => ({ shiftId: change.shiftId, staffId: before.get(change.shiftId)?.staff_id ?? null }));
    setShifts((current) => current.map((shift) => { const change = changes.find((item) => item.shiftId === shift.id); return change ? { ...shift, staff_id: change.staffId, status: "draft" } : shift; }));
    try {
      await post({ action: "assign", changes });
      if (message) say({ text: message, undo: undoable ? () => void assign(previous, "Teruggezet.", false) : undefined });
      router.refresh();
    } catch (error) {
      setShifts((current) => current.map((shift) => before.get(shift.id) ?? shift));
      say({ text: errorText(error instanceof Error ? error.message : ""), tone: "bad" });
    }
  }

  async function addSlot(template: PlannerShift) {
    setBusy(true);
    try {
      const result = await post({ action: "add_slot", roleId: template.role_id, startsAt: template.starts_at, endsAt: template.ends_at });
      setShifts((current) => [...current, { ...template, id: String(result.shiftId), staff_id: null, status: "draft", revision: 1, locked: false }]);
      router.refresh();
    } catch (error) { say({ text: errorText(error instanceof Error ? error.message : ""), tone: "bad" }); } finally { setBusy(false); }
  }

  async function removeSlot(shiftId: string) {
    setBusy(true);
    try {
      await post({ action: "remove_slots", shiftIds: [shiftId] });
      setShifts((current) => current.filter((shift) => shift.id !== shiftId));
      setSheet(null);
      say({ text: "Plek verwijderd." });
      router.refresh();
    } catch (error) { say({ text: errorText(error instanceof Error ? error.message : ""), tone: "bad" }); } finally { setBusy(false); }
  }

  async function prepareWeek() {
    setBusy(true);
    try {
      const response = await fetch("/api/planning/nights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, action: "week_apply", values: { venueId: venue.id, weekStart: week } }) });
      if (!response.ok) throw new Error();
      say({ text: `Week ${weekNumber} staat klaar. Vul nu de plekken.` });
      router.refresh();
    } catch { say({ text: "De avonden klaarzetten lukte niet.", tone: "bad" }); } finally { setBusy(false); }
  }

  // Fill open slots with people who said they can, fewest shifts this week first.
  function autoFillPlan() {
    const load = new Map(team.map((person) => [person.id, weekLoad(person.id)]));
    const taken = new Set(weekShifts.filter((shift) => shift.staff_id).map((shift) => `${shift.staff_id}|${nightOf(shift.starts_at, tz)}`));
    const changes: { shiftId: string; staffId: string }[] = [];
    let stillOpen = 0;
    for (const night of nights.filter((date) => date >= today)) {
      for (const slot of slotsOf(night).filter((shift) => !shift.staff_id)) {
        const candidates = laneTeam
          .filter((person) => answerOf(person.id, night) === "available" && !taken.has(`${person.id}|${night}`))
          .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || stableHash(a.id + night) - stableHash(b.id + night));
        const pick = candidates[0];
        if (!pick) { stillOpen += 1; continue; }
        changes.push({ shiftId: slot.id, staffId: pick.id });
        taken.add(`${pick.id}|${night}`);
        load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
      }
    }
    return { changes, stillOpen };
  }
  const autoPlan = autoFillPlan();
  function autoFill() {
    const { changes, stillOpen } = autoPlan;
    if (!changes.length) { say({ text: "Er is niemand meer die kan en nog vrij is. Vraag beschikbaarheid of kies zelf." }); return; }
    void assign(changes, `${changes.length} ${changes.length === 1 ? "plek" : "plekken"} gevuld met wie kan.${stillOpen ? ` ${stillOpen} nog open.` : ""}`);
  }

  // ---------- headline ----------
  const nextGap = nights.filter((night) => night >= today).map((night) => ({ night, open: slotsOf(night).filter((shift) => !shift.staff_id).length })).find((row) => row.open > 0);
  const headline = !nights.length
    ? "Deze week zijn er nog geen avonden."
    : missingNights.length
      ? `${capital(nightsLabel(missingNights))} ${missingNights.length === 1 ? "staat" : "staan"} nog niet klaar.`
      : nextGap
        ? `${capital(dayLong(nextGap.night))} mist nog ${nextGap.open} ${nextGap.open === 1 ? (lane === "dj" ? "DJ" : "persoon") : "mensen"}.`
        : drafts.length
          ? "Alles is ingedeeld. Publiceer om het iedereen te laten weten."
          : published.length
            ? "Iedereen weet wanneer ze werken."
            : "Alles staat.";

  // ---------- render ----------
  const rawSteps: { title: string; text: string; action?: ReactNode; done: boolean; ready: boolean }[] = [
    {
      title: "Beschikbaarheid",
      text: !team.length
        ? "Voeg eerst je team toe"
        : !currentRequest
        ? "Nog niet gevraagd"
        : `${answeredCount} van ${requestRecipients.length} gereageerd${deadlinePassed ? ", deadline voorbij" : `, tot ${deadlineLabel(currentRequest.deadline_at, tz)}`}`,
      action: !team.length
        ? <button type="button" className="pl-btn" onClick={() => setSheet(canManageMembers ? { kind: "person" } : { kind: "team" })}>+ Persoon toevoegen</button>
        : currentRequest
        ? <button type="button" className="pl-btn" onClick={() => setSheet({ kind: "responses" })}>Bekijk antwoorden</button>
        : <button type="button" className="pl-btn" onClick={() => setSheet({ kind: "request" })}>Vraag beschikbaarheid</button>,
      done: Boolean(currentRequest),
      ready: true,
    },
    {
      title: "Indelen",
      text: laneShifts.length ? `${filled} van ${laneShifts.length} plekken gevuld` : "Nog geen plekken",
      action: open && autoPlan.changes.length ? <button type="button" className="pl-btn" onClick={autoFill}>Vul aan met wie kan</button> : undefined,
      done: laneShifts.length > 0 && open === 0,
      ready: laneShifts.length > 0,
    },
    {
      title: "Publiceren",
      text: drafts.length ? `${drafts.length} ${drafts.length === 1 ? "wijziging" : "wijzigingen"} nog niet gepubliceerd` : published.length ? "Gepubliceerd" : "Nog niets om te publiceren",
      action: drafts.length || published.length ? <button type="button" className="pl-btn" onClick={() => setSheet({ kind: "publish" })}>{drafts.length ? "Publiceer en stuur" : "Stuur opnieuw"}</button> : undefined,
      done: drafts.length === 0 && published.length > 0,
      ready: drafts.length > 0,
    },
  ];
  // Exactly one step is "now": the first one that isn't done (or the publish step once everything is filled).
  const nowIndex = rawSteps.findIndex((step) => !step.done && step.ready);
  const steps = rawSteps.map((step, index) => ({ ...step, state: (index === nowIndex ? "now" : step.done ? "done" : "todo") as "now" | "done" | "todo" }));

  // ---------- day / month helpers ----------
  const atHome = mode === "day" ? focus === homeFocus : mode === "week" ? week === homeWeek : focus.slice(0, 7) === homeFocus.slice(0, 7);
  function move(direction: 1 | -1) {
    setMobileNight(null);
    setFocus(mode === "day" ? addDays(focus, direction) : mode === "week" ? addDays(focus, 7 * direction) : addMonths(focus, direction));
  }
  const nightsOfLive = useMemo(() => {
    const map = new Map<string, PlannerShift[]>();
    for (const shift of shifts) {
      if (shift.venue_id !== venue.id || shift.status === "cancelled" || shift.status === "rejected") continue;
      const key = nightOf(shift.starts_at, tz);
      const list = map.get(key);
      if (list) list.push(shift); else map.set(key, [shift]);
    }
    return map;
  }, [shifts, venue.id, tz]);
  const dayHasPlan = (date: string) => (nightsOfLive.get(date) ?? []).length > 0;
  const nightInfo = (date: string) => {
    const rows = (nightsOfLive.get(date) ?? []).filter((shift) => laneOfRole(shift.role_id) === lane);
    const filledCount = rows.filter((shift) => shift.staff_id).length;
    return { total: rows.length, filled: filledCount, open: rows.length - filledCount, draft: rows.some((shift) => shift.status === "draft") };
  };
  const closedThisWeek = weekDates.filter((date) => date >= today && !nights.includes(date));
  const monthStart = `${focus.slice(0, 7)}-01`;
  const monthEnd = addDays(addMonths(focus, 1), -1);
  const gridStart = mondayOf(monthStart);
  const gridDays = Math.ceil((Math.round((parse(monthEnd).getTime() - parse(gridStart).getTime()) / 86400000) + 1) / 7) * 7;
  const monthDays = Array.from({ length: gridDays }, (_, index) => addDays(gridStart, index));
  const monthLoad = laneTeam
    .map((person) => ({ person, count: [...nightsOfLive.entries()].filter(([date]) => date >= monthStart && date <= monthEnd).reduce((sum, [, rows]) => sum + rows.filter((shift) => shift.staff_id === person.id).length, 0) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.person.full_name.localeCompare(b.person.full_name));
  const monthLoadMax = Math.max(1, ...monthLoad.map((row) => row.count));
  const dayGroups: { key: string; title: string; tone: string; people: PlannerStaff[] }[] = [
    { key: "yes", title: "Kan", tone: "a-yes", people: laneTeam.filter((person) => answerOf(person.id, focus) === "available") },
    { key: "maybe", title: "Liever niet", tone: "a-maybe", people: laneTeam.filter((person) => answerOf(person.id, focus) === "preferably_not") },
    { key: "unknown", title: "Nog geen antwoord", tone: "a-unknown", people: laneTeam.filter((person) => !answerOf(person.id, focus)) },
    { key: "no", title: "Kan niet", tone: "a-no", people: laneTeam.filter((person) => answerOf(person.id, focus) === "unavailable") },
  ];

  async function openNight(date: string, lines: Pattern["lines"] | null) {
    setBusy(true);
    try {
      const response = await fetch("/api/planning/nights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, action: "night_plan", values: { venueId: venue.id, serviceDate: date, ...(lines ? { lines: JSON.stringify(lines) } : {}) } }) });
      if (!response.ok) throw new Error();
      setSheet(null);
      setFocus(date);
      say({ text: `${capital(dayLong(date))} ${dateShort(date)} staat open. Vraag beschikbaarheid of kies zelf wie werkt.` });
      router.refresh();
    } catch { say({ text: "Die avond openen lukte niet.", tone: "bad" }); } finally { setBusy(false); }
  }
  const venuePatterns = patterns.filter((pattern) => pattern.venue_id === venue.id && pattern.active && pattern.lines.length).sort((a, b) => a.iso_weekday - b.iso_weekday);
  const peopleIn = (lines: Pattern["lines"]) => lines.filter((line) => laneOfRole(line.role_id) === "staff").reduce((sum, line) => sum + line.count, 0);
  const djsIn = (lines: Pattern["lines"]) => lines.filter((line) => laneOfRole(line.role_id) === "dj").reduce((sum, line) => sum + line.count, 0);
  function openNightChoices(date: string) {
    const own = venuePatterns.find((pattern) => pattern.iso_weekday === weekdayIndex(date));
    const others = venuePatterns.filter((pattern) => pattern !== own);
    const weekdayName = (iso: number) => parse(addDays("2026-10-19", iso - 1)).toLocaleDateString("nl-NL", { weekday: "long", timeZone: "UTC" });
    return (
      <div className="pl-open">
        <p>{capital(dayLong(date))} is nog dicht. Open hem met dezelfde plekken als een vaste avond:</p>
        <div className="pl-open-options">
          {own ? <button type="button" className="pl-btn pl-btn--go" disabled={busy} onClick={() => void openNight(date, null)}>Standaard {weekdayName(own.iso_weekday)}<small>{peopleIn(own.lines)} mensen{djsIn(own.lines) ? `, ${djsIn(own.lines)} DJ` : ""}</small></button> : null}
          {others.map((pattern) => (
            <button key={pattern.iso_weekday} type="button" className="pl-btn" disabled={busy} onClick={() => void openNight(date, pattern.lines)}>Zoals een {weekdayName(pattern.iso_weekday)}<small>{peopleIn(pattern.lines)} mensen{djsIn(pattern.lines) ? `, ${djsIn(pattern.lines)} DJ` : ""}</small></button>
          ))}
        </div>
        <button type="button" className="pl-link" onClick={() => setSheet({ kind: "nights" })}>Andere tijden of aantallen instellen</button>
      </div>
    );
  }

  function nightCard(night: string, extra = "") {
    const slots = slotsOf(night);
    const groups: { key: string; first: PlannerShift; rows: PlannerShift[] }[] = [];
    for (const slot of slots) {
      const key = `${slot.role_id}|${slot.starts_at}|${slot.ends_at}`;
      const group = groups.find((item) => item.key === key);
      if (group) group.rows.push(slot); else groups.push({ key, first: slot, rows: [slot] });
    }
    const counts = { can: 0, maybe: 0, no: 0, unknown: 0 };
    for (const person of laneTeam) {
      const value = answerOf(person.id, night);
      if (value === "available") counts.can += 1; else if (value === "preferably_not") counts.maybe += 1; else if (value === "unavailable") counts.no += 1; else counts.unknown += 1;
    }
    const past = night < today;
    const multipleRoles = new Set(slots.map((slot) => slot.role_id)).size > 1;
    const isDay = extra.includes("pl-night--day");
    return (
      <section key={night} className={`pl-night${night === shownNight ? " is-shown" : ""}${past ? " is-past" : ""}${extra}`} aria-label={`${dayLong(night)} ${dateShort(night)}`}>
        <header>
          {isDay ? <h2>{dayLong(night)}</h2> : <h2><button type="button" className="pl-night-open" onClick={() => { setFocus(night); setMode("day"); }}>{dayLong(night)}</button></h2>}
          <div className="pl-night-meta">
            <span>{dateShort(night)}</span>
            {slots.length ? <b className={slots.every((slot) => slot.staff_id) ? "full" : ""}>{slots.filter((slot) => slot.staff_id).length}/{slots.length}</b> : null}
          </div>
          {laneTeam.length && currentRequest ? (
            <p className="pl-night-answers" aria-label="Beschikbaarheid">
              <span className="a-yes">{counts.can} kan</span>
              {counts.maybe ? <span className="a-maybe">{counts.maybe} liever niet</span> : null}
              {counts.no ? <span className="a-no">{counts.no} kan niet</span> : null}
              {counts.unknown ? <span className="a-unknown">{counts.unknown} nog niet</span> : null}
            </p>
          ) : null}
        </header>
        {!slots.length ? (
          <p className="pl-night-empty">Nog geen plekken voor {lane === "dj" ? "DJ's" : "personeel"}.</p>
        ) : groups.map((group) => (
          <div className="pl-group" key={group.key}>
            <h3>{time(group.first.starts_at)} – {time(group.first.ends_at)}{multipleRoles ? <small>{roleById.get(group.first.role_id)?.name}</small> : null}</h3>
            <ul>
              {group.rows.map((slot) => {
                const person = slot.staff_id ? personById.get(slot.staff_id) : undefined;
                const value = slot.staff_id ? answerOf(slot.staff_id, night) : undefined;
                return (
                  <li key={slot.id}>
                    <button type="button" className={`pl-slot${person ? " is-filled" : ""}${slot.status === "draft" ? " is-draft" : ""}`} onClick={() => setSheet({ kind: "slot", shiftId: slot.id })} disabled={past}>
                      {person ? (
                        <>
                          <span className={`pl-avatar a-${value ?? "unknown"}`} aria-hidden>{initials(person.full_name)}</span>
                          <span className="pl-slot-name">{shortName(person.full_name)}</span>
                          {value === "preferably_not" ? <em className="a-maybe">liever niet</em> : value === "unavailable" ? <em className="a-no">kan niet</em> : null}
                        </>
                      ) : (
                        <span className="pl-slot-open">Open plek</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!past ? <button type="button" className="pl-add" disabled={busy} onClick={() => void addSlot(group.first)}>+ plek</button> : null}
          </div>
        ))}
      </section>
    );
  }

  return (
    <div className="pl">
      <header className="pl-head">
        <div className="pl-hello">
          <h1>Hoi {plannerName || "daar"}</h1>
          <p>{headline}</p>
        </div>
        <div className="pl-head-actions">
          <button type="button" className="pl-btn pl-btn--quiet" onClick={() => setSheet({ kind: "team" })}>Team <span className="pl-count">{team.length}</span></button>
          <button type="button" className="pl-btn pl-btn--quiet" onClick={() => setSheet({ kind: "nights" })}>Avonden</button>
        </div>
      </header>

      <div className="pl-bar">
        <div className="pl-week" role="group" aria-label="Periode kiezen">
          <button type="button" aria-label={mode === "day" ? "Vorige dag" : mode === "week" ? "Vorige week" : "Vorige maand"} onClick={() => move(-1)}>‹</button>
          {mode === "day" ? <div><b>{capital(dayLong(focus))}</b><small>{dateShort(focus)}, week {isoWeekNumber(focus)}</small></div>
            : mode === "week" ? <div><b>Week {weekNumber}</b><small>{dateShort(week)} – {dateShort(addDays(week, 6))}</small></div>
            : <div><b>{capital(monthLabel(focus).split(" ")[0])}</b><small>{monthLabel(focus).split(" ")[1]}</small></div>}
          <button type="button" aria-label={mode === "day" ? "Volgende dag" : mode === "week" ? "Volgende week" : "Volgende maand"} onClick={() => move(1)}>›</button>
          {!atHome ? <button type="button" className="pl-week-today" onClick={() => { setFocus(homeFocus); setMobileNight(null); }}>Nu</button> : null}
        </div>
        <div className="pl-modes" role="tablist" aria-label="Weergave">
          {(["day", "week", "month"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "on" : ""} onClick={() => { if (value === "day" && mode === "week") setFocus(shownNight ?? focus); setMode(value); }}>{value === "day" ? "Dag" : value === "week" ? "Week" : "Maand"}</button>)}
        </div>
        {hasDj ? (
          <div className="pl-lanes" role="tablist" aria-label="Planning">
            {(["staff", "dj"] as Lane[]).map((which) => {
              const rows = weekShifts.filter((shift) => laneOfRole(shift.role_id) === which);
              return <button key={which} type="button" role="tab" aria-selected={lane === which} className={lane === which ? "on" : ""} onClick={() => setLane(which)}>{which === "staff" ? "Personeel" : "DJ's"}{rows.length && mode === "week" ? <span>{rows.filter((shift) => shift.staff_id).length}/{rows.length}</span> : null}</button>;
            })}
          </div>
        ) : null}
        {mode === "week" ? (
          <div className="pl-views" role="tablist" aria-label="Indeling">
            <button type="button" role="tab" aria-selected={view === "nights"} className={view === "nights" ? "on" : ""} onClick={() => setView("nights")}>Per avond</button>
            <button type="button" role="tab" aria-selected={view === "people"} className={view === "people" ? "on" : ""} onClick={() => setView("people")}>Per persoon</button>
          </div>
        ) : null}
      </div>

      {mode !== "month" ? (
        <ol className={`pl-steps${nowIndex >= 0 ? " has-now" : ""}`}>
          {steps.map((step, index) => (
            <li key={step.title} className={`pl-step is-${step.state}`}>
              <span className="pl-step-n" aria-hidden>{step.state === "done" ? "✓" : index + 1}</span>
              <div><b>{step.title}</b><small>{step.text}</small></div>
              {step.action ? <span className="pl-step-action">{step.action}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {mode === "week" && missingNights.length ? (
        <div className="pl-prepare">
          <p>De standaardweek zet de vaste plekken voor {nightsLabel(missingNights)} klaar. Daarna kies je per plek wie er werkt.</p>
          <button type="button" className="pl-btn pl-btn--go" disabled={busy} onClick={() => void prepareWeek()}>Zet week {weekNumber} klaar</button>
        </div>
      ) : null}

      {mode === "month" ? (
        <div className="pl-month">
          <div className="pl-cal" role="grid" aria-label={monthLabel(focus)}>
            {["ma", "di", "wo", "do", "vr", "za", "zo"].map((day) => <span key={day} className="pl-cal-head" role="columnheader">{day}</span>)}
            {monthDays.map((date) => {
              const info = nightInfo(date);
              const inMonth = date.slice(0, 7) === focus.slice(0, 7);
              return (
                <button key={date} type="button" role="gridcell" className={`pl-cal-day${inMonth ? "" : " is-out"}${info.total ? " is-open" : ""}${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`} onClick={() => { setFocus(date); setMode("day"); }} aria-label={`${dayLong(date)} ${dateShort(date)}: ${info.total ? `${info.filled} van ${info.total} plekken gevuld` : "dicht"}`}>
                  <b>{parse(date).getUTCDate()}</b>
                  {info.total ? (
                    <>
                      <span className="pl-cal-fill"><i style={{ width: `${Math.round((info.filled / info.total) * 100)}%` }} /></span>
                      <small className={info.open ? "a-maybe" : "a-yes"}>{info.open ? `${info.open} open` : "rond"}</small>
                      {info.draft ? <em title="Niet gepubliceerd">concept</em> : null}
                    </>
                  ) : activeWeekdays.has(weekdayIndex(date)) && date >= today ? <small className="pl-cal-std">standaard</small> : null}
                </button>
              );
            })}
          </div>
          <div className="pl-load-list" aria-label="Inzet deze maand">
            <h3>Inzet in {monthLabel(focus).split(" ")[0]}<span>{lane === "dj" ? "DJ's" : "personeel"}</span></h3>
            {monthLoad.length ? (
              <ol>
                {monthLoad.map((row) => (
                  <li key={row.person.id}>
                    <span>{shortName(row.person.full_name)}</span>
                    <span className="pl-load-bar"><i style={{ width: `${Math.round((row.count / monthLoadMax) * 100)}%` }} /></span>
                    <b>{row.count}</b>
                  </li>
                ))}
              </ol>
            ) : <p className="pl-note">Nog niemand ingepland deze maand.</p>}
          </div>
        </div>
      ) : mode === "day" ? (
        <div className="pl-day">
          {dayHasPlan(focus) ? nightCard(focus, " is-shown pl-night--day") : (
            <section className="pl-night pl-night--day is-shown pl-closed">
              <header><h2>{dayLong(focus)}</h2><div className="pl-night-meta"><span>{dateShort(focus)}</span></div></header>
              {focus < today ? <p className="pl-night-empty">Deze avond is voorbij en was dicht.</p> : openNightChoices(focus)}
            </section>
          )}
          {dayHasPlan(focus) ? <div className="pl-day-people" aria-label="Wie kan">
            <h3>Wie kan {dayLong(focus)}?</h3>
            {dayGroups.map((group) => group.people.length ? (
              <section key={group.key}>
                <h4 className={group.tone}>{group.title}<span>{group.people.length}</span></h4>
                <ul>
                  {group.people.map((person) => {
                    const shift = shiftOn(person.id, focus);
                    return (
                      <li key={person.id}>
                        <button type="button" disabled={focus < today || !dayHasPlan(focus)} onClick={() => setSheet({ kind: "cell", staffId: person.id, night: focus })}>
                          <span className={`pl-avatar ${group.tone}`} aria-hidden>{initials(person.full_name)}</span>
                          <span className="pl-picker-name">{person.full_name}<small>{shift ? `Werkt ${time(shift.starts_at)} – ${time(shift.ends_at)}` : weekLoad(person.id) === 0 ? "Nog geen dienst deze week" : `${weekLoad(person.id)} ${weekLoad(person.id) === 1 ? "dienst" : "diensten"} deze week`}</small></span>
                          {shift ? <em className="pl-on">ingepland</em> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null)}
            {!laneTeam.length ? <p className="pl-note">Nog niemand in dit team.</p> : null}
          </div> : null}
        </div>
      ) : !nights.length ? (
        <div className="pl-empty">
          <h2>Geen avonden in week {weekNumber}</h2>
          <p>{activeWeekdays.size ? "Deze week valt buiten je standaardweek. Open een avond als er iets is." : "Stel eerst je standaardweek in: welke dagen je open bent en hoeveel mensen je per avond nodig hebt."}</p>
          <button type="button" className="pl-btn pl-btn--go" onClick={() => setSheet(activeWeekdays.size ? { kind: "open", date: weekDates.find((date) => date >= today) ?? week } : { kind: "nights" })}>{activeWeekdays.size ? "Avond openen" : "Standaardweek instellen"}</button>
        </div>
      ) : view === "nights" ? (
        <>
          <div className="pl-daytabs" role="tablist" aria-label="Avond">
            {nights.map((night) => {
              const slots = slotsOf(night);
              const gaps = slots.filter((shift) => !shift.staff_id).length;
              return <button key={night} type="button" role="tab" aria-selected={night === shownNight} className={night === shownNight ? "on" : ""} onClick={() => setMobileNight(night)}><b>{dayShort(night)}</b><span>{parse(night).getUTCDate()}</span>{slots.length ? <i className={gaps ? "gap" : "full"}>{gaps ? gaps : "✓"}</i> : null}</button>;
            })}
            {closedThisWeek.length ? <button type="button" className="pl-daytab-add" aria-label="Andere avond openen" onClick={() => setSheet({ kind: "open", date: closedThisWeek[0] })}><b>+</b><span>open</span></button> : null}
          </div>
          <div className="pl-nights" style={{ ["--pl-cols" as string]: String(nights.length) }}>
            {nights.map((night) => nightCard(night))}
          </div>
          {closedThisWeek.length ? <button type="button" className="pl-open-night" onClick={() => setSheet({ kind: "open", date: closedThisWeek[0] })}>+ Andere avond openen, bijvoorbeeld voor een event</button> : null}
        </>
      ) : (
        <div className="pl-people">
          <table>
            <thead>
              <tr><th scope="col">{lane === "dj" ? "DJ" : "Naam"}</th>{nights.map((night) => <th scope="col" key={night}><button type="button" className="pl-th-day" onClick={() => { setFocus(night); setMode("day"); }}><b>{dayShort(night)}</b><span>{parse(night).getUTCDate()}</span></button></th>)}<th scope="col">Diensten</th></tr>
            </thead>
            <tbody>
              {laneTeam.map((person) => (
                <tr key={person.id}>
                  <th scope="row"><span className="pl-who"><span className="pl-avatar a-unknown" aria-hidden>{initials(person.full_name)}</span>{shortName(person.full_name)}</span></th>
                  {nights.map((night) => {
                    const value = answerOf(person.id, night);
                    const shift = shiftOn(person.id, night);
                    const label = shift ? `${time(shift.starts_at)}` : value === "available" ? "kan" : value === "preferably_not" ? "liever niet" : value === "unavailable" ? "kan niet" : "–";
                    return (
                      <td key={night}>
                        <button type="button" disabled={night < today} className={`pl-cell a-${value ?? "unknown"}${shift ? " is-on" : ""}`} onClick={() => setSheet({ kind: "cell", staffId: person.id, night })} aria-label={`${person.full_name}, ${dayLong(night)}: ${shift ? `werkt ${time(shift.starts_at)}` : label}`}>
                          {label}
                        </button>
                      </td>
                    );
                  })}
                  <td className="pl-load">{weekLoad(person.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!laneTeam.length ? <p className="pl-night-empty">Nog niemand in dit team. Voeg mensen toe via Team.</p> : null}
        </div>
      )}

      <p className="pl-footnote"><Link href="/app/planning/uitgebreid">Uitgebreide planner</Link> voor verlof, ruilen en loonkosten.</p>

      {sheet ? (
        <SheetFrame onClose={() => setSheet(null)} title={sheetTitle(sheet)}>
          {sheet.kind === "slot" ? (() => {
            const slot = shifts.find((shift) => shift.id === sheet.shiftId);
            if (!slot) return <p>Deze plek bestaat niet meer.</p>;
            const night = nightOf(slot.starts_at, tz);
            const current = slot.staff_id ? personById.get(slot.staff_id) : undefined;
            const slotLane = laneOfRole(slot.role_id);
            const pool = team.filter((person) => inLane(person.id, slotLane) && person.id !== slot.staff_id);
            const elsewhere = (id: string) => { const other = shiftOn(id, night); return other && other.id !== slot.id ? other : undefined; };
            const groups: { key: string; title: string; people: PlannerStaff[]; tone: string }[] = [
              { key: "yes", title: "Kan", tone: "a-yes", people: pool.filter((person) => answerOf(person.id, night) === "available") },
              { key: "maybe", title: "Liever niet", tone: "a-maybe", people: pool.filter((person) => answerOf(person.id, night) === "preferably_not") },
              { key: "unknown", title: "Nog geen antwoord", tone: "a-unknown", people: pool.filter((person) => !answerOf(person.id, night)) },
              { key: "no", title: "Kan niet", tone: "a-no", people: pool.filter((person) => answerOf(person.id, night) === "unavailable") },
            ];
            return (
              <div className="pl-picker">
                <p className="pl-picker-sub">{capital(dayLong(night))} {dateShort(night)}, {time(slot.starts_at)} – {time(slot.ends_at)}{current ? <>. Nu: <b>{current.full_name}</b></> : null}</p>
                {groups.map((group) => group.people.length ? (
                  <section key={group.key}>
                    <h3 className={group.tone}>{group.title}<span>{group.people.length}</span></h3>
                    <ul>
                      {group.people.sort((a, b) => Number(Boolean(elsewhere(a.id))) - Number(Boolean(elsewhere(b.id))) || weekLoad(a.id) - weekLoad(b.id) || a.full_name.localeCompare(b.full_name)).map((person) => {
                        const other = elsewhere(person.id);
                        return (
                          <li key={person.id}>
                            <button type="button" disabled={Boolean(other)} onClick={() => { setSheet(null); void assign([{ shiftId: slot.id, staffId: person.id }], `${firstName(person.full_name)} werkt ${dayLong(night)}.`); }}>
                              <span className={`pl-avatar ${group.tone}`} aria-hidden>{initials(person.full_name)}</span>
                              <span className="pl-picker-name">{person.full_name}<small>{other ? `Werkt deze avond al, ${time(other.starts_at)}` : weekLoad(person.id) === 0 ? "Nog geen dienst deze week" : `${weekLoad(person.id)} ${weekLoad(person.id) === 1 ? "dienst" : "diensten"} deze week`}</small></span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null)}
                {!pool.length ? <p>Nog niemand in dit team. <button type="button" className="pl-link" onClick={() => setSheet({ kind: "person" })}>Voeg iemand toe</button></p> : null}
                <div className="pl-sheet-actions">
                  {current ? <button type="button" className="pl-btn" onClick={() => { setSheet(null); void assign([{ shiftId: slot.id, staffId: null }], `${firstName(current.full_name)} staat niet meer op ${dayLong(night)}.`); }}>Maak plek leeg</button> : <button type="button" className="pl-btn pl-btn--quiet" disabled={busy} onClick={() => void removeSlot(slot.id)}>Verwijder deze plek</button>}
                </div>
              </div>
            );
          })() : sheet.kind === "cell" ? (() => {
            const person = personById.get(sheet.staffId);
            if (!person) return null;
            const night = sheet.night;
            const shift = shiftOn(person.id, night);
            const value = answerOf(person.id, night);
            const openGroups = new Map<string, PlannerShift>();
            for (const slot of slotsOf(night)) if (!slot.staff_id && !openGroups.has(`${slot.starts_at}|${slot.ends_at}|${slot.role_id}`)) openGroups.set(`${slot.starts_at}|${slot.ends_at}|${slot.role_id}`, slot);
            return (
              <div className="pl-picker">
                <p className="pl-picker-sub">{person.full_name}: {value === "available" ? "kan" : value === "preferably_not" ? "liever niet" : value === "unavailable" ? "kan niet" : "nog geen antwoord"}.</p>
                {shift ? (
                  <div className="pl-sheet-actions">
                    <p>Werkt {time(shift.starts_at)} – {time(shift.ends_at)}.</p>
                    <button type="button" className="pl-btn" onClick={() => { setSheet(null); void assign([{ shiftId: shift.id, staffId: null }], `${firstName(person.full_name)} staat niet meer op ${dayLong(night)}.`); }}>Haal van deze avond af</button>
                  </div>
                ) : openGroups.size ? (
                  <ul className="pl-times">
                    {[...openGroups.values()].map((slot) => (
                      <li key={slot.id}><button type="button" onClick={() => { setSheet(null); void assign([{ shiftId: slot.id, staffId: person.id }], `${firstName(person.full_name)} werkt ${dayLong(night)}.`); }}><b>{time(slot.starts_at)} – {time(slot.ends_at)}</b><small>{slotsOf(night).filter((row) => !row.staff_id && row.starts_at === slot.starts_at && row.ends_at === slot.ends_at).length} open</small></button></li>
                    ))}
                  </ul>
                ) : <p>Er is geen open plek meer op {dayLong(night)}. Voeg er een toe via Per avond.</p>}
              </div>
            );
          })() : sheet.kind === "request" ? (
            <RequestSheet now={now} organisationId={organisationId} venue={venue} today={today} week={week} activeWeekdays={activeWeekdays} plannedNights={new Set(live.map((shift) => nightOf(shift.starts_at, tz)))} team={team} inLane={inLane} hasDj={hasDj} whatsappReady={whatsappReady} onDone={(text) => { say({ text }); router.refresh(); }} />
          ) : sheet.kind === "responses" && currentRequest ? (
            <ResponsesSheet request={currentRequest} recipients={requestRecipients} people={personById} answerOf={answerOf} tz={tz} onNew={() => setSheet({ kind: "request" })} />
          ) : sheet.kind === "publish" ? (
            <PublishSheet organisationId={organisationId} venue={venue} week={week} weekNumber={weekNumber} weekShifts={weekShifts} people={personById} open={weekShifts.filter((shift) => !shift.staff_id).length} drafts={drafts.length} whatsappReady={whatsappReady} time={time} onPublished={() => router.refresh()} />
          ) : sheet.kind === "team" ? (
            <TeamSheet organisationId={organisationId} venueId={venue.id} team={team} inLane={inLane} hasDj={hasDj} plannerUserIds={plannerUserIds} canManageMembers={canManageMembers} whatsappReady={whatsappReady} onAdd={() => setSheet({ kind: "person" })} onChanged={(text) => { say({ text }); router.refresh(); }} />
          ) : sheet.kind === "person" ? (
            canManageMembers ? (
              <AddPersonPanel
                organisationId={organisationId}
                venueId={venue.id}
                roles={venueRoles.map((role) => ({ id: role.id, name: role.name, department_id: role.department_id, lane: laneOfRole(role.id) }))}
                defaultLane={lane}
                whatsappReady={whatsappReady}
                locale="nl"
                onDone={(text) => { say({ text }); router.refresh(); }}
                onClose={() => setSheet({ kind: "team" })}
              />
            ) : <p>Alleen de eigenaar of een beheerder kan mensen toevoegen.</p>
          ) : sheet.kind === "open" ? (
            <div className="pl-open-sheet">
              <h3>Welke dag?</h3>
              <div className="pl-daypick"><div>
                {Array.from({ length: 7 }, (_, index) => addDays(mondayOf(sheet.date), index)).map((date) => (
                  <button key={date} type="button" disabled={date < today || dayHasPlan(date)} aria-pressed={date === sheet.date} className={date === sheet.date ? "on" : ""} onClick={() => setSheet({ kind: "open", date })}><b>{dayShort(date)}</b><span>{parse(date).getUTCDate()}</span></button>
                ))}
              </div></div>
              <label className="pl-date-input">Of kies een datum<input type="date" min={today} value={sheet.date} onChange={(event) => event.target.value && setSheet({ kind: "open", date: event.target.value })} /></label>
              {dayHasPlan(sheet.date) ? <p className="pl-note">{capital(dayLong(sheet.date))} {dateShort(sheet.date)} staat al open.</p> : openNightChoices(sheet.date)}
            </div>
          ) : sheet.kind === "nights" ? (
            <ServiceNightsPanel
              organisationId={organisationId}
              venueId={venue.id}
              weekStart={new Date(`${week}T00:00:00`)}
              roles={venueRoles.map((role) => ({ id: role.id, name: role.name, department_id: role.department_id, hourly_cost_minor: role.hourly_cost_minor, lane: laneOfRole(role.id) }))}
              patterns={patterns.filter((pattern) => pattern.venue_id === venue.id)}
              dayCounts={weekDates.map((date) => ({ date: new Date(`${date}T00:00:00`), staff: weekShifts.filter((shift) => nightOf(shift.starts_at, tz) === date && laneOfRole(shift.role_id) === "staff").length, dj: weekShifts.filter((shift) => nightOf(shift.starts_at, tz) === date && laneOfRole(shift.role_id) === "dj").length }))}
              hasDjLane={hasDj}
              locale="nl"
              onSaved={(text) => { say({ text }); setSheet(null); router.refresh(); }}
            />
          ) : null}
        </SheetFrame>
      ) : null}

      {toast ? (
        <div className={`pl-toast${toast.tone === "bad" ? " is-bad" : ""}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo ? <button type="button" onClick={() => { const undo = toast.undo; setToast(null); undo?.(); }}>Ongedaan maken</button> : null}
        </div>
      ) : null}
    </div>
  );

  function sheetTitle(value: Sheet) {
    if (value.kind === "slot") return "Wie werkt hier?";
    if (value.kind === "cell") return `${capital(dayLong(value.night))} ${dateShort(value.night)}`;
    if (value.kind === "request") return "Beschikbaarheid vragen";
    if (value.kind === "responses") return "Antwoorden";
    if (value.kind === "publish") return `Week ${weekNumber} publiceren`;
    if (value.kind === "team") return "Team";
    if (value.kind === "person") return "Persoon toevoegen";
    if (value.kind === "open") return "Avond openen";
    return "Avonden";
  }
}

// ---------- sheet frame: right drawer on desktop, bottom sheet on phones ----------
function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("pl-locked");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("pl-locked"); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="pl-sheet-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pl-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header><span className="pl-grip" aria-hidden /><h2>{title}</h2><button type="button" className="pl-close" aria-label="Sluiten" onClick={onClose}>×</button></header>
        <div className="pl-sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- ask availability for specific nights ----------
function RequestSheet({ now, organisationId, venue, today, week, activeWeekdays, plannedNights, team, inLane, hasDj, whatsappReady, onDone }: {
  now: number; organisationId: string; venue: Venue; today: string; week: string; activeWeekdays: Set<number>; plannedNights: Set<string>;
  team: PlannerStaff[]; inLane: (id: string, lane: Lane) => boolean; hasDj: boolean; whatsappReady: boolean; onDone: (text: string) => void;
}) {
  const tz = venue.timezone || "Europe/Amsterdam";
  const weeks = [week, addDays(week, 7)];
  const isOpen = (date: string) => plannedNights.has(date) || activeWeekdays.has(weekdayIndex(date));
  const [dates, setDates] = useState<string[]>(() => weeks.flatMap((start) => Array.from({ length: 7 }, (_, index) => addDays(start, index))).filter((date) => date >= today && date < addDays(week, 7) && isOpen(date)));
  const [who, setWho] = useState<"all" | Lane>("all");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const sorted = [...dates].sort();
  const deadlineOptions = (() => {
    const options: { label: string; iso: string }[] = [];
    const nowMs = now;
    const lastAllowed = sorted.length ? new Date(zonedInstant(sorted[0], "18:00", tz)).getTime() : 0;
    const candidates = [1, 2, 3].map((offset) => addDays(today, offset)).concat(sorted.length ? [addDays(sorted[0], -1)] : []);
    for (const date of [...new Set(candidates)].sort()) {
      const iso = zonedInstant(date, "20:00", tz);
      const at = new Date(iso).getTime();
      if (at > nowMs + 2 * 3600000 && (!lastAllowed || at <= lastAllowed)) options.push({ label: deadlineLabel(iso, tz), iso });
    }
    if (!options.length && sorted.length) { const iso = new Date(Math.min(nowMs + 6 * 3600000, lastAllowed)).toISOString(); if (new Date(iso).getTime() > nowMs) options.push({ label: deadlineLabel(iso, tz), iso }); }
    return options;
  })();
  const [deadline, setDeadline] = useState<string>("");
  const chosenDeadline = deadlineOptions.find((option) => option.iso === deadline)?.iso ?? deadlineOptions.at(-1)?.iso ?? "";
  const pool = team.filter((person) => who === "all" || inLane(person.id, who));
  const recipients = pool.filter((person) => !excluded.includes(person.id));
  const noPhone = recipients.filter((person) => !person.contact_phone).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ sent: string[]; manual: { id: string; name: string; url: string | null }[] } | null>(null);
  const example = recipients[0] ? firstName(recipients[0].full_name) : "Sam";

  async function send() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, venueId: venue.id, dates: sorted, deadlineAt: chosenDeadline, staffIds: recipients.map((person) => person.id), idempotencyKey: crypto.randomUUID(), deliver: whatsappReady ? "whatsapp" : "manual" }) });
      const body = (await response.json().catch(() => ({}))) as { shares?: Record<string, { whatsappUrl: string | null }>; deliveries?: Record<string, { state: string }> };
      if (!response.ok) throw new Error();
      const sent = Object.entries(body.deliveries ?? {}).filter(([, row]) => row.state === "sent").map(([id]) => id);
      const manual = recipients.filter((person) => !sent.includes(person.id)).map((person) => ({ id: person.id, name: person.full_name, url: body.shares?.[person.id]?.whatsappUrl ?? null }));
      setResult({ sent, manual });
      onDone(sent.length ? `Verstuurd naar ${sent.length} ${sent.length === 1 ? "persoon" : "mensen"}.` : "Persoonlijke links staan klaar.");
    } catch { setError("Versturen lukte niet. Controleer de avonden en de deadline."); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <div className="pl-request">
        {result.sent.length ? <p className="pl-ok">{result.sent.length} {result.sent.length === 1 ? "persoon kreeg" : "mensen kregen"} het verzoek via WhatsApp van het Cliniq-nummer.</p> : null}
        {result.manual.length ? (
          <>
            <p>{whatsappReady ? "Deze mensen konden we niet bereiken. Stuur ze zelf hun persoonlijke link:" : "Stuur iedereen zijn persoonlijke link. Eén tik opent WhatsApp met het bericht klaar:"}</p>
            <ul className="pl-sendlist">{result.manual.map((row) => <li key={row.id}><span>{row.name}</span>{row.url ? <a className="pl-btn" href={row.url} target="_blank" rel="noreferrer">WhatsApp</a> : <small>geen nummer</small>}</li>)}</ul>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pl-request">
      <h3>Welke avonden?</h3>
      {weeks.map((start) => (
        <div className="pl-daypick" key={start}>
          <small>Week {isoWeekNumber(start)}</small>
          <div>
            {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date) => (
              <button key={date} type="button" disabled={date < today} aria-pressed={dates.includes(date)} className={`${dates.includes(date) ? "on" : ""}${isOpen(date) ? " is-open" : ""}`} onClick={() => setDates((current) => (current.includes(date) ? current.filter((value) => value !== date) : [...current, date]))}>
                <b>{dayShort(date)}</b><span>{parse(date).getUTCDate()}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <h3>Aan wie?</h3>
      {hasDj ? (
        <div className="pl-seg">
          {(["all", "staff", "dj"] as const).map((value) => <button key={value} type="button" aria-pressed={who === value} className={who === value ? "on" : ""} onClick={() => setWho(value)}>{value === "all" ? "Iedereen" : value === "staff" ? "Personeel" : "DJ's"}</button>)}
        </div>
      ) : null}
      <button type="button" className="pl-link" onClick={() => setShowPeople(!showPeople)}>{recipients.length} {recipients.length === 1 ? "persoon" : "mensen"}{excluded.length ? `, ${excluded.length} uitgezet` : ""} {showPeople ? "verbergen" : "aanpassen"}</button>
      {showPeople ? (
        <ul className="pl-checklist">
          {pool.map((person) => (
            <li key={person.id}><label><input type="checkbox" checked={!excluded.includes(person.id)} onChange={() => setExcluded((current) => (current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id]))} /><span>{person.full_name}{!person.contact_phone ? <small>geen nummer</small> : null}</span></label></li>
          ))}
        </ul>
      ) : null}
      {noPhone ? <p className="pl-warn">{noPhone} {noPhone === 1 ? "persoon heeft" : "mensen hebben"} geen telefoonnummer. Die {noPhone === 1 ? "kan" : "kunnen"} antwoorden in de app.</p> : null}
      <h3>Antwoord vóór</h3>
      <div className="pl-seg pl-seg--wrap">
        {deadlineOptions.map((option) => <button key={option.iso} type="button" aria-pressed={option.iso === chosenDeadline} className={option.iso === chosenDeadline ? "on" : ""} onClick={() => setDeadline(option.iso)}>{option.label}</button>)}
      </div>
      {sorted.length ? (
        <blockquote className="pl-preview">Hoi {example}! Kun je {nightsLabel(sorted)}? Laat het weten vóór {chosenDeadline ? deadlineLabel(chosenDeadline, tz) : "…"}, kost je tien seconden.</blockquote>
      ) : null}
      {error ? <p className="pl-warn" role="alert">{error}</p> : null}
      <button type="button" className="pl-btn pl-btn--go pl-btn--wide" disabled={busy || !sorted.length || !recipients.length || !chosenDeadline} onClick={() => void send()}>
        {busy ? "Bezig…" : whatsappReady ? `Verstuur naar ${recipients.length} ${recipients.length === 1 ? "persoon" : "mensen"}` : `Maak ${recipients.length} persoonlijke ${recipients.length === 1 ? "link" : "links"}`}
      </button>
      {!whatsappReady ? <p className="pl-note">WhatsApp is nog niet gekoppeld. Je krijgt per persoon een knop die WhatsApp opent met het bericht klaar.</p> : null}
    </div>
  );
}

// ---------- who answered what ----------
function ResponsesSheet({ request, recipients, people, answerOf, tz, onNew }: {
  request: RequestRow; recipients: RecipientRow[]; people: Map<string, PlannerStaff>; answerOf: (staffId: string, night: string) => Answer | undefined; tz: string; onNew: () => void;
}) {
  const nights = request.requested_dates ?? [];
  const rows = recipients.map((row) => ({ row, person: people.get(row.staff_id) })).filter((item) => item.person).sort((a, b) => Number(ANSWERED.includes(b.row.status)) - Number(ANSWERED.includes(a.row.status)) || a.person!.full_name.localeCompare(b.person!.full_name));
  const missing = rows.filter((item) => !ANSWERED.includes(item.row.status));
  return (
    <div className="pl-responses">
      <p className="pl-picker-sub">{nightsLabel(nights)}. Deadline {deadlineLabel(request.deadline_at, tz)}.</p>
      <table>
        <thead><tr><th scope="col">Naam</th>{nights.map((night) => <th scope="col" key={night}>{dayShort(night)} {parse(night).getUTCDate()}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ row, person }) => (
            <tr key={row.id}>
              <th scope="row">{shortName(person!.full_name)}</th>
              {nights.map((night) => { const value = answerOf(row.staff_id, night); return <td key={night}><span className={`pl-chip a-${value ?? "unknown"}`}>{value === "available" ? "kan" : value === "preferably_not" ? "liever niet" : value === "unavailable" ? "kan niet" : "–"}</span></td>; })}
            </tr>
          ))}
        </tbody>
      </table>
      {missing.length ? (
        <>
          <h3>Nog geen antwoord</h3>
          <ul className="pl-sendlist">
            {missing.map(({ row, person }) => {
              const text = `Hoi ${firstName(person!.full_name)}! Wil je nog even laten weten of je ${nightsLabel(nights)} kunt? De link staat in je WhatsApp, of kijk in de app onder Mijn rooster.`;
              const number = waNumber(person!.contact_phone);
              return <li key={row.id}><span>{person!.full_name}</span>{number ? <a className="pl-btn" href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Herinner</a> : <small>geen nummer</small>}</li>;
            })}
          </ul>
        </>
      ) : <p className="pl-ok">Iedereen heeft geantwoord.</p>}
      <div className="pl-sheet-actions"><button type="button" className="pl-btn pl-btn--quiet" onClick={onNew}>Nieuwe vraag sturen</button></div>
    </div>
  );
}

// ---------- publish and send ----------
function PublishSheet({ organisationId, venue, week, weekNumber, weekShifts, people, open, drafts, whatsappReady, time, onPublished }: {
  organisationId: string; venue: Venue; week: string; weekNumber: number; weekShifts: PlannerShift[]; people: Map<string, PlannerStaff>; open: number; drafts: number; whatsappReady: boolean; time: (iso: string) => string; onPublished: () => void;
}) {
  const tz = venue.timezone || "Europe/Amsterdam";
  const [state, setState] = useState<"ready" | "busy" | "done">("ready");
  const [error, setError] = useState("");
  const [deliveries, setDeliveries] = useState<Record<string, { state: string; detail: string }>>({});
  const workers = [...new Set(weekShifts.filter((shift) => shift.staff_id).map((shift) => shift.staff_id!))].map((id) => people.get(id)).filter(Boolean) as PlannerStaff[];
  const messageFor = (person: PlannerStaff) => {
    const own = weekShifts.filter((shift) => shift.staff_id === person.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const lines = own.map((shift) => { const night = nightOf(shift.starts_at, tz); return `${dayShort(night)} ${dateShort(night)} ${time(shift.starts_at)}–${time(shift.ends_at)}`; });
    return `Hoi ${firstName(person.full_name)}! Je rooster bij ${venue.name} voor week ${weekNumber}: ${lines.join(", ")}. Klopt er iets niet? Laat het je planner weten.`;
  };

  async function publish(send: boolean) {
    setState("busy"); setError("");
    try {
      if (drafts) {
        const response = await fetch("/api/planner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", organisationId, venueId: venue.id, weekStart: week }) });
        const body = (await response.json().catch(() => ({}))) as { errorCode?: string };
        if (!response.ok) throw new Error(body.errorCode === "OVERLAPPING_SHIFTS" ? "Iemand staat dubbel ingepland. Pas dat eerst aan." : body.errorCode === "ABSENCE_CONFLICT" ? "Iemand staat ingepland tijdens verlof." : "Publiceren lukte niet.");
      }
      if (send && whatsappReady) {
        const response = await fetch("/api/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "roster", organisationId, venueId: venue.id, weekStart: zonedInstant(week, "12:00", tz), resend: !drafts }) });
        const body = (await response.json().catch(() => ({}))) as { deliveries?: { staffId: string; state: string; detail: string }[] };
        setDeliveries(Object.fromEntries((body.deliveries ?? []).map((row) => [row.staffId, { state: row.state, detail: row.detail }])));
      }
      setState("done");
      onPublished();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Publiceren lukte niet."); setState("ready"); }
  }

  if (state === "done") {
    return (
      <div className="pl-publish">
        <p className="pl-ok">{drafts ? `Week ${weekNumber} is gepubliceerd.` : "Klaar."} {workers.length} {workers.length === 1 ? "persoon ziet" : "mensen zien"} hun diensten nu in de app.</p>
        <ul className="pl-sendlist">
          {workers.map((person) => {
            const delivery = deliveries[person.id];
            const number = waNumber(person.contact_phone);
            return (
              <li key={person.id}>
                <span>{person.full_name}</span>
                {delivery?.state === "sent" ? <em className="a-yes">Verstuurd</em> : delivery?.state === "skipped" ? <em>Had dit rooster al</em> : number ? <a className="pl-btn" href={`https://wa.me/${number}?text=${encodeURIComponent(messageFor(person))}`} target="_blank" rel="noreferrer">{delivery ? "Zelf sturen" : "WhatsApp"}</a> : <small>geen nummer</small>}
                {delivery?.state === "failed" ? <small className="a-no">{delivery.detail}</small> : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="pl-publish">
      <dl className="pl-facts">
        <div><dt>Diensten</dt><dd>{weekShifts.filter((shift) => shift.staff_id).length}</dd></div>
        <div><dt>Mensen</dt><dd>{workers.length}</dd></div>
        <div><dt>Open plekken</dt><dd className={open ? "a-maybe" : ""}>{open}</dd></div>
      </dl>
      {open ? <p className="pl-warn">Er {open === 1 ? "is nog 1 plek" : `zijn nog ${open} plekken`} open. Je kunt ze ook na het publiceren nog vullen; dan publiceer je opnieuw.</p> : null}
      {workers.length ? <blockquote className="pl-preview">{messageFor(workers[0])}</blockquote> : null}
      {error ? <p className="pl-warn" role="alert">{error}</p> : null}
      <button type="button" className="pl-btn pl-btn--go pl-btn--wide" disabled={state === "busy"} onClick={() => void publish(true)}>{state === "busy" ? "Bezig…" : drafts ? (whatsappReady ? "Publiceer en stuur via WhatsApp" : "Publiceer") : "Stuur iedereen zijn rooster"}</button>
      {drafts && whatsappReady ? <button type="button" className="pl-btn pl-btn--quiet pl-btn--wide" disabled={state === "busy"} onClick={() => void publish(false)}>Alleen publiceren</button> : null}
      {!whatsappReady ? <p className="pl-note">Na het publiceren krijg je per persoon een knop die WhatsApp opent met zijn eigen diensten.</p> : null}
    </div>
  );
}

// ---------- team ----------
function TeamSheet({ organisationId, venueId, team, inLane, hasDj, plannerUserIds, canManageMembers, whatsappReady, onAdd, onChanged }: {
  organisationId: string; venueId: string; team: PlannerStaff[]; inLane: (id: string, lane: Lane) => boolean; hasDj: boolean; plannerUserIds: string[]; canManageMembers: boolean; whatsappReady: boolean; onAdd: () => void; onChanged: (text: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [invite, setInvite] = useState<Record<string, { state: string; url: string; link: string }>>({});
  const lanes: Lane[] = hasDj ? ["staff", "dj"] : ["staff"];

  async function sendInvite(person: PlannerStaff) {
    setBusy(person.id);
    try {
      const response = await fetch("/api/planner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "invite", organisationId, venueId, staffId: person.id }) });
      const body = (await response.json().catch(() => ({}))) as { link?: string; whatsappUrl?: string; delivery?: { state: string }; errorCode?: string };
      if (!response.ok) throw new Error(body.errorCode);
      setInvite((current) => ({ ...current, [person.id]: { state: body.delivery?.state ?? "manual", url: body.whatsappUrl ?? "", link: body.link ?? "" } }));
      if (body.delivery?.state === "sent") onChanged(`Uitnodiging naar ${firstName(person.full_name)} verstuurd.`);
    } catch { onChanged("Uitnodigen lukte niet."); } finally { setBusy(""); }
  }
  async function setPlanner(person: PlannerStaff, enabled: boolean) {
    setBusy(person.id);
    try {
      const response = await fetch("/api/planning/nights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, action: "planner_access", values: { staffId: person.id, enabled: String(enabled) } }) });
      if (!response.ok) throw new Error();
      onChanged(enabled ? `${firstName(person.full_name)} kan nu plannen.` : `${firstName(person.full_name)} plant niet meer.`);
    } catch { onChanged("Dat lukte niet."); } finally { setBusy(""); }
  }

  return (
    <div className="pl-team">
      {canManageMembers ? <button type="button" className="pl-btn pl-btn--go pl-btn--wide" onClick={onAdd}>+ Persoon toevoegen</button> : <p className="pl-note">Alleen de eigenaar of een beheerder kan mensen toevoegen.</p>}
      {lanes.map((which) => {
        const people = team.filter((person) => inLane(person.id, which)).sort((a, b) => a.full_name.localeCompare(b.full_name));
        return (
          <section key={which}>
            <h3>{which === "staff" ? "Personeel" : "DJ's"}<span>{people.length}</span></h3>
            {!people.length ? <p className="pl-note">Nog niemand.</p> : null}
            <ul className="pl-teamlist">
              {people.map((person) => {
                const sent = invite[person.id];
                const isPlanner = Boolean(person.auth_user_id && plannerUserIds.includes(person.auth_user_id));
                return (
                  <li key={person.id}>
                    <span className="pl-avatar a-unknown" aria-hidden>{initials(person.full_name)}</span>
                    <div className="pl-team-who">
                      <b>{person.full_name}{isPlanner ? <em>planner</em> : null}</b>
                      <small>{person.auth_user_id ? "Heeft een account" : person.invitation_state === "pending" || person.invitation_state === "invited" ? "Uitgenodigd, nog geen account" : "Nog niet uitgenodigd"}{person.contact_phone ? "" : ", geen telefoonnummer"}</small>
                    </div>
                    <div className="pl-team-actions">
                      {!person.auth_user_id && canManageMembers ? (
                        sent?.state === "sent" ? <em className="a-yes">Verstuurd</em>
                        : sent ? (sent.url ? <a className="pl-btn" href={sent.url} target="_blank" rel="noreferrer">Open WhatsApp</a> : <button type="button" className="pl-btn" onClick={() => { void navigator.clipboard.writeText(sent.link); onChanged("Link gekopieerd."); }}>Kopieer link</button>)
                        : <button type="button" className="pl-btn" disabled={busy === person.id} onClick={() => void sendInvite(person)}>{person.invitation_state === "pending" ? "Opnieuw uitnodigen" : "Uitnodigen"}</button>
                      ) : null}
                      {person.auth_user_id && canManageMembers ? <button type="button" className={`pl-btn${isPlanner ? " is-on" : " pl-btn--quiet"}`} aria-pressed={isPlanner} disabled={busy === person.id} onClick={() => void setPlanner(person, !isPlanner)}>{isPlanner ? "Planner" : "Maak planner"}</button> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!whatsappReady && canManageMembers ? <p className="pl-note">Zonder WhatsApp-koppeling opent uitnodigen WhatsApp met het bericht klaar; jij drukt op versturen.</p> : null}
    </div>
  );
}

