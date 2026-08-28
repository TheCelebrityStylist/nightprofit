"use client";

import { useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";
import { AvailabilityManager } from "./availability-manager";
import { EmployeeCsvImport } from "./employee-csv-import";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/workforce/timezone";
import { calculateCoverage, rankReplacements, rosterHealth, simulateDemand } from "@/lib/workforce/decision-support";

type Venue = { id: string; name: string; timezone: string };
type Department = { id: string; venue_id: string; name: string };
type Role = {
  id: string;
  department_id: string;
  name: string;
  hourly_cost_minor: string;
  minimum_staff: number;
  guests_per_staff: number;
};
type Staff = {
  id: string;
  full_name: string;
  role_name: string;
  onboarding_status?: string;
  contact_email?: string | null;
  effective_hourly_cost_minor?: string | null;
  contracted_minutes_week?: number | null;
  maximum_minutes_week?: number | null;
  preferences?: Record<string,unknown>;
};
type StaffAvailability={staff_id:string;venue_id:string;starts_at:string;ends_at:string;availability:"available"|"preferred"|"preferably_not"|"unavailable";submitted_at:string|null;source:string};
type Qualification={staff_id:string;role_id:string;qualified_until:string|null};
type TimeRecord={id:string;venue_id:string;staff_id:string;shift_id:string|null;clocked_in_at:string;clocked_out_at:string|null;break_minutes:number;status:string;approved_at:string|null};
type Interval = {
  id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  expected_guests: number;
  expected_revenue_minor: string;
  required_staff: number;
};
type Shift = {
  id: string;
  venue_id: string;
  department_id: string;
  role_id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  hourly_cost_minor: string;
  status: string;
  revision?: number;
  locked?: boolean;
};
type Absence = {
  id: string;
  venue_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  absence_type: string;
  status: string;
  note: string | null;
};
type Proposal = {
  id: string;
  venue_id: string;
  objective: string;
  status: string;
  result_summary: {
    coverage_basis_points: number;
    unfilled_assignments: number;
    total_planned_minutes: number;
    planned_cost_minor: string;
    preferred_assignments: number;
    missing_evidence: string[];
  };
  created_at: string;
};

const dayMs = 86400000;
const isoLocal = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const monday = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
};

export function RosterBoard({
  organisationId,
  venues,
  departments,
  roles,
  staff,
  intervals,
  initialShifts,
  absences,
  staffAvailability,
  qualifications,
  timeRecords,
  proposals,
}: {
  organisationId: string;
  venues: Venue[];
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  intervals: Interval[];
  initialShifts: Shift[];
  absences: Absence[];
  staffAvailability: StaffAvailability[];
  qualifications: Qualification[];
  timeRecords: TimeRecord[];
  proposals: Proposal[];
}) {
  const { locale } = useAuthLocale(),
    router = useRouter();
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [shifts, setShifts] = useState(initialShifts);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [panel, setPanel] = useState<"shift" | "new" | "team" | "absence" | "availability" | null>(
    null,
  );
  const [newShift, setNewShift] = useState<{
    day: Date;
    departmentId: string;
    staffId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [scenarioBasisPoints, setScenarioBasisPoints] = useState(0);
  const venueTimezone = venues.find((row) => row.id === venueId)?.timezone ?? "Europe/Amsterdam";
  const toUtc = (value: string) => zonedInputToUtc(value, venueTimezone);
  const toLocal = (value: string) => utcToZonedInput(value, venueTimezone);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * dayMs)),
    [weekStart],
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * dayMs);
  const visibleShifts = shifts.filter(
    (row) =>
      row.venue_id === venueId &&
      new Date(row.starts_at) >= weekStart &&
      new Date(row.starts_at) < weekEnd &&
      row.status !== "cancelled",
  );
  const visibleIntervals = intervals.filter(
    (row) =>
      row.venue_id === venueId &&
      new Date(row.starts_at) >= weekStart &&
      new Date(row.starts_at) < weekEnd,
  );
  const venueDepartments = departments.filter((row) => row.venue_id === venueId);
  const activeStaff = staff.filter((row) => row.onboarding_status !== "suspended");
  const revenue = visibleIntervals.reduce(
    (sum, row) => sum + BigInt(row.expected_revenue_minor),
    0n,
  );
  const labor = visibleShifts.reduce((sum, row) => {
    const minutes = Math.max(
      0,
      Math.floor((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000) -
        row.break_minutes,
    );
    return sum + (BigInt(row.hourly_cost_minor) * BigInt(minutes) + 30n) / 60n;
  }, 0n);
  const currency = (minor: bigint) =>
    new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(Number(minor) / 100);
  const percent = revenue ? `${Number((labor * 10000n) / revenue) / 100}%` : "—";
  const coverageIntervals = calculateCoverage(
    visibleIntervals.map((row) => ({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",requiredStaff:row.required_staff,expectedRevenueMinor:BigInt(row.expected_revenue_minor)})),
    visibleShifts.map((row) => ({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",staffId:row.staff_id,hourlyCostMinor:BigInt(row.hourly_cost_minor),breakMinutes:row.break_minutes})),
  );
  const scenario = scenarioBasisPoints ? simulateDemand(coverageIntervals, scenarioBasisPoints) : null;
  const health = rosterHealth({
    coverage: coverageIntervals,
    hardConstraintViolations: 0,
    availabilityConflicts: visibleShifts.filter((shift) => absences.some((absence) => absence.staff_id === shift.staff_id && absence.status !== "rejected" && new Date(absence.starts_at) < new Date(shift.ends_at) && new Date(absence.ends_at) > new Date(shift.starts_at))).length,
    skillConflicts: 0,
    laborBasisPoints: revenue ? Number((labor * 10_000n) / revenue) : null,
    targetLaborBasisPoints: 2_000,
    hourImbalances: 0,
    preferenceMisses: proposals.find((row) => row.objective === "preference")?.result_summary.unfilled_assignments ?? 0,
    breakConflicts: 0,
    missingEvidence: visibleIntervals.length ? [] : ["demand"],
  });
  const sicknessCases = absences.filter((absence)=>absence.venue_id===venueId&&absence.absence_type==="sickness"&&absence.status==="recorded").flatMap((absence)=>
    visibleShifts.filter((shift)=>shift.staff_id===absence.staff_id&&new Date(shift.starts_at)<new Date(absence.ends_at)&&new Date(shift.ends_at)>new Date(absence.starts_at)).map((shift)=>{
      const shiftMinutes=Math.floor((new Date(shift.ends_at).getTime()-new Date(shift.starts_at).getTime())/60000)-shift.break_minutes;
      const replacements=rankReplacements(activeStaff.filter(person=>person.id!==absence.staff_id).map(person=>{
        const availability=staffAvailability.find(row=>row.staff_id===person.id&&row.venue_id===venueId&&new Date(row.starts_at)<=new Date(shift.starts_at)&&new Date(row.ends_at)>=new Date(shift.ends_at));
        const qualified=qualifications.some(row=>row.staff_id===person.id&&row.role_id===shift.role_id&&(!row.qualified_until||row.qualified_until>=shift.starts_at.slice(0,10)));
        const other=visibleShifts.filter(row=>row.staff_id===person.id&&row.id!==shift.id);
        const overlapping=other.some(row=>new Date(row.starts_at)<new Date(shift.ends_at)&&new Date(row.ends_at)>new Date(shift.starts_at));
        const restCompliant=!other.some(row=>{const before=new Date(shift.starts_at).getTime()-new Date(row.ends_at).getTime(),after=new Date(row.starts_at).getTime()-new Date(shift.ends_at).getTime();return before>=0&&before<11*3600000||after>=0&&after<11*3600000});
        const alreadyPlanned=other.reduce((sum,row)=>sum+Math.max(0,Math.floor((new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000)-row.break_minutes),0);
        const candidateCost=BigInt(person.effective_hourly_cost_minor??shift.hourly_cost_minor);
        return{staffId:person.id,eligible:!overlapping,available:availability?.availability!=="unavailable"&&availability!==undefined,restCompliant,skillsValid:qualified,projectedMinutes:alreadyPlanned+shiftMinutes,maximumMinutes:person.maximum_minutes_week??null,costDifferenceMinor:((candidateCost-BigInt(shift.hourly_cost_minor))*BigInt(shiftMinutes)+30n)/60n,preferred:availability?.availability==="preferred"};
      }));
      return{absence,shift,replacements};
    }),
  );
  const venueRecords=timeRecords.filter(record=>record.venue_id===venueId);
  const pendingRecords=venueRecords.filter(record=>record.status==="submitted"&&record.clocked_out_at);
  const approvedRecords=venueRecords.filter(record=>record.status==="approved"&&record.clocked_out_at);
  const approvedMinutes=approvedRecords.reduce((sum,record)=>sum+Math.max(0,Math.floor((new Date(record.clocked_out_at!).getTime()-new Date(record.clocked_in_at).getTime())/60000)-record.break_minutes),0);
  const actualLabor=approvedRecords.reduce((sum,record)=>{const minutes=Math.max(0,Math.floor((new Date(record.clocked_out_at!).getTime()-new Date(record.clocked_in_at).getTime())/60000)-record.break_minutes);const person=staff.find(row=>row.id===record.staff_id);return sum+(BigInt(person?.effective_hourly_cost_minor??"0")*BigInt(minutes)+30n)/60n},0n);

  async function mutate(action: string, values: Record<string, string>, optimistic?: () => void) {
    setBusy(true);
    setMessage("");
    if (action === "absence" && values.startsAt && !values.startsAt.endsWith("Z")) {
      values.startsAt = toUtc(values.startsAt);
      values.endsAt = toUtc(values.endsAt);
    }
    try {
      const response = await fetch("/api/planning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId,
          locale: locale === "nl" ? "nl-NL" : "en-US",
          action,
          values,
        }),
      });
      const result = (await response.json()) as { message?: string; errorCode?: string };
      if (!response.ok) {
        const errorMessage = result.errorCode === "SHIFT_OVERLAP"
          ? tx("Deze medewerker heeft al een overlappende dienst.", "This employee already has an overlapping shift.")
          : result.errorCode === "DUPLICATE_STAFF"
            ? tx("Deze medewerker bestaat al op basis van e-mail of telefoonnummer.", "This employee already exists by email or telephone number.")
            : tx("De wijziging kon niet worden opgeslagen.", "The change could not be saved.");
        throw new Error(errorMessage);
      }
      optimistic?.();
      setMessage(result.message ?? tx("Opgeslagen.", "Saved."));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tx("Opslaan mislukt.", "Save failed."));
    } finally {
      setBusy(false);
    }
  }
  async function workforceMutate(action:string,values:Record<string,string>){
    setBusy(true);setMessage("");try{const response=await fetch("/api/workforce",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,action,values})});const result=await response.json() as {message?:string};if(!response.ok)throw new Error(tx("De urenactie kon niet worden opgeslagen.","The hours action could not be saved."));setMessage(result.message??tx("Opgeslagen.","Saved."));router.refresh()}catch(error){setMessage(error instanceof Error?error.message:tx("Opslaan mislukt.","Save failed."))}finally{setBusy(false)}
  }
  const shiftValues = (row: Shift) => ({
    venueId: row.venue_id,
    shiftId: row.id,
    departmentId: row.department_id,
    roleId: row.role_id,
    staffId: row.staff_id ?? "open",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    breakMinutes: String(row.break_minutes),
    hourlyCost: (Number(BigInt(row.hourly_cost_minor)) / 100).toFixed(2),
    expectedRevision: String(row.revision ?? 1),
  });
  function moveShift(row: Shift, targetDay: Date) {
    const start = new Date(row.starts_at),
      end = new Date(row.ends_at),
      duration = end.getTime() - start.getTime();
    const nextStart = new Date(targetDay);
    nextStart.setHours(start.getHours(), start.getMinutes());
    const next = {
      ...row,
      starts_at: nextStart.toISOString(),
      ends_at: new Date(nextStart.getTime() + duration).toISOString(),
      status: "draft",
    };
    void mutate("shift_update", shiftValues(next), () =>
      setShifts((current) => current.map((item) => (item.id === row.id ? next : item))),
    );
  }
  function drop(event: DragEvent, targetDay: Date) {
    event.preventDefault();
    const row = shifts.find((item) => item.id === event.dataTransfer.getData("text/shift-id"));
    if (row) moveShift(row, targetDay);
  }
  function resize(row: Shift, minutes: number) {
    const next = {
      ...row,
      ends_at: new Date(new Date(row.ends_at).getTime() + minutes * 60000).toISOString(),
      status: "draft",
    };
    if (new Date(next.ends_at) <= new Date(next.starts_at)) return;
    void mutate("shift_update", shiftValues(next), () => {
      setShifts((current) => current.map((item) => (item.id === row.id ? next : item)));
      setSelected(next);
    });
  }
  const coverage = days.map((day) => {
    const end = new Date(day.getTime() + dayMs);
    const required = visibleIntervals
      .filter((row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end)
      .reduce((max, row) => Math.max(max, row.required_staff), 0);
    const planned = visibleShifts.filter(
      (row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end,
    ).length;
    return { required, planned };
  });

  return (
    <div className="roster-product">
      <header className="roster-toolbar">
        <div>
          <span className="eyebrow">{tx("TEAM & ROOSTER", "TEAM & ROSTER")}</span>
          <h2>{tx("Weekrooster", "Weekly roster")}</h2>
          <p>
            {tx(
              "Vraag, beschikbaarheid en loonkosten in één werkvlak.",
              "Demand, availability and labor cost in one workspace.",
            )}
          </p>
        </div>
        <div className="roster-actions">
          <button className="secondary" onClick={() => setPanel("availability")}>
            {tx("Beschikbaarheid opvragen", "Request availability")}
          </button>
          <button className="secondary" onClick={() => setPanel("team")}>
            {tx("Team beheren", "Manage team")}
          </button>
          <button
            className="primary"
            disabled={busy || !venueId}
            onClick={() => {
              if (!departments.length || !roles.length || !staff.length) {
                setPanel("team");
                return;
              }
              void mutate("proposal", {
                venueId,
                startsAt: weekStart.toISOString(),
                endsAt: weekEnd.toISOString(),
              });
            }}
          >
            {tx("Maak rooster", "Build roster")}
          </button>
          <button
            className="primary publish"
            disabled={busy || !visibleShifts.some((row) => row.status === "draft")}
            onClick={() =>
              void mutate("publish", {
                venueId,
                startsAt: weekStart.toISOString(),
                endsAt: weekEnd.toISOString(),
                expectedRevision: String(
                  Math.max(
                    ...visibleShifts
                      .filter((row) => row.status === "draft")
                      .map((row) => row.revision ?? 1),
                  ),
                ),
                idempotencyKey: crypto.randomUUID(),
              })
            }
          >
            {tx("Publiceer", "Publish")}
          </button>
        </div>
      </header>
      <section className="roster-context" aria-label={tx("Roosterperiode", "Roster period")}>
        <label>
          {tx("Vestiging", "Venue")}
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
            {venues.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <div className="week-switch">
          <button
            aria-label={tx("Vorige week", "Previous week")}
            onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * dayMs))}
          >
            ←
          </button>
          <strong>
            {weekStart.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
              day: "numeric",
              month: "short",
            })}{" "}
            –{" "}
            {new Date(weekEnd.getTime() - dayMs).toLocaleDateString(
              locale === "nl" ? "nl-NL" : "en-GB",
              { day: "numeric", month: "short", year: "numeric" },
            )}
          </strong>
          <button
            aria-label={tx("Volgende week", "Next week")}
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * dayMs))}
          >
            →
          </button>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void mutate("copy_week", {
              venueId,
              startsAt: new Date(weekStart.getTime() - 7 * dayMs).toISOString(),
              endsAt: weekStart.toISOString(),
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          {tx("Vorige week kopiëren", "Copy previous week")}
        </button>
        <button className="secondary" onClick={() => setPanel("absence")}>
          {tx("Verlof / ziek", "Leave / sickness")}
        </button>
      </section>
      <section className="roster-kpis">
        <article>
          <span>{tx("Omzetforecast", "Revenue forecast")}</span>
          <b>{currency(revenue)}</b>
          <small>
            {visibleIntervals.length} {tx("vraagblokken", "demand intervals")}
          </small>
        </article>
        <article>
          <span>{tx("Geplande loonkosten", "Planned labor")}</span>
          <b>{currency(labor)}</b>
          <small>
            {percent} {tx("van omzet", "of revenue")}
          </small>
        </article>
        <article>
          <span>{tx("Dekking", "Coverage")}</span>
          <b>{coverage.filter((row) => row.planned >= row.required).length}/7</b>
          <small>{tx("dagen op norm", "days on target")}</small>
        </article>
        <article>
          <span>{tx("Open diensten", "Open shifts")}</span>
          <b>{visibleShifts.filter((row) => !row.staff_id).length}</b>
          <small>{tx("toewijzing nodig", "need assignment")}</small>
        </article>
      </section>
      {(sicknessCases.length||coverageIntervals.some(row=>row.gap))?<section className="workforce-inbox" aria-label={tx("Beslissingen voor manager","Manager decision inbox")}><header><div><span className="eyebrow">{tx("BESLISSINGEN","DECISIONS")}</span><h3>{tx("Wat nu aandacht nodig heeft","What needs attention now")}</h3></div><b>{sicknessCases.length+coverageIntervals.filter(row=>row.gap).length}</b></header>{sicknessCases.map(({absence,shift,replacements})=><article key={`${absence.id}-${shift.id}`}><div><strong>{tx("Ziekte raakt geplande dienst","Sickness affects scheduled shift")}</strong><span>{staff.find(person=>person.id===absence.staff_id)?.full_name} · {new Date(shift.starts_at).toLocaleString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})}</span><small>{replacements.length?tx("Vervangers gerangschikt op voorkeur, kosten en uren.","Replacements ranked by preference, cost and hours."):tx("Geen volledig geldige vervanger; bied een open dienst aan.","No fully valid replacement; offer an open shift.")}</small></div>{replacements.slice(0,3).map((candidate,index)=><button type="button" key={candidate.staffId} className={index===0?"primary":"secondary"} disabled={busy} onClick={()=>{const values=shiftValues({...shift,staff_id:candidate.staffId});void mutate("shift_update",values,()=>setShifts(current=>current.map(row=>row.id===shift.id?{...shift,staff_id:candidate.staffId,status:"draft",revision:(shift.revision??1)+1}:row)))}}><b>{staff.find(person=>person.id===candidate.staffId)?.full_name}</b><small>{candidate.preferred?tx("voorkeur","preferred"):tx("beschikbaar","available")} · {candidate.costDifferenceMinor>=0n?"+":"−"}{currency(candidate.costDifferenceMinor<0n?-candidate.costDifferenceMinor:candidate.costDifferenceMinor)}</small></button>)}</article>)}{coverageIntervals.filter(row=>row.gap).slice(0,3).map(row=><button type="button" className="inbox-gap" key={row.id} onClick={()=>{if(venueDepartments[0]){setNewShift({day:new Date(row.startsAt),departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}><span>{tx("Dekkingsgat","Coverage gap")}</span><b>{row.gap} · {new Date(row.startsAt).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}</b><em>→</em></button>)}</section>:null}
      <section className="roster-intelligence" aria-label={tx("Roosterkwaliteit en vraagdekking", "Roster health and demand coverage")}>
        <article className="roster-health">
          <header><div><span className="eyebrow">ROSTER HEALTH</span><h3>{health.publishable?tx("Geen blokkerende regels","No blocking rules"):tx("Actie vereist vóór publicatie","Action required before publishing")}</h3></div><b className={health.publishable?"health-ok":"health-blocked"}>{health.publishable?tx("Publiceerbaar","Publishable"):tx("Geblokkeerd","Blocked")}</b></header>
          <div className="health-dimensions">{health.dimensions.map(dimension=>{const issues=health.issues.filter(issue=>issue.dimension===dimension);return <button type="button" key={dimension} onClick={()=>{if(issues.some(issue=>issue.code==="UNCOVERED_INTERVALS")&&venueDepartments[0]){setNewShift({day:weekStart,departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}><span>{dimension}</span><strong>{issues.some(issue=>issue.severity==="blocking")?"!":issues.length?"△":"✓"}</strong><small>{issues.length?`${issues.reduce((sum,issue)=>sum+issue.count,0)} ${tx("punt(en)","issue(s)")}`:tx("in orde","clear")}</small></button>})}</div>
          {health.issues.length?<ul>{health.issues.slice(0,5).map(issue=><li key={issue.code}><b>{issue.code.replaceAll("_"," ").toLowerCase()}</b><span>{issue.count}</span></li>)}</ul>:<p>{tx("Alle meetbare dimensies zijn binnen de beschikbare evidence in orde.","All measurable dimensions are clear within the available evidence.")}</p>}
        </article>
        <article className="what-if">
          <header><div><span className="eyebrow">WHAT IF?</span><h3>{tx("Test vraag zonder het rooster te wijzigen","Test demand without changing the roster")}</h3></div></header>
          <div className="scenario-buttons">{[-2000,-1000,0,1000,2000].map(value=><button type="button" className={scenarioBasisPoints===value?"active":""} key={value} onClick={()=>{setScenarioBasisPoints(value);if(value)void mutate("scenario",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString(),demandChangeBasisPoints:String(value),idempotencyKey:crypto.randomUUID()})}}>{value===0?tx("Basis","Baseline"):`${value>0?"+":""}${value/100}%`}</button>)}</div>
          <dl><div><dt>{tx("Benodigde medewerkers","Required employees")}</dt><dd>{(scenario??coverageIntervals).reduce((sum,row)=>sum+row.requiredStaff,0)}</dd></div><div><dt>{tx("Nieuwe gaten","Exposed gaps")}</dt><dd>{(scenario??coverageIntervals).reduce((sum,row)=>sum+row.gap,0)}</dd></div><div><dt>{tx("Wijzigt rooster","Changes roster")}</dt><dd>{tx("Nee — voorbeeld","No — preview")}</dd></div></dl>
        </article>
      </section>
      <section className="coverage-layer" aria-label={tx("Vraag en dekking per interval","Demand and coverage by interval")}>
        <header><div><span className="eyebrow">{tx("VRAAG → DEKKING","DEMAND → COVERAGE")}</span><h3>{tx("Waarom deze bezetting nodig is","Why this staffing is required")}</h3></div><small>{tx("Vraagforecast en vastgelegde diensten; geen AI-score.","Demand forecast and persisted shifts; no AI score.")}</small></header>
        {coverageIntervals.length?<div className="coverage-table" role="table"><div className="coverage-row coverage-heading" role="row"><span>{tx("Interval","Interval")}</span><span>{tx("Vraag","Demand")}</span><span>{tx("Nodig","Required")}</span><span>{tx("Gepland","Planned")}</span><span>{tx("Verschil","Difference")}</span><span>{tx("Kosten","Cost")}</span></div>{coverageIntervals.map(row=><button type="button" className={`coverage-row ${row.gap?"has-gap":row.overstaffing?"overstaffed":"covered"}`} role="row" key={row.id} onClick={()=>{if(row.gap&&venueDepartments[0]){setNewShift({day:new Date(row.startsAt),departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}><span>{new Date(row.startsAt).toLocaleString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})}</span><span>{visibleIntervals.find(interval=>interval.id===row.id)?.expected_guests??"—"}</span><span>{row.requiredStaff}</span><span>{row.plannedStaff}</span><strong>{row.gap?`−${row.gap}`:row.overstaffing?`+${row.overstaffing}`:"✓"}</strong><span>{currency(row.plannedCostMinor)}</span></button>)}</div>:<p className="quiet">{tx("Nog geen vastgelegde vraagintervallen. Maak eerst een serviceforecast.","No persisted demand intervals yet. Create a service forecast first.")}</p>}
      </section>
      <section className="staffing-command" aria-label={tx("Live bezetting en uren","Live staffing and hours")}><article><span className="eyebrow">{tx("LIVE BEZETTING","LIVE STAFFING")}</span><h3>{tx("Alleen actuele afwijkingen en beslissingen","Only current deviations and decisions")}</h3><div className="command-kpis"><div><b>{venueRecords.filter(record=>record.status==="open").length}</b><span>{tx("ingeklokt","clocked in")}</span></div><div><b>{pendingRecords.length}</b><span>{tx("uren te beoordelen","hours awaiting approval")}</span></div><div><b>{approvedMinutes}</b><span>{tx("goedgekeurde minuten","approved minutes")}</span></div><div><b>{currency(actualLabor)}</b><span>{tx("werkelijke loonkosten","actual labor")}</span></div></div></article><article><span className="eyebrow">{tx("URENCONTROLE","HOURS REVIEW")}</span><h3>{tx("Goedkeuren behoudt de oorspronkelijke tijdgebeurtenissen","Approval preserves original time events")}</h3>{pendingRecords.length?<div className="hours-list">{pendingRecords.slice(0,8).map(record=>{const person=staff.find(row=>row.id===record.staff_id);const minutes=Math.max(0,Math.floor((new Date(record.clocked_out_at!).getTime()-new Date(record.clocked_in_at).getTime())/60000)-record.break_minutes);return <div key={record.id}><span><b>{person?.full_name}</b><small>{minutes} min · {record.break_minutes} min {tx("pauze","break")}</small></span><button type="button" className="primary" disabled={busy} onClick={()=>void workforceMutate("approve_time",{timeRecordId:record.id,correctionReason:""})}>{tx("Uren goedkeuren","Approve hours")}</button></div>})}</div>:<p className="quiet">{tx("Geen ingediende uren wachten op goedkeuring.","No submitted hours await approval.")}</p>}</article></section>
      {message ? (
        <div className="roster-message" role="status">
          {message}
        </div>
      ) : null}
      {proposals.some((row) => row.venue_id === venueId && row.status === "current") ? (
        <section
          className="roster-proposals"
          aria-label={tx("Roosteropties", "Roster alternatives")}
        >
          <header>
            <h3>{tx("Kies een geldige roosteroptie", "Choose a valid roster alternative")}</h3>
            <p>
              {tx(
                "Elke optie gebruikt dezelfde vastgelegde vraag en harde personeelsregels.",
                "Each alternative uses the same persisted demand and hard workforce rules.",
              )}
            </p>
          </header>
          <div>
            {proposals
              .filter((row) => row.venue_id === venueId && row.status === "current")
              .slice(0, 3)
              .map((row) => (
                <article key={row.id}>
                  <b>
                    {row.objective === "balanced"
                      ? tx("Gebalanceerd", "Balanced")
                      : row.objective === "lowest_cost"
                        ? tx("Laagste verwachte kosten", "Lowest expected cost")
                        : tx("Medewerkersvoorkeur", "Employee preference")}
                  </b>
                  <strong>
                    {(row.result_summary.coverage_basis_points / 100).toFixed(1)}%{" "}
                    {tx("dekking", "coverage")}
                  </strong>
                  <span>
                    {currency(BigInt(row.result_summary.planned_cost_minor))} ·{" "}
                    {Math.round(row.result_summary.total_planned_minutes / 60)}h
                  </span>
                  <small>
                    {row.result_summary.unfilled_assignments}{" "}
                    {tx("ongevulde intervallen", "unfilled intervals")} ·{" "}
                    {row.result_summary.preferred_assignments} {tx("voorkeuren", "preferences")}
                  </small>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void mutate("proposal_apply", { venueId, proposalId: row.id }, () =>
                        router.refresh(),
                      )
                    }
                  >
                    {tx("Toepassen op concept", "Apply to draft")}
                  </button>
                </article>
              ))}
          </div>
        </section>
      ) : null}
      {!venueDepartments.length || !roles.length ? (
        <button className="guided-setup" onClick={() => setPanel("team")}>
          <b>{tx("Rooster instellen", "Set up roster")}</b>
          <span>
            {tx(
              "Voeg in één stap een afdeling, rol en eerste medewerker toe.",
              "Add a department, role and first employee in one guided step.",
            )}
          </span>
          <em>→</em>
        </button>
      ) : null}
      <section
        className="roster-board"
        aria-label={tx("Visueel weekrooster", "Visual weekly roster")}
      >
        <div className="roster-grid roster-head">
          <div className="employee-heading">{tx("Medewerker", "Employee")}</div>
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className={coverage[index].planned < coverage[index].required ? "coverage-gap" : ""}
            >
              <b>
                {day.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "short" })}
              </b>
              <span>{day.getDate()}</span>
              <small>
                {coverage[index].planned}/{coverage[index].required} {tx("bezet", "staffed")}
              </small>
            </div>
          ))}
        </div>
        {venueDepartments.map((department) => (
          <div className="department-group" key={department.id}>
            <h3>{department.name}</h3>
            {[
              ...activeStaff,
              {
                id: "open",
                full_name: tx("Open diensten", "Open shifts"),
                role_name: "",
                onboarding_status: "cleared",
              },
            ].map((person) => (
              <div className="roster-grid roster-row" key={`${department.id}-${person.id}`}>
                <div className="employee-cell">
                  <span className="avatar">
                    {person.id === "open" ? "+" : person.full_name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <b>{person.full_name}</b>
                    <small>{person.role_name}</small>
                  </div>
                </div>
                {days.map((day) => {
                  const cell = visibleShifts.filter(
                    (row) =>
                      row.department_id === department.id &&
                      (person.id === "open" ? !row.staff_id : row.staff_id === person.id) &&
                      new Date(row.starts_at).toDateString() === day.toDateString(),
                  );
                  const dayAbsence =
                    person.id !== "open" &&
                    absences.find(
                      (row) =>
                        row.staff_id === person.id &&
                        row.status !== "rejected" &&
                        new Date(row.starts_at) < new Date(day.getTime() + dayMs) &&
                        new Date(row.ends_at) > day,
                    );
                  return (
                    <div
                      className={`shift-cell ${dayAbsence ? "unavailable" : ""}`}
                      key={day.toISOString()}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => drop(event, day)}
                    >
                      {dayAbsence ? (
                        <span className="absence-chip">
                          {dayAbsence.absence_type === "sickness"
                            ? tx("Ziek", "Sick")
                            : tx("Verlof", "Leave")}
                        </span>
                      ) : null}
                      {cell.map((row) => (
                        <button
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData("text/shift-id", row.id)
                          }
                          onClick={() => {
                            setSelected(row);
                            setPanel("shift");
                          }}
                          className={`shift-card ${row.status}`}
                          key={row.id}
                        >
                          <b>
                            {roles.find((role) => role.id === row.role_id)?.name ??
                              tx("Dienst", "Shift")}
                          </b>
                          <span>
                            {new Date(row.starts_at).toLocaleTimeString(
                              locale === "nl" ? "nl-NL" : "en-GB",
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                            –
                            {new Date(row.ends_at).toLocaleTimeString(
                              locale === "nl" ? "nl-NL" : "en-GB",
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </span>
                          <small>
                            {row.break_minutes
                              ? `${row.break_minutes}m ${tx("pauze", "break")}`
                              : ""}
                          </small>
                        </button>
                      ))}
                      {!dayAbsence ? (
                        <button
                          className="add-shift"
                          aria-label={`${tx("Dienst toevoegen", "Add shift")} ${person.full_name}`}
                          onClick={() => {
                            setNewShift({ day, departmentId: department.id, staffId: person.id });
                            setPanel("new");
                          }}
                        >
                          ＋
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </section>
      {panel ? (
        <div className="side-panel-backdrop" onClick={() => setPanel(null)}>
          <aside
            className="roster-side-panel"
            onClick={(event) => event.stopPropagation()}
            aria-label={tx("Contextpaneel", "Context panel")}
          >
            <button
              className="panel-close"
              onClick={() => setPanel(null)}
              aria-label={tx("Sluiten", "Close")}
            >
              ×
            </button>
            {panel === "availability" ? (
              <AvailabilityManager
                organisationId={organisationId}
                venueTimezone={venueTimezone}
                venues={venues
                  .filter((row) => row.id === venueId)
                  .map((row) => ({ id: row.id, label: row.name }))}
                staff={activeStaff.map((row) => ({
                  id: row.id,
                  label: `${row.full_name} · ${row.role_name}`,
                }))}
              />
            ) : panel === "shift" && selected ? (
              <ShiftEditor
                row={selected}
                departments={venueDepartments}
                roles={roles}
                staff={activeStaff}
                locale={locale}
                busy={busy}
                toLocal={toLocal}
                save={(values) => {
                  values.startsAt = toUtc(values.startsAt);
                  values.endsAt = toUtc(values.endsAt);
                  void mutate("shift_update", values, () =>
                    setShifts((current) =>
                      current.map((item) =>
                        item.id === selected.id
                          ? {
                              ...selected,
                              starts_at: values.startsAt,
                              ends_at: values.endsAt,
                              staff_id: values.staffId === "open" ? null : values.staffId,
                              role_id: values.roleId,
                              department_id: values.departmentId,
                              break_minutes: Number(values.breakMinutes),
                              hourly_cost_minor: String(
                                Math.round(Number(values.hourlyCost) * 100),
                              ),
                              status: "draft",
                            }
                          : item,
                      ),
                    ),
                  );
                }}
                resize={(minutes) => resize(selected, minutes)}
                duplicate={() => void mutate("shift_duplicate",{venueId:selected.venue_id,shiftId:selected.id,idempotencyKey:crypto.randomUUID()},()=>router.refresh())}
                toggleLock={() => void mutate("shift_lock",{venueId:selected.venue_id,shiftId:selected.id,locked:String(!selected.locked),expectedRevision:String(selected.revision??1)},()=>{setShifts(current=>current.map(item=>item.id===selected.id?{...selected,locked:!selected.locked,revision:(selected.revision??1)+1}:item));setSelected(current=>current?{...current,locked:!current.locked,revision:(current.revision??1)+1}:current)})}
                cancel={() =>
                  void mutate(
                    "shift_cancel",
                    { venueId: selected.venue_id, shiftId: selected.id },
                    () => {
                      setShifts((current) => current.filter((item) => item.id !== selected.id));
                      setPanel(null);
                    },
                  )
                }
              />
            ) : panel === "new" && newShift ? (
              <NewShiftEditor
                venueId={venueId}
                draft={newShift}
                departments={venueDepartments}
                roles={roles}
                staff={activeStaff}
                locale={locale}
                busy={busy}
                save={(values) => {
                  values.startsAt = toUtc(values.startsAt);
                  values.endsAt = toUtc(values.endsAt);
                  void mutate("shift", values, () => {
                    setPanel(null);
                    router.refresh();
                  });
                }}
              />
            ) : panel === "team" ? (
              <>
                <TeamSetup
                  organisationId={organisationId}
                  venueId={venueId}
                  departments={venueDepartments}
                  roles={roles}
                  staff={activeStaff}
                  busy={busy}
                  mutate={mutate}
                  tx={tx}
                />
                <EmployeeCsvImport organisationId={organisationId} venueId={venueId} />
              </>
            ) : (
              <AbsencePanel
                venueId={venueId}
                staff={activeStaff}
                absences={absences}
                busy={busy}
                mutate={mutate}
                tx={tx}
              />
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function NewShiftEditor({
  venueId,
  draft,
  departments,
  roles,
  staff,
  locale,
  busy,
  save,
}: {
  venueId: string;
  draft: { day: Date; departmentId: string; staffId: string };
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  locale: string;
  busy: boolean;
  save: (values: Record<string, string>) => void;
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const start = new Date(draft.day);
  start.setHours(17, 0, 0, 0);
  const end = new Date(draft.day);
  end.setHours(23, 0, 0, 0);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>);
      }}
    >
      <h3>{tx("Dienst toevoegen", "Add shift")}</h3>
      <input type="hidden" name="venueId" value={venueId} />
      <label>
        {tx("Medewerker", "Employee")}
        <select name="staffId" defaultValue={draft.staffId}>
          <option value="open">{tx("Open dienst", "Open shift")}</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Afdeling", "Department")}
        <select name="departmentId" defaultValue={draft.departmentId}>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Rol", "Role")}
        <select
          name="roleId"
          defaultValue={roles.find((item) => item.department_id === draft.departmentId)?.id}
        >
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Start", "Start")}
        <input name="startsAt" type="datetime-local" defaultValue={isoLocal(start)} required />
      </label>
      <label>
        {tx("Einde", "End")}
        <input name="endsAt" type="datetime-local" defaultValue={isoLocal(end)} required />
      </label>
      <label>
        {tx("Pauze (min)", "Break (min)")}
        <input name="breakMinutes" type="number" min="0" max="480" defaultValue="30" />
      </label>
      <label>
        {tx("All-in uurkosten (€)", "All-in hourly cost (€)")}
        <input
          name="hourlyCost"
          inputMode="decimal"
          defaultValue={(
            Number(
              BigInt(
                roles.find((item) => item.department_id === draft.departmentId)
                  ?.hourly_cost_minor ?? "0",
              ),
            ) / 100
          ).toFixed(2)}
          required
        />
      </label>
      <button className="primary" disabled={busy}>
        {tx("Conceptdienst opslaan", "Save draft shift")}
      </button>
    </form>
  );
}

function ShiftEditor({
  row,
  departments,
  roles,
  staff,
  locale,
  busy,
  toLocal,
  save,
  resize,
  duplicate,
  toggleLock,
  cancel,
}: {
  row: Shift;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  locale: string;
  busy: boolean;
  toLocal: (value: string) => string;
  save: (values: Record<string, string>) => void;
  resize: (minutes: number) => void;
  duplicate: () => void;
  toggleLock: () => void;
  cancel: () => void;
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>);
      }}
    >
      <h3>{tx("Dienst bewerken", "Edit shift")}</h3>
      <input type="hidden" name="venueId" value={row.venue_id} />
      <input type="hidden" name="shiftId" value={row.id} />
      <input type="hidden" name="expectedRevision" value={row.revision ?? 1} />
      <label>
        {tx("Medewerker", "Employee")}
        <select name="staffId" defaultValue={row.staff_id ?? "open"}>
          <option value="open">{tx("Open dienst", "Open shift")}</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Afdeling", "Department")}
        <select name="departmentId" defaultValue={row.department_id}>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Rol", "Role")}
        <select name="roleId" defaultValue={row.role_id}>
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx("Start", "Start")}
        <input
          name="startsAt"
          type="datetime-local"
          defaultValue={toLocal(row.starts_at)}
        />
      </label>
      <label>
        {tx("Einde", "End")}
        <input name="endsAt" type="datetime-local" defaultValue={toLocal(row.ends_at)} />
      </label>
      <label>
        {tx("Pauze (min)", "Break (min)")}
        <input
          name="breakMinutes"
          type="number"
          min="0"
          max="480"
          defaultValue={row.break_minutes}
        />
      </label>
      <label>
        {tx("All-in uurkosten (€)", "All-in hourly cost (€)")}
        <input
          name="hourlyCost"
          inputMode="decimal"
          defaultValue={(Number(BigInt(row.hourly_cost_minor)) / 100).toFixed(2)}
        />
      </label>
      <div className="resize-actions">
        <button type="button" disabled={busy||row.locked} onClick={() => resize(-30)}>
          −30m
        </button>
        <button type="button" disabled={busy||row.locked} onClick={() => resize(30)}>
          +30m
        </button>
      </div>
      <div className="resize-actions"><button type="button" disabled={busy} onClick={duplicate}>{tx("Dupliceer als open dienst","Duplicate as open shift")}</button><button type="button" disabled={busy} onClick={toggleLock}>{row.locked?tx("Ontgrendel","Unlock"):tx("Vergrendel","Lock")}</button></div>
      <button className="primary" disabled={busy||row.locked}>
        {tx("Opslaan", "Save")}
      </button>
      <button className="danger" type="button" disabled={busy} onClick={cancel}>
        {tx("Dienst verwijderen", "Delete shift")}
      </button>
    </form>
  );
}

function TeamSetup({
  venueId,
  departments,
  roles,
  staff,
  busy,
  mutate,
  tx,
}: {
  organisationId: string;
  venueId: string;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  busy: boolean;
  mutate: (action: string, values: Record<string, string>) => Promise<void>;
  tx: (nl: string, en: string) => string;
}) {
  return (
    <div>
      <h3>{tx("Team instellen", "Set up team")}</h3>
      {!departments.length ? (
        <form
          key="department-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              "department",
              Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
            );
          }}
        >
          <input type="hidden" name="venueId" value={venueId} />
          <label>
            {tx("Eerste afdeling", "First department")}
            <input
              name="name"
              required
              placeholder={tx("Bar, keuken, bediening…", "Bar, kitchen, floor…")}
            />
          </label>
          <button className="primary" disabled={busy}>
            {tx("Afdeling toevoegen", "Add department")}
          </button>
        </form>
      ) : !roles.length ? (
        <form
          key="role-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              "role",
              Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
            );
          }}
        >
          <label>
            {tx("Afdeling", "Department")}
            <select name="departmentId">
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx("Rolnaam", "Role name")}
            <input name="name" required />
          </label>
          <label>
            {tx("Uurkosten (€)", "Hourly cost (€)")}
            <input name="hourlyCost" defaultValue="18.50" required />
          </label>
          <input type="hidden" name="minimumStaff" value="1" />
          <input type="hidden" name="guestsPerStaff" value="30" />
          <button className="primary" disabled={busy}>
            {tx("Rol toevoegen", "Add role")}
          </button>
        </form>
      ) : (
        <form
          key="staff-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              "staff",
              Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
            );
          }}
        >
          <input type="hidden" name="venueId" value={venueId} />
          <label>
            {tx("Naam", "Name")}
            <input name="fullName" required />
          </label>
          <label>
            {tx("E-mail", "Email")}
            <input name="email" type="email" />
          </label>
          <label>
            {tx("Telefoon", "Phone")}
            <input name="phone" type="tel" />
          </label>
          <label>
            {tx("Functie", "Role")}
            <input name="roleName" required defaultValue={roles[0]?.name} />
          </label>
          <label>
            {tx("Contract", "Contract")}
            <select name="engagementType">
              <option value="employee">{tx("Medewerker", "Employee")}</option>
              <option value="contractor">{tx("Zelfstandige", "Contractor")}</option>
              <option value="temporary">{tx("Tijdelijk", "Temporary")}</option>
            </select>
          </label>
          <label>
            {tx("Taal", "Language")}
            <select name="preferredLanguage">
              <option value="nl">NL</option>
              <option value="en">EN</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            {tx("Medewerker toevoegen", "Add employee")}
          </button>
        </form>
      )}
      <div className="team-list">
        {staff.map((person) => (
          <div key={person.id}>
            <span className="avatar">{person.full_name.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{person.full_name}</b>
              <small>{person.role_name}</small>
            </div>
            <button
              disabled={busy}
              onClick={() => void mutate("staff_deactivate", { staffId: person.id })}
            >
              {tx("Deactiveer", "Deactivate")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AbsencePanel({
  venueId,
  staff,
  absences,
  busy,
  mutate,
  tx,
}: {
  venueId: string;
  staff: Staff[];
  absences: Absence[];
  busy: boolean;
  mutate: (action: string, values: Record<string, string>) => Promise<void>;
  tx: (nl: string, en: string) => string;
}) {
  return (
    <div>
      <h3>{tx("Verlof en ziekte", "Leave and sickness")}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(
            "absence",
            Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
          );
        }}
      >
        <input type="hidden" name="venueId" value={venueId} />
        <label>
          {tx("Medewerker", "Employee")}
          <select name="staffId">
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tx("Type", "Type")}
          <select name="absenceType">
            <option value="leave">{tx("Verlof", "Leave")}</option>
            <option value="sickness">{tx("Ziek", "Sickness")}</option>
            <option value="other">{tx("Overig", "Other")}</option>
          </select>
        </label>
        <label>
          {tx("Start", "Start")}
          <input name="startsAt" type="datetime-local" required />
        </label>
        <label>
          {tx("Einde", "End")}
          <input name="endsAt" type="datetime-local" required />
        </label>
        <label>
          {tx("Toelichting", "Note")}
          <textarea name="note" />
        </label>
        <button className="primary" disabled={busy}>
          {tx("Opslaan", "Save")}
        </button>
      </form>
      <div className="team-list">
        {absences
          .filter((row) => row.venue_id === venueId)
          .map((row) => (
            <div key={row.id}>
              <div>
                <b>{staff.find((person) => person.id === row.staff_id)?.full_name}</b>
                <small>
                  {row.absence_type} · {row.status}
                </small>
              </div>
              {row.status === "requested" ? (
                <span>
                  <button
                    onClick={() =>
                      void mutate("absence_decide", {
                        venueId,
                        absenceId: row.id,
                        decision: "approved",
                      })
                    }
                  >
                    {tx("Goedkeuren", "Approve")}
                  </button>
                  <button
                    onClick={() =>
                      void mutate("absence_decide", {
                        venueId,
                        absenceId: row.id,
                        decision: "rejected",
                      })
                    }
                  >
                    {tx("Afwijzen", "Reject")}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
      </div>
    </div>
  );
}
