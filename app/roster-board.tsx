"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";
import { AvailabilityManager } from "./availability-manager";
import { EmployeeCsvImport } from "./employee-csv-import";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/workforce/timezone";
import { analyzeRosterConstraints, calculateCoverage, rosterHealth, simulateDemand } from "@/lib/workforce/decision-support";
import { planReplacementSegments } from "@/lib/workforce/replacement-planner";
import { normalizeDutchPhone } from "@/lib/workforce/domain";
import { isoWeekday, patternHeadcount, type LaneKind, type ServicePattern } from "@/lib/workforce/service-nights";
import { ServiceNightsPanel } from "./service-nights";

type Venue = { id: string; name: string; timezone: string };
type Department = { id: string; venue_id: string; name: string; kind?: LaneKind };
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
  contact_phone?:string|null;
  preferred_language?:string;
  employment_status?:string;
  invitation_state?:string;
  effective_hourly_cost_minor?: string | null;
  contracted_minutes_week?: number | null;
  minimum_minutes_week?:number|null;
  maximum_minutes_week?: number | null;
  preferences?: Record<string,unknown>;
  auth_user_id?: string | null;
};
type StaffAvailability={staff_id:string;venue_id:string;starts_at:string;ends_at:string;availability:"available"|"preferred"|"preferably_not"|"unavailable";submitted_at:string|null;source:string};
type Qualification={staff_id:string;role_id:string;qualified_until:string|null};
type TimeRecord={id:string;venue_id:string;staff_id:string;shift_id:string|null;clocked_in_at:string;clocked_out_at:string|null;break_minutes:number;status:string;approved_at:string|null};
type BreakPlan={id:string;venue_id:string;shift_id:string;starts_at:string;ends_at:string;status:string;revision:number};
type RosterTemplate={id:string;venue_id:string;name:string;shift_pattern:unknown[];active:boolean};
type SwapRequest={id:string;venue_id:string;shift_id:string;requester_staff_id:string;candidate_staff_id:string;state:string;reason:string|null;cost_effect_minor:string|null;created_at:string};
type TimeCorrection={id:string;venue_id:string;time_record_id:string;reason:string;original_values:Record<string,unknown>;proposed_values:Record<string,unknown>;status:string;created_at:string};
type ApprovedLabourResult={id:string;venue_id:string;trading_date:string;planned_minutes:number;worked_minutes:number;planned_cost_minor:string;actual_cost_minor:string;calculation_version:string;evidence:Record<string,unknown>;content_hash:string;calculated_at:string};
type WorkforceException={action_key:string;venue_id:string;exception_type:string;severity:string;rank_score:string;relevant_at:string;shift_id:string|null;staff_id:string|null;source_id:string;evidence:Record<string,unknown>;why_it_matters:string;recommended_action:string;resolution_condition:string};
type WorkforceLearning={id:string;venue_id:string;service_date:string;evidence_state:string;comparable_count:number;comparison_method:Record<string,unknown>;result:Record<string,unknown>;evidence_refs:Record<string,unknown>;calculation_version:string;content_hash:string;created_at:string};
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
    required_assignments?: number;
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
const isoWeek = (value: Date) => {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / dayMs + 1) / 7);
};
const phoneState=(value:string|null|undefined):"valid"|"missing"|"invalid"=>{if(!value)return "missing";try{normalizeDutchPhone(value);return "valid"}catch{return "invalid"}};

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
  breakPlans,
  rosterTemplates,
  swaps,
  timeCorrections,
  approvedLabourResults,
  workforceExceptions,
  workforceLearning,
  proposals,
  servicePatterns = [],
  plannerUserIds = [],
  canManageMembers = false,
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
  breakPlans: BreakPlan[];
  rosterTemplates: RosterTemplate[];
  swaps:SwapRequest[];
  timeCorrections:TimeCorrection[];
  approvedLabourResults:ApprovedLabourResult[];
  workforceExceptions:WorkforceException[];
  workforceLearning:WorkforceLearning[];
  proposals: Proposal[];
  servicePatterns?: ServicePattern[];
  plannerUserIds?: string[];
  canManageMembers?: boolean;
}) {
  const { locale } = useAuthLocale(),
    router = useRouter();
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [shifts, setShifts] = useState(initialShifts);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [view, setView] = useState<"week" | "day" | "month">("week");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [templateName,setTemplateName]=useState("");
  const [templateId,setTemplateId]=useState("");
  const [templateRepeats,setTemplateRepeats]=useState(1);
  useEffect(()=>{const handle=window.setTimeout(()=>setShifts(initialShifts),0);return()=>window.clearTimeout(handle)},[initialShifts]);
  const [panel, setPanel] = useState<"shift" | "new" | "team" | "absence" | "availability" | "missed" | "health" | "scenario" | "publish" | "templates" | "share" | "nights" | null>(
    null,
  );
  const [tab, setTab] = useState<"roster" | "actions" | "insights" | "hours">("roster");
  const [mobileDay, setMobileDay] = useState<number | null>(null);
  const [nowMs] = useState(() => Date.now());
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
  const [lane, setLane] = useState<LaneKind>("staff");
  const laneOfDepartment = (departmentId: string): LaneKind => departments.find((row) => row.id === departmentId)?.kind === "dj" ? "dj" : "staff";
  const laneOfRole = (roleId: string): LaneKind => laneOfDepartment(roles.find((row) => row.id === roleId)?.department_id ?? "");
  const hasDjLane = departments.some((row) => row.venue_id === venueId && row.kind === "dj");
  const activeLane: LaneKind = hasDjLane ? lane : "staff";
  const weekShifts = shifts.filter(
    (row) =>
      row.venue_id === venueId &&
      new Date(row.starts_at) >= weekStart &&
      new Date(row.starts_at) < weekEnd &&
      row.status !== "cancelled",
  );
  const staffShifts = weekShifts.filter((row) => laneOfDepartment(row.department_id) === "staff");
  const visibleShifts = weekShifts.filter((row) => laneOfDepartment(row.department_id) === activeLane);
  const visibleIntervals = intervals.filter(
    (row) =>
      row.venue_id === venueId &&
      new Date(row.starts_at) >= weekStart &&
      new Date(row.starts_at) < weekEnd,
  );
  const visibleBreakPlans=breakPlans.filter(plan=>plan.venue_id===venueId&&visibleShifts.some(shift=>shift.id===plan.shift_id)&&plan.status!=="cancelled");
  const breakConflicts=visibleIntervals.filter(interval=>{const assigned=staffShifts.filter(shift=>shift.staff_id&&new Date(shift.starts_at)<new Date(interval.ends_at)&&new Date(shift.ends_at)>new Date(interval.starts_at));const onBreak=new Set(visibleBreakPlans.filter(plan=>new Date(plan.starts_at)<new Date(interval.ends_at)&&new Date(plan.ends_at)>new Date(interval.starts_at)).map(plan=>plan.shift_id));return assigned.length>=interval.required_staff&&assigned.filter(shift=>!onBreak.has(shift.id)).length<interval.required_staff;}).length;
  const allVenueDepartments = departments.filter((row) => row.venue_id === venueId);
  const venueDepartments = allVenueDepartments.filter((row) => (row.kind === "dj" ? "dj" : "staff") === activeLane);
  const activeStaff = staff.filter((row) => row.onboarding_status !== "suspended");
  const displayedDepartments = venueDepartments.filter((row) => !departmentFilter || row.id === departmentFilter);
  const displayedStaff = activeStaff.filter((row) => row.full_name.toLocaleLowerCase(locale).includes(employeeSearch.trim().toLocaleLowerCase(locale)));
  const revenue = visibleIntervals.reduce(
    (sum, row) => sum + BigInt(row.expected_revenue_minor),
    0n,
  );
  const labor = weekShifts.reduce((sum, row) => {
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
    staffShifts.map((row) => ({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",staffId:row.staff_id,hourlyCostMinor:BigInt(row.hourly_cost_minor),breakMinutes:row.break_minutes})),
  );
  const scenario = scenarioBasisPoints ? simulateDemand(coverageIntervals, scenarioBasisPoints) : null;
  const constraints=analyzeRosterConstraints(weekShifts.map(shift=>({id:shift.id,staffId:shift.staff_id,startsAt:shift.starts_at,endsAt:shift.ends_at,breakMinutes:shift.break_minutes})),activeStaff.map(person=>({id:person.id,maximumMinutes:person.maximum_minutes_week??null})));
  const availabilityConflicts=weekShifts.filter(shift=>{
    if(!shift.staff_id)return false;
    if(absences.some(absence=>absence.staff_id===shift.staff_id&&absence.status!=="rejected"&&new Date(absence.starts_at)<new Date(shift.ends_at)&&new Date(absence.ends_at)>new Date(shift.starts_at)))return true;
    const availability=staffAvailability.find(row=>row.staff_id===shift.staff_id&&row.venue_id===venueId&&new Date(row.starts_at)<=new Date(shift.starts_at)&&new Date(row.ends_at)>=new Date(shift.ends_at));
    return !availability||availability.availability==="unavailable";
  }).length;
  const skillConflicts=weekShifts.filter(shift=>shift.staff_id&&!qualifications.some(row=>row.staff_id===shift.staff_id&&row.role_id===shift.role_id&&(!row.qualified_until||row.qualified_until>=shift.starts_at.slice(0,10)))).length;
  const hourImbalances=activeStaff.filter(person=>person.contracted_minutes_week!=null&&Math.abs((constraints.minutesByStaff.get(person.id)??0)-person.contracted_minutes_week)>=60).length;
  const health = rosterHealth({
    coverage: coverageIntervals,
    hardConstraintViolations: constraints.total,
    availabilityConflicts,
    skillConflicts,
    laborBasisPoints: revenue ? Number((labor * 10_000n) / revenue) : null,
    targetLaborBasisPoints: 2_000,
    hourImbalances,
    preferenceMisses: proposals.find((row) => row.objective === "preference")?.result_summary.unfilled_assignments ?? 0,
    breakConflicts,
    missingEvidence: visibleIntervals.length ? [] : ["demand"],
  });
  const venueRecords=timeRecords.filter(record=>record.venue_id===venueId);
  const pendingRecords=venueRecords.filter(record=>record.status==="submitted"&&record.clocked_out_at);
  const approvedRecords=venueRecords.filter(record=>record.status==="approved"&&record.clocked_out_at);
  const approvedMinutes=approvedRecords.reduce((sum,record)=>sum+Math.max(0,Math.floor((new Date(record.clocked_out_at!).getTime()-new Date(record.clocked_in_at).getTime())/60000)-record.break_minutes),0);
  const latestApprovedLabour=approvedLabourResults.filter(result=>result.venue_id===venueId&&new Date(`${result.trading_date}T00:00:00`)>=weekStart&&new Date(`${result.trading_date}T00:00:00`)<weekEnd).sort((left,right)=>right.calculated_at.localeCompare(left.calculated_at))[0];
  const actualLabor=BigInt(latestApprovedLabour?.actual_cost_minor??"0");
  const venueExceptions=workforceExceptions.filter(item=>item.venue_id===venueId).sort((left,right)=>Number(right.rank_score)-Number(left.rank_score)||left.relevant_at.localeCompare(right.relevant_at)||left.action_key.localeCompare(right.action_key));
  const latestLearning=workforceLearning.filter(item=>item.venue_id===venueId).sort((left,right)=>right.created_at.localeCompare(left.created_at))[0];
  const issueLabel=(code:string)=>({UNCOVERED_INTERVALS:tx("Minder bezetting dan de forecast","Staffing below forecast"),OVERSTAFFED_INTERVALS:tx("Meer bezetting dan de forecast","Staffing above forecast"),HARD_CONSTRAINTS:tx("Rusttijd, overlap of maximale uren geschonden","Rest time, overlap or maximum hours violated"),AVAILABILITY_CONFLICTS:tx("Ingepland zonder beschikbaarheid of tijdens afwezigheid","Scheduled without availability or during absence"),SKILL_CONFLICTS:tx("Ingepland zonder kwalificatie voor de rol","Scheduled without qualification for the role"),LABOR_TARGET_EXCEEDED:tx("Loonkosten boven 20% van de verwachte omzet","Labour cost above 20% of expected revenue"),CONTRACT_HOUR_IMBALANCE:tx("Afwijking van contracturen","Contract hours imbalance"),PREFERENCE_MISSES:tx("Voorkeuren niet gehonoreerd","Preferences not met"),BREAK_COVERAGE_CONFLICTS:tx("Pauzes laten de vloer onbezet","Breaks leave the floor uncovered"),MISSING_EVIDENCE:tx("Geen vraagforecast voor deze week","No demand forecast for this week")} as Record<string,string>)[code]??code.replaceAll("_"," ").toLowerCase();
  const exceptionLabel=(type:string)=>({sickness_coverage:tx("Ziekte raakt gepubliceerde dienst","Sickness affects published shift"),approved_leave_coverage:tx("Goedgekeurd verlof raakt dekking","Approved leave affects coverage"),coverage_gap:tx("Dekkingsgat","Coverage gap"),swap_decision:tx("Ruilbesluit","Swap decision"),time_correction:tx("Tijdcorrectie","Time correction"),submitted_hours:tx("Uren goedkeuren","Approve submitted hours"),open_shift:tx("Open dienst","Open shift"),stale_proposal:tx("Verouderd voorstel","Stale proposal")}[type]??type);
  const selectedReplacementException=selected?.status==="published"?venueExceptions.find(item=>item.shift_id===selected.id&&(item.exception_type==="sickness_coverage"||item.exception_type==="approved_leave_coverage")):undefined;
  const selectedReplacementPlan=selected&&selectedReplacementException?planReplacementSegments(
    {startsAt:selected.starts_at,endsAt:selected.ends_at,breakMinutes:selected.break_minutes},
    activeStaff.filter(person=>person.id!==selected.staff_id).map(person=>{
      const qualified=qualifications.some(row=>row.staff_id===person.id&&row.role_id===selected.role_id&&(!row.qualified_until||row.qualified_until>=selected.starts_at.slice(0,10)));
      const absent=absences.some(row=>row.staff_id===person.id&&row.status!=="rejected"&&new Date(row.starts_at)<new Date(selected.ends_at)&&new Date(row.ends_at)>new Date(selected.starts_at));
      const restConflict=shifts.some(row=>row.id!==selected.id&&row.staff_id===person.id&&row.status!=="cancelled"&&row.status!=="rejected"&&new Date(row.starts_at).getTime()<new Date(selected.ends_at).getTime()+11*60*60*1000&&new Date(row.ends_at).getTime()>new Date(selected.starts_at).getTime()-11*60*60*1000);
      const weekMinutes=shifts.filter(row=>row.id!==selected.id&&row.staff_id===person.id&&row.status!=="cancelled"&&row.status!=="rejected"&&new Date(row.starts_at)>=weekStart&&new Date(row.starts_at)<weekEnd).reduce((sum,row)=>sum+Math.max(0,Math.floor((new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000)-row.break_minutes),0);
      return {staffId:person.id,name:person.full_name,hourlyCostMinor:BigInt(person.effective_hourly_cost_minor??selected.hourly_cost_minor),eligible:qualified&&!absent&&!restConflict&&(person.maximum_minutes_week==null||weekMinutes<person.maximum_minutes_week),maxWorkMinutes:person.maximum_minutes_week==null?undefined:Math.max(0,person.maximum_minutes_week-weekMinutes),availability:staffAvailability.filter(row=>row.staff_id===person.id&&row.venue_id===selected.venue_id&&row.availability!=="unavailable").map(row=>({startsAt:row.starts_at,endsAt:row.ends_at}))};
    }),
  ):null;

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
      const result = (await response.json()) as { message?: string; errorCode?: string; invitation?:{id:string;link:string;message:string;whatsappUrl:string;deliveryState:string;providerConnected:boolean} };
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
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tx("Opslaan mislukt.", "Save failed."));
    } finally {
      setBusy(false);
    }
    return undefined;
  }
  async function applyStandardWeek(){
    setBusy(true);setMessage("");
    try{
      const local=`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,"0")}-${String(weekStart.getDate()).padStart(2,"0")}`;
      const response=await fetch("/api/planning/nights",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,action:"week_apply",values:{venueId,weekStart:local}})});
      const result=await response.json() as {message?:string;errorCode?:string};
      if(!response.ok)throw new Error(result.errorCode==="FORBIDDEN"?tx("Je hebt geen planningsrechten.","You don't have planning rights."):tx("Standaardweek invullen mislukt.","Filling the standard week failed."));
      setMessage(result.message??tx("Standaardweek ingevuld.","Standard week filled."));router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:tx("Mislukt.","Failed."))}finally{setBusy(false)}
  }
  async function workforceMutate(action:string,values:Record<string,string>){
    setBusy(true);setMessage("");try{const response=await fetch("/api/workforce",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,action,values})});const result=await response.json() as {message?:string};if(!response.ok)throw new Error(tx("De urenactie kon niet worden opgeslagen.","The hours action could not be saved."));setMessage(result.message??tx("Opgeslagen.","Saved."));router.refresh()}catch(error){setMessage(error instanceof Error?error.message:tx("Opslaan mislukt.","Save failed."))}finally{setBusy(false)}
  }
  async function bulkMutate(operation:"cancel"|"lock"|"unlock"|"assign"|"role",extra:Record<string,string>={}){
    const rows=visibleShifts.filter(row=>selectedIds.includes(row.id));
    if(!rows.length)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,locale:locale==="nl"?"nl-NL":"en-US",action:"shift_bulk",values:{venueId,shiftIds:JSON.stringify(rows.map(row=>row.id)),expectedRevisions:JSON.stringify(Object.fromEntries(rows.map(row=>[row.id,row.revision??1]))),operation,idempotencyKey:crypto.randomUUID(),...extra}})});
      const result=await response.json() as {message?:string;errorCode?:string;changeSetId?:string};
      if(!response.ok)throw new Error(result.errorCode==="PLANNING_ACTION_FAILED"?tx("De selectie is intussen gewijzigd of bevat vergrendelde diensten.","The selection changed concurrently or contains locked shifts."):tx("Bulkbewerking mislukt.","Bulk edit failed."));
      if(result.changeSetId){setUndoStack(current=>[...current,result.changeSetId!]);setRedoStack([])}
      setSelectedIds([]);setMessage(result.message??tx("Selectie opgeslagen.","Selection saved."));router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:tx("Bulkbewerking mislukt.","Bulk edit failed."))}finally{setBusy(false)}
  }
  async function replayHistory(direction:"undo"|"redo"){
    const source=direction==="undo"?undoStack:redoStack,changeSetId=source.at(-1);if(!changeSetId)return;
    setBusy(true);setMessage("");
    try{const response=await fetch("/api/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,locale:locale==="nl"?"nl-NL":"en-US",action:"planner_history",values:{venueId,changeSetId,direction}})});const result=await response.json() as {message?:string};if(!response.ok)throw new Error(tx("Ongedaan maken is geblokkeerd door een nieuwere wijziging.","Undo is blocked by a newer change."));
      if(direction==="undo"){setUndoStack(current=>current.slice(0,-1));setRedoStack(current=>[...current,changeSetId])}else{setRedoStack(current=>current.slice(0,-1));setUndoStack(current=>[...current,changeSetId])}setMessage(result.message??tx("Roosterhistorie bijgewerkt.","Roster history updated."));router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:tx("Historieactie mislukt.","History action failed."))}finally{setBusy(false)}
  }
  async function templateMutate(action:"template_save"|"template_apply"){
    if(action==="template_save"&&(!selectedIds.length||templateName.trim().length<2))return;if(action==="template_apply"&&!templateId)return;
    setBusy(true);setMessage("");try{const values=action==="template_save"?{venueId,name:templateName,shiftIds:JSON.stringify(selectedIds)}:{venueId,templateId,startsAt:weekStart.toISOString(),repeatCount:String(templateRepeats),idempotencyKey:crypto.randomUUID()};const response=await fetch("/api/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,locale:locale==="nl"?"nl-NL":"en-US",action,values})});const result=await response.json() as {message?:string};if(!response.ok)throw new Error(tx("Templateactie kon niet worden opgeslagen.","Template action could not be saved."));setMessage(result.message??tx("Template opgeslagen.","Template saved."));setSelectedIds([]);setTemplateName("");router.refresh()}catch(error){setMessage(error instanceof Error?error.message:tx("Templateactie mislukt.","Template action failed."))}finally{setBusy(false)}
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
  const venuePatterns = servicePatterns.filter((row) => row.venue_id === venueId);
  const standardWeekReady = venuePatterns.some((row) => row.active);
  const standardMissing = days.reduce((sum, day) => {
    const pattern = venuePatterns.find((row) => row.iso_weekday === isoWeekday(day));
    if (!pattern?.active) return sum;
    return sum + pattern.lines.reduce((lineSum, line) => {
      const [startHour, startMinute] = line.start.split(":").map(Number);
      const present = weekShifts.filter((row) => row.role_id === line.role_id && new Date(row.starts_at).toDateString() === day.toDateString() && new Date(row.starts_at).getHours() === startHour && new Date(row.starts_at).getMinutes() === startMinute).length;
      return lineSum + Math.max(0, line.count - present);
    }, 0);
  }, 0);
  const coverage = days.map((day) => {
    const end = new Date(day.getTime() + dayMs);
    const forecast = activeLane === "staff" ? visibleIntervals
      .filter((row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end)
      .reduce((max, row) => Math.max(max, row.required_staff), 0) : 0;
    const required = Math.max(forecast, patternHeadcount(venuePatterns.find((row) => row.iso_weekday === isoWeekday(day)), laneOfRole, activeLane));
    const planned = visibleShifts.filter(
      (row) => row.staff_id && new Date(row.starts_at) >= day && new Date(row.starts_at) < end,
    ).length;
    return { required, planned };
  });

  const draftCount = weekShifts.filter((row) => row.status === "draft").length;
  const laneDraftCount = (kind: LaneKind) => weekShifts.filter((row) => row.status === "draft" && laneOfDepartment(row.department_id) === kind).length;
  const blockingCount = health.issues.filter((issue) => issue.severity === "blocking").length;
  const publishedCount = weekShifts.filter((row) => row.status === "published").length;
  const teamReady = allVenueDepartments.length > 0 && roles.length > 0 && activeStaff.length > 0;
  const weekState: "setup" | "empty" | "draft" | "published" = !teamReady ? "setup" : draftCount ? "draft" : publishedCount ? "published" : "empty";
  const weekStateLabel = { setup: tx("Team nog niet ingesteld", "Team not set up"), empty: tx("Nog leeg", "Empty"), draft: tx("Concept · niet zichtbaar voor team", "Draft · not visible to team"), published: tx("Gepubliceerd", "Published") }[weekState];
  const previousWeekStart = new Date(weekStart.getTime() - 7 * dayMs);
  const previousWeekCount = shifts.filter((row) => row.venue_id === venueId && row.status !== "cancelled" && new Date(row.starts_at) >= previousWeekStart && new Date(row.starts_at) < weekStart).length;
  const weekAvailability = staffAvailability.filter((row) => row.venue_id === venueId && new Date(row.starts_at) < weekEnd && new Date(row.ends_at) > weekStart);
  const availabilityOn = (staffId: string, day: Date) => {
    const end = new Date(day.getTime() + dayMs);
    const states = weekAvailability.filter((row) => row.staff_id === staffId && new Date(row.starts_at) < end && new Date(row.ends_at) > day).map((row) => row.availability);
    return states.includes("unavailable") ? "unavailable" : states.includes("preferably_not") ? "preferably_not" : states.includes("preferred") ? "preferred" : states.includes("available") ? "available" : null;
  };
  const availabilityLabel = (state: string) => ({ available: tx("Kan", "Available"), preferred: tx("Liefst", "Preferred"), preferably_not: tx("Liever niet", "Rather not"), unavailable: tx("Kan niet", "Unavailable") } as Record<string, string>)[state] ?? state;
  const shiftMinutes = (row: Shift) => Math.max(0, Math.floor((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000) - row.break_minutes);
  const dayTotals = days.map((day) => {
    const rows = visibleShifts.filter((row) => new Date(row.starts_at).toDateString() === day.toDateString());
    return { minutes: rows.reduce((sum, row) => sum + shiftMinutes(row), 0), cost: rows.reduce((sum, row) => sum + (BigInt(row.hourly_cost_minor) * BigInt(shiftMinutes(row)) + 30n) / 60n, 0n), open: rows.filter((row) => !row.staff_id).length, count: rows.length };
  });
  const staffInDepartment = (person: Staff, departmentId: string) => {
    if (person.id === "open") return true;
    const knownRole = roles.some((role) => role.name === person.role_name);
    return !knownRole || roles.some((role) => role.department_id === departmentId && role.name === person.role_name) || visibleShifts.some((row) => row.staff_id === person.id && row.department_id === departmentId);
  };
  const quietDays = days.map((day, index) => dayTotals[index].minutes === 0 && !dayTotals[index].open && !weekShifts.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()) && !venuePatterns.some((row) => row.active && row.iso_weekday === isoWeekday(day)) && !visibleIntervals.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()));
  const collapseQuiet = quietDays.some((quiet) => !quiet);
  const gridStyle = { gridTemplateColumns: `190px ${quietDays.map((quiet) => (collapseQuiet && quiet ? "64px" : "minmax(130px,1fr)")).join(" ")}`, minWidth: `${190 + quietDays.reduce((sum, quiet) => sum + (collapseQuiet && quiet ? 64 : 130), 0)}px` };
  const firstBusyDay = dayTotals.findIndex((total) => total.count > 0);
  const todayIndex = days.findIndex((day) => day.toDateString() === new Date(nowMs).toDateString());
  const mobileIndex = mobileDay ?? (todayIndex >= 0 && dayTotals[todayIndex].count ? todayIndex : firstBusyDay >= 0 ? firstBusyDay : Math.max(todayIndex, 0));
  const mobileShifts = visibleShifts.filter((shift) => new Date(shift.starts_at).toDateString() === days[mobileIndex].toDateString()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";
  const zonedTime = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { timeZone: venueTimezone, ...options });
  const laneStaff = activeStaff.filter((person) => venueDepartments.some((department) => staffInDepartment(person, department.id)) && (activeLane === "dj" ? roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj") : !roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj")));
  const laneLabel = (kind: LaneKind) => kind === "dj" ? tx("DJ's", "DJs") : tx("Personeel", "Staff");
  const shareRows = laneStaff.map((person) => {
    const rows = visibleShifts.filter((row) => row.staff_id === person.id && row.status === "published").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const minutes = rows.reduce((sum, row) => sum + shiftMinutes(row), 0);
    const lines = rows.map((row) => `• ${zonedTime(row.starts_at, { weekday: "short", day: "numeric", month: "short" })} ${zonedTime(row.starts_at, { hour: "2-digit", minute: "2-digit" })}–${zonedTime(row.ends_at, { hour: "2-digit", minute: "2-digit" })} · ${roles.find((role) => role.id === row.role_id)?.name ?? ""}`);
    const first = person.full_name.trim().split(/\s+/)[0];
    const text = person.preferred_language === "en"
      ? `Hi ${first}, your roster at ${venueName} for week ${isoWeek(weekStart)}:\n${lines.join("\n")}\n\nTotal ${Math.round(minutes / 6) / 10} hours. Something wrong or want to swap? Let me know.`
      : `Hoi ${first}, je rooster bij ${venueName} voor week ${isoWeek(weekStart)}:\n${lines.join("\n")}\n\nTotaal ${Math.round(minutes / 6) / 10} uur. Klopt er iets niet of wil je ruilen? Laat het weten.`;
    let phone: string | null = null;
    try { phone = person.contact_phone ? normalizeDutchPhone(person.contact_phone).replace(/^\+/, "") : null; } catch { phone = null; }
    return { person, rows, minutes, text, phone };
  }).filter((row) => row.rows.length);
  return (
    <div className="roster-product">
      <header className="planner-head">
        <div className="planner-title">
          <h2>{tx("Rooster", "Roster")}</h2>
          <p><span>{tx("Week","Week")} {isoWeek(weekStart)}</span><span className={`week-state ${weekState}`}>{weekStateLabel}</span>{teamReady?<span>{tx("Beschikbaarheid","Availability")} {laneStaff.filter((person) => weekAvailability.some((row) => row.staff_id === person.id)).length}/{laneStaff.length}{hasDjLane ? ` · ${laneLabel(activeLane)}` : ""}</span>:null}</p>
        </div>
        <div className="planner-head-actions">
          {teamReady||allVenueDepartments.length?<button type="button" onClick={() => setPanel("nights")}>{tx("Avonden", "Nights")}</button>:null}
          {teamReady?<button type="button" onClick={() => setPanel("availability")}>{hasDjLane&&activeLane==="dj"?tx("DJ's vragen", "Ask DJs"):tx("Beschikbaarheid opvragen", "Request availability")}</button>:null}
          {weekState==="setup"?<button type="button" className="primary" onClick={()=>setPanel("team")}>{tx("Team instellen","Set up team")}</button>
          :weekState==="empty"&&standardWeekReady&&standardMissing?<button type="button" className="primary" disabled={busy} onClick={()=>void applyStandardWeek()}>{tx(`Standaardweek invullen (${standardMissing})`,`Fill standard week (${standardMissing})`)}</button>
          :weekState==="empty"?(previousWeekCount?<button type="button" className="primary" disabled={busy} onClick={() => void mutate("copy_week", {venueId,startsAt:new Date(weekStart.getTime()-7*dayMs).toISOString(),endsAt:weekStart.toISOString(),idempotencyKey:crypto.randomUUID()})}>{tx(`Kopieer vorige week (${previousWeekCount})`,`Copy last week (${previousWeekCount})`)}</button>
            :visibleIntervals.length?<button type="button" className="primary" disabled={busy} onClick={()=>void mutate("proposal",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString()})}>{tx("Rooster voorstellen","Suggest roster")}</button>
            :<button type="button" className="primary" onClick={()=>{if(venueDepartments[0]){setNewShift({day:weekStart,departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}>{tx("Eerste dienst toevoegen","Add first shift")}</button>)
          :weekState==="draft"?(health.publishable
            ?<button type="button" className="primary publish" disabled={busy} onClick={() => setPanel("publish")}>{hasDjLane&&laneDraftCount("dj")&&laneDraftCount("staff")?tx(`Publiceren · ${laneDraftCount("staff")} personeel + ${laneDraftCount("dj")} DJ`,`Publish · ${laneDraftCount("staff")} staff + ${laneDraftCount("dj")} DJ`):tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>
            :<button type="button" className="primary blocked" onClick={() => setPanel("health")}>{tx(`${blockingCount} ${blockingCount===1?"blokkade":"blokkades"} vóór publiceren`,`${blockingCount} ${blockingCount===1?"blocker":"blockers"} before publishing`)}</button>)
          :<button type="button" className="primary" onClick={()=>setPanel("share")}>{tx("Delen via WhatsApp","Share via WhatsApp")}</button>}
        </div>
      </header>
      <nav className="planner-tabs" role="tablist" aria-label={tx("Planneronderdelen","Planner sections")}>
        {([["roster",tx("Rooster","Roster"),0],["actions",tx("Actie nodig","Action needed"),venueExceptions.length],["insights",tx("Inzicht","Insights"),health.issues.length],["hours",tx("Uren","Hours"),pendingRecords.length+timeCorrections.filter(row=>row.venue_id===venueId).length]] as const).map(([key,label,count])=><button type="button" role="tab" key={key} aria-selected={tab===key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{label}{count?<em>{count}</em>:null}</button>)}
      </nav>
      {tab==="roster"?<>
      <section className="roster-context" aria-label={tx("Roosterperiode", "Roster period")}>
        {venues.length > 1 ? <label>
          {tx("Vestiging", "Venue")}
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
            {venues.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label> : null}
        {hasDjLane?<div className="lane-switch" role="tablist" aria-label={tx("Planning","Planning")}>{(["staff","dj"] as const).map((kind)=><button type="button" role="tab" key={kind} aria-selected={activeLane===kind} className={activeLane===kind?"active":""} onClick={()=>{setLane(kind);setDepartmentFilter("");setSelectedIds([])}}>{laneLabel(kind)}{laneDraftCount(kind)?<em>{laneDraftCount(kind)}</em>:null}</button>)}</div>:null}
        {venueDepartments.length>1?<label>{tx("Afdeling", "Department")}<select value={departmentFilter} onChange={(event)=>setDepartmentFilter(event.target.value)}><option value="">{tx("Alle afdelingen", "All departments")}</option>{venueDepartments.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>:null}
        <label>{tx("Medewerker zoeken", "Search employee")}<input type="search" value={employeeSearch} onChange={(event)=>setEmployeeSearch(event.target.value)} placeholder={tx("Naam…", "Name…")}/></label>
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
        <button className="secondary" onClick={() => setWeekStart(monday(new Date()))}>{tx("Vandaag", "Today")}</button>
        <div className="planner-view-switch" role="group" aria-label={tx("Roosterweergave","Roster view")}>
          {(["week","day","month"] as const).map(option=><button type="button" key={option} className={view===option?"active":""} aria-pressed={view===option} onClick={()=>setView(option)}>{option==="week"?tx("Week","Week"):option==="day"?tx("Dag","Day"):tx("Maand","Month")}</button>)}
        </div>
        <details className="planner-more"><summary>{tx("Meer", "More")}</summary><div>
          <button type="button" disabled={busy} onClick={() => void mutate("copy_week", {venueId,startsAt:new Date(weekStart.getTime()-7*dayMs).toISOString(),endsAt:weekStart.toISOString(),idempotencyKey:crypto.randomUUID()})}>{tx("Vorige week kopiëren", "Copy previous week")}</button>
          <button type="button" onClick={() => setPanel("absence")}>{tx("Verlof en ziekte", "Leave and sickness")}</button>
          <button type="button" onClick={() => setPanel("scenario")}>{tx("Scenario testen", "Test scenario")}</button>
          <button type="button" onClick={() => setPanel("nights")}>{tx("Standaardweek en extra avonden", "Standard week and extra nights")}</button>
          <button type="button" onClick={() => setPanel("templates")}>{tx("Templates en herhaling", "Templates and recurrence")}</button>
          <button type="button" onClick={() => setPanel("share")}>{tx("Rooster delen via WhatsApp", "Share roster via WhatsApp")}</button>
          <button type="button" onClick={() => setPanel("team")}>{tx("Team en rollen", "Team and roles")}</button>
        </div></details>
      </section>
      {selectedIds.length||undoStack.length||redoStack.length?<>
      <section className="planner-edit-bar" aria-label={tx("Roosterbewerkingen","Roster editing actions")}>
        <span>{selectedIds.length?`${selectedIds.length} ${tx("geselecteerd","selected")}`:tx("Selecteer diensten voor bulkbewerking","Select shifts for bulk editing")}</span>
        <button type="button" disabled={busy||!undoStack.length} onClick={()=>void replayHistory("undo")}>↶ {tx("Ongedaan","Undo")}</button>
        <button type="button" disabled={busy||!redoStack.length} onClick={()=>void replayHistory("redo")}>↷ {tx("Opnieuw","Redo")}</button>
        <button type="button" disabled={busy||!selectedIds.length} onClick={()=>void bulkMutate("lock")}>{tx("Vergrendel","Lock")}</button>
        <button type="button" disabled={busy||!selectedIds.length} onClick={()=>void bulkMutate("unlock")}>{tx("Ontgrendel","Unlock")}</button>
        <select aria-label={tx("Geselecteerde diensten toewijzen","Assign selected shifts")} value="" disabled={busy||!selectedIds.length} onChange={event=>{if(event.target.value)void bulkMutate("assign",{staffId:event.target.value})}}><option value="">{tx("Toewijzen…","Assign…")}</option>{activeStaff.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select>
        <select aria-label={tx("Rol van geselecteerde diensten","Role for selected shifts")} value="" disabled={busy||!selectedIds.length} onChange={event=>{if(event.target.value)void bulkMutate("role",{roleId:event.target.value})}}><option value="">{tx("Rol wijzigen…","Change role…")}</option>{roles.filter(role=>venueDepartments.some(department=>department.id===role.department_id)).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select>
        <button type="button" className="danger" disabled={busy||!selectedIds.length} onClick={()=>void bulkMutate("cancel")}>{tx("Verwijder","Delete")}</button>
      </section>
      </>:null}
      <section className="planner-summary" aria-label={tx("Weekoverzicht", "Week summary")}>
        {activeLane==="dj"?<>
        <span><small>{tx("DJ's ingepland", "DJs booked")}</small><b>{coverage.reduce((sum,row)=>sum+row.planned,0)} / {coverage.reduce((sum,row)=>sum+row.required,0)}</b></span>
        <span><small>{tx("DJ-uren", "DJ hours")}</small><b>{Math.round(visibleShifts.reduce((sum,row)=>sum+shiftMinutes(row),0)/6)/10} u</b></span>
        <span><small>{tx("DJ-kosten", "DJ cost")}</small><b>{currency(visibleShifts.reduce((sum,row)=>sum+(BigInt(row.hourly_cost_minor)*BigInt(shiftMinutes(row))+30n)/60n,0n))}</b></span>
        </>:<>
        <span><small>{tx("Omzetprognose", "Revenue forecast")}</small><b>{visibleIntervals.length ? currency(revenue) : tx("Nog geen omzetprognose", "No revenue forecast yet")}</b></span>
        <span><small>{tx("Dekking", "Coverage")}</small><b>{standardWeekReady ? `${coverage.reduce((sum,row)=>sum+row.planned,0)} / ${coverage.reduce((sum,row)=>sum+row.required,0)}` : visibleIntervals.length ? `${coverageIntervals.reduce((sum,row)=>sum+row.plannedStaff,0)} / ${coverageIntervals.reduce((sum,row)=>sum+row.requiredStaff,0)}` : tx("Forecast ontbreekt", "Forecast missing")}</b></span>
        <span><small>{tx("Geplande uren", "Planned hours")}</small><b>{visibleShifts.length ? `${Math.round(visibleShifts.reduce((sum,row)=>sum+Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes),0)/6)/10} u` : tx("Nog geen diensten", "No shifts yet")}</b></span>
        <span><small>{hasDjLane?tx("Loonkosten incl. DJ", "Labor cost incl. DJ"):tx("Loonkosten", "Labor cost")}</small><b>{weekShifts.length ? currency(labor) : tx("Nog niet berekend", "Not calculated yet")}</b></span>
        <span><small>{tx("Loonpercentage", "Labor percentage")}</small><b>{visibleIntervals.length && weekShifts.length ? percent : "—"}</b></span>
        </>}
        <button type="button" className={health.publishable && visibleShifts.length ? "summary-ok" : "summary-warn"} onClick={() => setPanel("health")}>{health.issues.length ? `${health.issues.length} ${health.issues.length===1?tx("aandachtspunt","issue"):tx("aandachtspunten", "issues")}` : visibleShifts.length ? tx("Rooster in orde", "Roster clear") : tx("Rooster nog niet klaar", "Roster not ready")}</button>
      </section>
      </>:null}
      {tab==="actions"?<section className="workforce-inbox" aria-label={tx("Beslissingen voor manager","Manager decision inbox")}><header><div><span className="eyebrow">{tx("ACTIE NODIG","ACTION NEEDED")}</span><h3>{tx("Belangrijkste eerst","Most important first")}</h3></div><b>{venueExceptions.length}</b></header>{venueExceptions.length?venueExceptions.map(item=>{const shift=item.shift_id?shifts.find(row=>row.id===item.shift_id):undefined;const correction=item.exception_type==="time_correction"?timeCorrections.find(row=>row.id===item.source_id):undefined;const record=item.exception_type==="submitted_hours"?timeRecords.find(row=>row.id===item.source_id):undefined;const swap=item.exception_type==="swap_decision"?swaps.find(row=>row.id===item.source_id):undefined;return <article key={item.action_key} data-severity={item.severity}><div><strong>{exceptionLabel(item.exception_type)}</strong><span>{new Date(item.relevant_at).toLocaleString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · {item.severity}</span><small>{item.why_it_matters}</small><small>{item.recommended_action}</small><details><summary>{tx("Bewijs en oplosvoorwaarde","Evidence and resolution condition")}</summary><p>{item.resolution_condition}</p><code>{item.action_key} · {String(item.evidence.shift_revision??item.evidence.input_hash??item.evidence.time_record_id??item.source_id)}</code></details></div>{item.exception_type==="swap_decision"&&swap?<><button type="button" className="primary" disabled={busy||swap.state!=="candidate_accepted"} onClick={()=>void mutate("swap_decide",{venueId,swapId:swap.id,decision:"approved",reason:tx("Goedgekeurd na hercontrole van dekking en regels","Approved after coverage and rule revalidation")})}>{tx("Goedkeuren + opvolgversie","Approve + successor version")}</button><button type="button" disabled={busy} onClick={()=>void mutate("swap_decide",{venueId,swapId:swap.id,decision:"rejected",reason:tx("Afgewezen na managercontrole","Rejected after manager review")})}>{tx("Afwijzen","Reject")}</button></>:item.exception_type==="time_correction"&&correction?<button type="button" className="primary" disabled={busy} onClick={()=>void workforceMutate("decide_correction",{correctionId:correction.id,decision:"approved",reason:tx("Goedgekeurd na vergelijking met klokbewijs","Approved after comparing clock evidence")})}>{tx("Correctie goedkeuren","Approve correction")}</button>:item.exception_type==="submitted_hours"&&record?<button type="button" className="primary" disabled={busy} onClick={()=>void workforceMutate("approve_time",{timeRecordId:record.id,correctionReason:""})}>{tx("Uren goedkeuren","Approve hours")}</button>:shift?<button type="button" className="primary" onClick={()=>{setSelected(shift);setPanel("shift")}}>{tx("Open betrokken dienst","Open affected shift")}</button>:item.exception_type==="coverage_gap"?<button type="button" className="primary" onClick={()=>{if(venueDepartments[0]){setNewShift({day:new Date(item.relevant_at),departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}>{tx("Los interval op","Resolve interval")}</button>:item.exception_type==="stale_proposal"?<button type="button" className="primary" disabled={busy} onClick={()=>void mutate("proposal",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString()})}>{tx("Voorstellen vernieuwen","Regenerate proposals")}</button>:null}</article>}):<p className="quiet">{tx("Niets te doen. Ziekmeldingen, ruilverzoeken en uren om goed te keuren verschijnen hier.","Nothing to do. Sick reports, swap requests and hours to approve appear here.")}</p>}</section>:null}
      {tab==="insights"?<>
      <section className="roster-intelligence" aria-label={tx("Roosterkwaliteit en vraagdekking", "Roster health and demand coverage")}>
        <article className="roster-health">
          <header><div><span className="eyebrow">{tx("ROOSTERCHECK","ROSTER CHECK")}</span><h3>{health.publishable?tx("Geen blokkerende regels","No blocking rules"):tx("Actie vereist vóór publicatie","Action required before publishing")}</h3></div><b className={health.publishable?"health-ok":"health-blocked"}>{health.publishable?tx("Publiceerbaar","Publishable"):tx("Geblokkeerd","Blocked")}</b></header>
          <div className="health-dimensions">{health.dimensions.map(dimension=>{const issues=health.issues.filter(issue=>issue.dimension===dimension);return <button type="button" key={dimension} onClick={()=>{if(issues.some(issue=>issue.code==="UNCOVERED_INTERVALS")&&venueDepartments[0]){setNewShift({day:weekStart,departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}><span>{dimension}</span><strong>{issues.some(issue=>issue.severity==="blocking")?"!":issues.length?"△":"✓"}</strong><small>{issues.length?`${issues.reduce((sum,issue)=>sum+issue.count,0)} ${tx("punt(en)","issue(s)")}`:tx("in orde","clear")}</small></button>})}</div>
          {health.issues.length?<ul>{health.issues.slice(0,5).map(issue=><li key={issue.code}><b>{issueLabel(issue.code)}</b><span>{issue.count}</span></li>)}</ul>:<p>{tx("Alle meetbare dimensies zijn binnen de beschikbare evidence in orde.","All measurable dimensions are clear within the available evidence.")}</p>}
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
      <section className="learning-card" aria-label={tx("Leren van gesloten services","Closed-service workforce learning")}><header><div><span className="eyebrow">{tx("NA DE AVOND","AFTER SERVICE")}</span><h3>{tx("Gepland versus gewerkt","Planned versus worked")}</h3></div></header>{latestLearning?<>{latestLearning.evidence_state==="ready"?<p>{tx(`${String(latestLearning.result.worked_minutes??"—")} gewerkte versus ${String(latestLearning.result.planned_minutes??"—")} geplande minuten; vergeleken met ${latestLearning.comparable_count} gelijksoortige gesloten services.`,`${String(latestLearning.result.worked_minutes??"—")} worked versus ${String(latestLearning.result.planned_minutes??"—")} planned minutes; compared with ${latestLearning.comparable_count} similar locked services.`)}</p>:<p>{tx(`Nog niet genoeg vergelijkbare gesloten services (${latestLearning.comparable_count}/3).`,`Not enough comparable closed services yet (${latestLearning.comparable_count}/3).`)}</p>}<details><summary>{tx("Methode en bewijs","Method and evidence")}</summary><dl><div><dt>{tx("Versie","Version")}</dt><dd>{latestLearning.calculation_version}</dd></div><div><dt>{tx("Bewijshash","Evidence hash")}</dt><dd><code>{latestLearning.content_hash.slice(0,16)}</code></dd></div><div><dt>{tx("Vergelijkingsmethode","Comparison method")}</dt><dd>{tx("Zelfde locatie en weekdag; werkelijke omzet binnen ±30%; unieke gesloten servicedata.","Same venue and weekday; actual revenue within ±30%; unique locked service dates.")}</dd></div></dl></details></>:<p className="quiet">{tx("Nog geen vergrendelde service met goedgekeurde loongegevens beschikbaar.","No locked service with approved labour evidence is available yet.")}</p>}</section>
      </>:null}
      {tab==="hours"?<section className="staffing-command" aria-label={tx("Live bezetting en uren","Live staffing and hours")}><article><span className="eyebrow">{tx("LIVE BEZETTING","LIVE STAFFING")}</span><h3>{tx("Alleen actuele afwijkingen en beslissingen","Only current deviations and decisions")}</h3><div className="command-kpis"><div><b>{venueRecords.filter(record=>record.status==="open").length}</b><span>{tx("ingeklokt","clocked in")}</span></div><div><b>{pendingRecords.length}</b><span>{tx("uren te beoordelen","hours awaiting approval")}</span></div><div><b>{latestApprovedLabour?.worked_minutes??approvedMinutes}</b><span>{tx("goedgekeurde minuten","approved minutes")}</span></div><div><b>{latestApprovedLabour?currency(actualLabor):"—"}</b><span>{tx("werkelijke loonkosten","actual labor")}</span></div></div><small>{latestApprovedLabour?tx(`Goedgekeurd bewijs · ${latestApprovedLabour.content_hash.slice(0,12)}`,`Approved evidence · ${latestApprovedLabour.content_hash.slice(0,12)}`):tx("Loonkosten wachten op managergoedkeuring.","Labor cost awaits manager approval.")}</small><button type="button" onClick={()=>setPanel("missed")}>{tx("Gemiste registratie vastleggen","Record missed event")}</button></article><article><span className="eyebrow">{tx("URENCONTROLE","HOURS REVIEW")}</span><h3>{tx("Goedkeuren behoudt de oorspronkelijke tijdgebeurtenissen","Approval preserves original time events")}</h3>{timeCorrections.filter(correction=>correction.venue_id===venueId).map(correction=><div className="correction-decision" key={correction.id}><b>{tx("Correctieverzoek","Correction request")}</b><span>{correction.reason}</span><small>{JSON.stringify(correction.original_values)} → {JSON.stringify(correction.proposed_values)}</small><div><button type="button" className="primary" disabled={busy} onClick={()=>void workforceMutate("decide_correction",{correctionId:correction.id,decision:"approved",reason:tx("Goedgekeurd na vergelijking met planning en klokbewijs","Approved after comparing schedule and clock evidence")})}>{tx("Correctie goedkeuren","Approve correction")}</button><button type="button" disabled={busy} onClick={()=>void workforceMutate("decide_correction",{correctionId:correction.id,decision:"rejected",reason:tx("Afgewezen na beoordeling van klokbewijs","Rejected after clock-evidence review")})}>{tx("Afwijzen","Reject")}</button></div></div>)}{pendingRecords.length?<div className="hours-list">{pendingRecords.slice(0,8).map(record=>{const person=staff.find(row=>row.id===record.staff_id);const minutes=Math.max(0,Math.floor((new Date(record.clocked_out_at!).getTime()-new Date(record.clocked_in_at).getTime())/60000)-record.break_minutes);return <div key={record.id}><span><b>{person?.full_name}</b><small>{minutes} min · {record.break_minutes} min {tx("pauze","break")}</small></span><button type="button" className="primary" disabled={busy} onClick={()=>void workforceMutate("approve_time",{timeRecordId:record.id,correctionReason:""})}>{tx("Uren goedkeuren","Approve hours")}</button></div>})}</div>:<p className="quiet">{tx("Geen ingediende uren wachten op goedkeuring.","No submitted hours await approval.")}</p>}</article></section>:null}
      {message ? (
        <div className="roster-message" role="status">
          {message}
        </div>
      ) : null}
      {tab==="roster"?<>
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
                    {tx("automatisch ingevuld", "automatically filled")}
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
                  <p>{row.objective==="balanced"?tx("Verdeelt uren zo gelijk mogelijk binnen contracten en regels.","Distributes hours as evenly as possible within contracts and rules."):row.objective==="lowest_cost"?tx("Beperkt loonkosten en laat duurdere geldige opties alleen staan waar nodig.","Limits labor cost and uses higher-cost valid options only where needed."):tx("Geeft beschikbare voorkeursmomenten voorrang zonder harde regels te breken.","Prioritizes preferred available times without breaking hard rules.")}</p>
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
      {!venueDepartments.length || !roles.length || !activeStaff.length ? (
        <button className="guided-setup" onClick={() => setPanel("team")}>
          <b>{tx("Stel je team in", "Set up your team")}</b>
          <span>
            {tx(
              "Voeg afdelingen, rollen en medewerkers toe om je eerste rooster te maken.",
              "Add departments, roles and employees to create your first roster.",
            )}
          </span>
          <small>{tx("1 Afdelingen · 2 Rollen · 3 Medewerkers · 4 Openingstijden · 5 Beschikbaarheid", "1 Departments · 2 Roles · 3 Employees · 4 Opening hours · 5 Availability")}</small>
          <em>→</em>
        </button>
      ) : null}
      <section className="mobile-day-roster" aria-label={tx("Mobiel dagrooster", "Mobile day roster")}>
        <div className="mobile-day-chips" role="tablist">{days.map((day,index)=><button type="button" role="tab" aria-selected={index===mobileIndex} className={index===mobileIndex?"active":""} key={day.toISOString()} onClick={()=>setMobileDay(index)}><small>{day.toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short"})}</small><b>{day.getDate()}</b><em>{dayTotals[index].count||""}</em></button>)}</div>
        <div className="mobile-coverage"><span>{days[mobileIndex].toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{weekday:"long",day:"numeric",month:"short"})}</span><b>{coverage[mobileIndex]?.planned ?? 0} / {coverage[mobileIndex]?.required ?? 0} {tx("bezet","filled")}</b></div>
        {mobileShifts.length ? mobileShifts.map(shift=><button type="button" className="mobile-shift-card" key={shift.id} onClick={()=>{setSelected(shift);setPanel("shift")}}><span><b>{staff.find(person=>person.id===shift.staff_id)?.full_name??tx("Open dienst","Open shift")}</b><small>{roles.find(role=>role.id===shift.role_id)?.name??tx("Dienst","Shift")}{shift.status==="draft"?tx(" · concept"," · draft"):""}</small></span><strong>{new Date(shift.starts_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}–{new Date(shift.ends_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}</strong></button>) : <div className="mobile-empty"><b>{tx("Geen diensten op deze dag", "No shifts this day")}</b><span>{tx("Kies een andere dag of voeg een dienst toe.", "Pick another day or add a shift.")}</span></div>}
      </section>
      {view==="day"?<section className="day-planner" aria-label={tx("Dagrooster op servicetijdlijn","Day roster on service timeline")}><header><div><span className="eyebrow">{tx("DAGWEERGAVE","DAY VIEW")}</span><h3>{weekStart.toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{weekday:"long",day:"numeric",month:"long"})}</h3></div><small>{tx("Service-uren · vraag, pauzes en bezetting","Service hours · demand, breaks and staffing")}</small></header><div className="service-timeline">{Array.from({length:16},(_,index)=>index+12).map(hour=><div className="timeline-hour" key={hour}><b>{String(hour%24).padStart(2,"0")}:00</b><div>{visibleIntervals.filter(interval=>new Date(interval.starts_at).getHours()===hour%24).map(interval=><span className="demand-marker" key={interval.id}>{tx("nodig","required")} {interval.required_staff}</span>)}{visibleShifts.filter(shift=>new Date(shift.starts_at).toDateString()===weekStart.toDateString()&&new Date(shift.starts_at).getHours()===hour%24).map(shift=><button type="button" key={shift.id} className="timeline-shift" onClick={()=>{setSelected(shift);setPanel("shift")}}><b>{staff.find(person=>person.id===shift.staff_id)?.full_name??tx("Open dienst","Open shift")}</b><span>{new Date(shift.starts_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}–{new Date(shift.ends_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}</span>{visibleBreakPlans.some(plan=>plan.shift_id===shift.id)?<small>{tx("Pauze gepland","Break planned")}</small>:null}</button>)}</div></div>)}</div></section>:null}
      {view==="month"?<section className="month-planner" aria-label={tx("Beknopt maandrooster","Concise monthly roster")}><header><div><span className="eyebrow">{tx("MAANDWEERGAVE","MONTH VIEW")}</span><h3>{weekStart.toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{month:"long",year:"numeric"})}</h3></div></header><div className="month-grid">{Array.from({length:35},(_,index)=>{const first=new Date(weekStart.getFullYear(),weekStart.getMonth(),1);const gridStart=monday(first);const day=new Date(gridStart.getTime()+index*dayMs);const rows=shifts.filter(shift=>shift.venue_id===venueId&&shift.status!=="cancelled"&&new Date(shift.starts_at).toDateString()===day.toDateString());const requirement=intervals.filter(interval=>interval.venue_id===venueId&&new Date(interval.starts_at).toDateString()===day.toDateString()).reduce((max,row)=>Math.max(max,row.required_staff),0);return <button type="button" className={day.getMonth()===weekStart.getMonth()?"":"outside"} key={day.toISOString()} onClick={()=>{setWeekStart(day);setView("day")}}><b>{day.getDate()}</b><span>{rows.length} {tx("diensten","shifts")}</span>{requirement?<small>{tx("piek nodig","peak required")} {requirement}</small>:<small>{tx("geen vraagbewijs","no demand evidence")}</small>}</button>})}</div></section>:null}
      {view==="week"?<section
        className="roster-board"
        aria-label={tx("Visueel weekrooster", "Visual weekly roster")}
      >
        <div className="roster-grid roster-head" style={gridStyle}>
          <div className="employee-heading">{tx("Medewerker", "Employee")}</div>
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className={`${coverage[index].planned < coverage[index].required ? "coverage-gap" : ""} ${collapseQuiet && quietDays[index] ? "quiet" : ""}`}
            >
              <b>
                {day.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "short" })}
              </b>
              <span>{day.getDate()}</span>
              <small>
                {coverage[index].planned}/{coverage[index].required} {tx("bezet", "staffed")}
              </small>
              {activeLane==="dj"?null:coverageIntervals.filter(interval=>interval.gap>0&&new Date(interval.startsAt).toDateString()===day.toDateString()).map(interval=><button type="button" className="interval-gap" key={interval.id} onClick={()=>{if(venueDepartments[0]){setNewShift({day:new Date(interval.startsAt),departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}><span aria-hidden="true">!</span>{new Date(interval.startsAt).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})} · {interval.gap} {tx("tekort","missing")}</button>)}
            </div>
          ))}
        </div>
        {displayedDepartments.map((department) => (
          <div className="department-group" key={department.id}>
            <h3>{department.name}</h3>
            {[
              ...displayedStaff.filter((person) => staffInDepartment(person, department.id)),
              {
                id: "open",
                full_name: tx("Open diensten", "Open shifts"),
                role_name: "",
                onboarding_status: "cleared",
              },
            ].map((person) => (
              <div className="roster-grid roster-row" style={gridStyle} key={`${department.id}-${person.id}`}>
                <div className="employee-cell">
                  <span className="avatar">
                    {person.id === "open" ? "+" : person.full_name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <b>{person.full_name}</b>
                    <small>{person.role_name}</small>
                    {person.id!=="open"?<small>{Math.round(visibleShifts.filter(shift=>shift.staff_id===person.id).reduce((sum,shift)=>sum+Math.max(0,(new Date(shift.ends_at).getTime()-new Date(shift.starts_at).getTime())/60000-shift.break_minutes),0)/60*10)/10}h / {person.contracted_minutes_week==null?"—":`${Math.round(person.contracted_minutes_week/6)/10}h`}</small>:null}
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
                  const quietIndex = days.findIndex((value) => value.getTime() === day.getTime());
                  return (
                    <div
                      className={`shift-cell ${collapseQuiet && quietDays[quietIndex] ? "quiet" : ""} ${dayAbsence ? "unavailable" : ""} ${person.id !== "open" && !dayAbsence ? `avail-${availabilityOn(person.id, day) ?? "unknown"}` : ""}`}
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
                      ) : person.id !== "open" && availabilityOn(person.id, day) && availabilityOn(person.id, day) !== "available" ? (
                        <span className={`avail-chip ${availabilityOn(person.id, day)}`}>{availabilityLabel(availabilityOn(person.id, day)!)}</span>
                      ) : null}
                      {cell.map((row) => (
                        <button
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData("text/shift-id", row.id)
                          }
                          onClick={(event) => {
                            if(event.metaKey||event.ctrlKey||selectedIds.length){setSelectedIds(current=>current.includes(row.id)?current.filter(id=>id!==row.id):[...current,row.id]);return}
                            setSelected(row);setPanel("shift");
                          }}
                          className={`shift-card ${row.status} ${selectedIds.includes(row.id)?"selected":""} ${row.locked?"locked":""}`}
                          aria-pressed={selectedIds.includes(row.id)}
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
                            {row.locked?` · ${tx("vergrendeld","locked")}`:""}
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
        <div className="roster-grid roster-foot" style={gridStyle}>
          <div className="employee-cell"><b>{tx("Totaal", "Total")}</b><small className="avail-legend"><i className="avail-available" />{tx("kan", "available")} <i className="avail-unavailable" />{tx("kan niet", "unavailable")} <i className="avail-unknown" />{tx("onbekend", "unknown")}</small></div>
          {dayTotals.map((total, index) => <div className={collapseQuiet && quietDays[index] ? "quiet" : ""} key={days[index].toISOString()}><b>{Math.round(total.minutes / 6) / 10} {tx("uur", "h")}</b><small>{currency(total.cost)}{total.open ? ` · ${total.open} ${tx("open", "open")}` : ""}</small></div>)}
        </div>
      </section>:null}
      </>:null}
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
            {panel === "publish" ? (
              <section className="context-detail publication-review">
                <span className="eyebrow">{tx("PUBLICATIECONTROLE", "PUBLICATION REVIEW")}</span>
                <h3>{tx("Rooster publiceren", "Publish roster")}</h3>
                <dl>
                  <div><dt>{tx("Medewerkers met nieuwe of gewijzigde diensten", "Employees with new or changed shifts")}</dt><dd>{new Set(weekShifts.filter(row=>row.status==="draft"&&row.staff_id).map(row=>row.staff_id)).size}</dd></div>
                  <div><dt>{tx("Open diensten", "Open shifts")}</dt><dd>{weekShifts.filter(row=>!row.staff_id).length}</dd></div>
                  {hasDjLane?<div><dt>{tx("Concept per planning","Drafts per lane")}</dt><dd>{laneDraftCount("staff")} {tx("personeel","staff")} · {laneDraftCount("dj")} DJ</dd></div>:null}
                  <div><dt>{tx("Waarschuwingen", "Warnings")}</dt><dd>{health.issues.filter(issue=>issue.severity!=="blocking").length}</dd></div>
                  {weekShifts.some(row=>!row.staff_id&&row.status==="draft")?<div><dt>{tx("Na publicatie", "After publishing")}</dt><dd>{tx("Open diensten worden vacatures. Open de dienst en kies ‘Aanbieden aan team’.", "Open shifts become vacancies. Open the shift and choose ‘Offer to team’.")}</dd></div>:null}
                  <div><dt>{tx("Geplande uren", "Planned hours")}</dt><dd>{Math.round(weekShifts.reduce((sum,row)=>sum+Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes),0)/6)/10} u</dd></div>
                  <div><dt>{tx("Geplande loonkosten", "Planned labor cost")}</dt><dd>{currency(labor)}</dd></div>
                  <div><dt>{tx("Meldingen", "Notifications")}</dt><dd>{tx("Worden klaargezet; aflevering vereist providerbevestiging", "Will be queued; delivery requires provider confirmation")}</dd></div>
                </dl>
                {health.issues.some(issue=>issue.severity==="warning")?<ul className="publish-warnings">{health.issues.filter(issue=>issue.severity==="warning").map(issue=><li key={issue.code}><b>{issueLabel(issue.code)}</b> <span>{issue.count}</span></li>)}</ul>:null}
                <button type="button" className="primary publish" disabled={busy} onClick={()=>void mutate("publish",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString(),expectedRevision:String(Math.max(...weekShifts.filter(row=>row.status==="draft").map(row=>row.revision??1))),idempotencyKey:crypto.randomUUID()},()=>setPanel("share"))}>{tx("Controle bevestigd en publiceren", "Confirm review and publish")}</button>
              </section>
            ) : panel === "nights" ? (
              <ServiceNightsPanel
                organisationId={organisationId}
                venueId={venueId}
                weekStart={weekStart}
                roles={roles.filter((role) => allVenueDepartments.some((department) => department.id === role.department_id)).map((role) => ({ id: role.id, name: role.name, department_id: role.department_id, hourly_cost_minor: role.hourly_cost_minor, lane: laneOfRole(role.id) }))}
                patterns={servicePatterns}
                dayCounts={days.map((day) => ({ date: day, staff: staffShifts.filter((row) => new Date(row.starts_at).toDateString() === day.toDateString()).length, dj: weekShifts.filter((row) => laneOfDepartment(row.department_id) === "dj" && new Date(row.starts_at).toDateString() === day.toDateString()).length }))}
                hasDjLane={hasDjLane}
                locale={locale === "nl" ? "nl" : "en"}
                onSaved={(text) => { setMessage(text); setPanel(null); router.refresh(); }}
              />
            ) : panel === "templates" ? (
              <section className="context-detail"><span className="eyebrow">{tx("TEMPLATES","TEMPLATES")}</span><h3>{tx("Vaste weken hergebruiken","Reuse standard weeks")}</h3><p>{tx("Selecteer diensten in het rooster (Ctrl/Cmd + klik) om ze als template op te slaan, of pas een template toe op deze week.","Select shifts in the roster (Ctrl/Cmd + click) to save them as a template, or apply a template to this week.")}</p>
      <section className="planner-template-bar in-panel" aria-label={tx("Roostertemplates en herhaling","Roster templates and recurrence")}>
        <label>{tx("Naam template","Template name")}<input value={templateName} maxLength={100} onChange={event=>setTemplateName(event.target.value)} placeholder={tx("Bijv. reguliere clubnacht","E.g. regular club night")}/></label>
        <button type="button" disabled={busy||!selectedIds.length||templateName.trim().length<2} onClick={()=>void templateMutate("template_save")}>{tx("Selectie als template","Save selection as template")}</button>
        <label>{tx("Bestaande template","Existing template")}<select value={templateId} onChange={event=>setTemplateId(event.target.value)}><option value="">{tx("Kies template…","Choose template…")}</option>{rosterTemplates.filter(template=>template.venue_id===venueId).map(template=><option value={template.id} key={template.id}>{template.name} · {template.shift_pattern.length} {tx("diensten","shifts")}</option>)}</select></label>
        <label>{tx("Aantal weken","Number of weeks")}<input type="number" min="1" max="52" value={templateRepeats} onChange={event=>setTemplateRepeats(Math.max(1,Math.min(52,Number(event.target.value)||1)))}/></label>
        <button type="button" className="primary" disabled={busy||!templateId} onClick={()=>void templateMutate("template_apply")}>{templateRepeats>1?tx("Terugkerende diensten maken","Create recurring shifts"):tx("Template toepassen","Apply template")}</button>
      </section>
              </section>
            ) : panel === "share" ? (
              <section className="context-detail share-roster"><span className="eyebrow">{tx("ROOSTER DELEN","SHARE ROSTER")}</span><h3>{tx("Stuur iedereen zijn diensten","Send everyone their shifts")}</h3><p>{tx("Eén tik per medewerker opent WhatsApp met zijn eigen diensten van deze week. Alleen gepubliceerde diensten.","One tap per employee opens WhatsApp with their own shifts for this week. Published shifts only.")}</p>
                {shareRows.length?<ul>{shareRows.map(({person,rows,text,phone,minutes})=><li key={person.id}><div><b>{person.full_name}</b><small>{rows.length} {rows.length===1?tx("dienst","shift"):tx("diensten","shifts")} · {Math.round(minutes/6)/10} {tx("uur","h")}</small></div><div className="share-actions">{phone?<a className="primary" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>:<small>{tx("Geen geldig 06-nummer","No valid mobile number")}</small>}<button type="button" onClick={()=>{void navigator.clipboard.writeText(text);setMessage(tx(`Bericht voor ${person.full_name} gekopieerd.`,`Message for ${person.full_name} copied.`))}}>{tx("Kopieer","Copy")}</button></div></li>)}</ul>:<p className="quiet">{tx("Nog geen gepubliceerde diensten deze week.","No published shifts this week yet.")}</p>}
              </section>
            ) : panel === "health" ? (
              <section className="context-detail"><span className="eyebrow">{tx("ROOSTERSTATUS", "ROSTER STATUS")}</span><h3>{health.issues.length ? tx("Aandacht nodig", "Needs attention") : tx("Rooster in orde", "Roster clear")}</h3>{health.issues.length?<ul>{health.issues.map(issue=><li key={issue.code}><b>{({coverage:tx("Dekking","Coverage"),compliance:tx("Regels","Rules"),availability:tx("Beschikbaarheid","Availability"),skills:tx("Rollen en vaardigheden","Roles and skills"),budget:tx("Budget","Budget"),hours:tx("Uren","Hours"),preference:tx("Voorkeuren","Preferences"),breaks:tx("Pauzes","Breaks"),evidence:tx("Ontbrekende informatie","Missing information")}[issue.dimension]??issue.dimension)}</b><span>{issue.count} · {issue.severity=== "blocking"?tx("blokkeert publicatie","blocks publication"):tx("controleren","review")}</span><small>{issueLabel(issue.code)}</small></li>)}</ul>:<p>{tx("Er zijn geen bekende blokkades voor deze week.","There are no known blockers for this week.")}</p>}</section>
            ) : panel === "scenario" ? (
              <section className="context-detail"><span className="eyebrow">{tx("SCENARIO TESTEN", "TEST SCENARIO")}</span><h3>{tx("Wat verandert er bij andere drukte?", "What changes with different demand?")}</h3><div className="scenario-buttons">{[-2000,-1000,0,1000,2000].map(value=><button type="button" className={scenarioBasisPoints===value?"active":""} key={value} onClick={()=>{setScenarioBasisPoints(value);if(value)void mutate("scenario",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString(),demandChangeBasisPoints:String(value),idempotencyKey:crypto.randomUUID()})}}>{value===0?tx("Basis","Baseline"):`${value>0?"+":""}${value/100}%`}</button>)}</div><dl><div><dt>{tx("Benodigde medewerkers","Required staff")}</dt><dd>{(scenario??coverageIntervals).reduce((sum,row)=>sum+row.requiredStaff,0)}</dd></div><div><dt>{tx("Dekkingsgaten","Coverage gaps")}</dt><dd>{(scenario??coverageIntervals).reduce((sum,row)=>sum+row.gap,0)}</dd></div><div><dt>{tx("Geplande loonkosten","Planned labor cost")}</dt><dd>{visibleShifts.length?currency(labor):"—"}</dd></div></dl></section>
            ) : panel === "availability" ? (
              <AvailabilityManager
                organisationId={organisationId}
                venueTimezone={venueTimezone}
                venues={venues
                  .filter((row) => row.id === venueId)
                  .map((row) => ({ id: row.id, label: row.name }))}
                staff={laneStaff.map((row) => ({
                  id: row.id,
                  label: `${row.full_name} · ${row.role_name}`,
                  phoneState: phoneState(row.contact_phone),
                  preferredLanguage: row.preferred_language === "en" ? "en" : "nl",
                }))}
              />
            ) : panel === "shift" && selected && selectedReplacementException && selectedReplacementPlan ? (
              <ReplacementPanel
                row={selected}
                exception={selectedReplacementException}
                plan={selectedReplacementPlan}
                locale={locale}
                busy={busy}
                currency={currency}
                submit={(reason)=>void mutate("split_replace",{venueId:selected.venue_id,shiftId:selected.id,absenceId:selectedReplacementException.source_id,expectedRevision:String(selected.revision??1),segments:JSON.stringify(selectedReplacementPlan.segments.map(({staff_id,starts_at,ends_at,break_minutes})=>({staff_id,starts_at,ends_at,break_minutes}))),reason,idempotencyKey:crypto.randomUUID()},()=>{setPanel(null);router.refresh()})}
                offerOpenShift={()=>{const latestClose=Math.max(Date.now()+5*60_000,new Date(selected.starts_at).getTime()-15*60_000);void mutate("open_shift_offer",{venueId:selected.venue_id,shiftId:selected.id,closesAt:new Date(latestClose).toISOString(),idempotencyKey:crypto.randomUUID()})}}
              />
            ) : panel === "shift" && selected ? (
              <ShiftEditor
                row={selected}
                breakPlan={visibleBreakPlans.find(plan=>plan.shift_id===selected.id)}
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
                planBreak={(values)=>{values.startsAt=toUtc(values.breakStartsAt);values.endsAt=toUtc(values.breakEndsAt);void mutate("break_plan",{venueId:selected.venue_id,shiftId:selected.id,startsAt:values.startsAt,endsAt:values.endsAt},()=>router.refresh())}}
                duplicate={() => void mutate("shift_duplicate",{venueId:selected.venue_id,shiftId:selected.id,idempotencyKey:crypto.randomUUID()},()=>router.refresh())}
                toggleLock={() => void mutate("shift_lock",{venueId:selected.venue_id,shiftId:selected.id,locked:String(!selected.locked),expectedRevision:String(selected.revision??1)},()=>{setShifts(current=>current.map(item=>item.id===selected.id?{...selected,locked:!selected.locked,revision:(selected.revision??1)+1}:item));setSelected(current=>current?{...current,locked:!current.locked,revision:(current.revision??1)+1}:current)})}
                offerOpenShift={()=>{const latestClose=Math.max(Date.now()+5*60_000,new Date(selected.starts_at).getTime()-15*60_000);void mutate("open_shift_offer",{venueId:selected.venue_id,shiftId:selected.id,closesAt:new Date(latestClose).toISOString(),idempotencyKey:crypto.randomUUID()},()=>router.refresh())}}
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
                  plannerUserIds={plannerUserIds}
                  canManageMembers={canManageMembers}
                  departments={allVenueDepartments}
                  roles={roles}
                  staff={activeStaff}
                  busy={busy}
                  mutate={mutate}
                  tx={tx}
                />
                <EmployeeCsvImport organisationId={organisationId} venueId={venueId} />
              </>
            ) : panel==="missed"?(
              <MissedTimePanel venueId={venueId} staff={activeStaff} shifts={weekShifts} busy={busy} save={(values)=>{values.clockedInAt=toUtc(values.clockedInAt);values.clockedOutAt=toUtc(values.clockedOutAt);void workforceMutate("record_missed_event",values);setPanel(null)}} tx={tx}/>
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

function ReplacementPanel({row,exception,plan,locale,busy,currency,submit,offerOpenShift}:{
  row:Shift;
  exception:WorkforceException;
  plan:ReturnType<typeof planReplacementSegments>;
  locale:string;
  busy:boolean;
  currency:(minor:bigint)=>string;
  submit:(reason:string)=>void;
  offerOpenShift:()=>void;
}){
  const tx=(nl:string,en:string)=>(locale==="nl"?nl:en);
  const originalMinutes=Math.max(0,Math.floor((new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60_000)-row.break_minutes);
  const originalCost=(BigInt(row.hourly_cost_minor)*BigInt(originalMinutes)+30n)/60n;
  const date=(value:string)=>new Date(value).toLocaleString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  return <div className="replacement-panel">
    <span className="eyebrow">{tx("GECONTROLEERDE VERVANGING","GOVERNED REPLACEMENT")}</span>
    <h3>{tx("Herstel gepubliceerde dekking","Restore published coverage")}</h3>
    <p>{exception.why_it_matters}</p>
    <dl><div><dt>{tx("Oorspronkelijke dienst","Original shift")}</dt><dd>{date(row.starts_at)} – {date(row.ends_at)}</dd></div><div><dt>{tx("Bewijs","Evidence")}</dt><dd><code>{exception.action_key}</code></dd></div></dl>
    {plan.complete?<>
      <div className="replacement-segments" role="list" aria-label={tx("Voorgestelde vervangingssegmenten","Proposed replacement segments")}>
        {plan.segments.map((segment,index)=><article key={`${segment.staff_id}-${segment.starts_at}`} role="listitem"><b>{index+1}. {segment.staff_name}</b><span>{date(segment.starts_at)} – {date(segment.ends_at)}</span><small>{segment.break_minutes}m {tx("pauze","break")} · {currency(BigInt(segment.hourly_cost_minor))}/{tx("uur","hour")}</small></article>)}
      </div>
      <p className="replacement-cost"><span>{tx("Gepland kosteneffect","Planned cost effect")}</span><strong>{plan.plannedCostMinor-originalCost>=0n?"+":""}{currency(plan.plannedCostMinor-originalCost)}</strong></p>
      <form onSubmit={event=>{event.preventDefault();submit(String(new FormData(event.currentTarget).get("reason")??""))}}>
        <label>{tx("Reden voor opvolgversie","Reason for successor version")}<textarea name="reason" required minLength={5} maxLength={1000} defaultValue={tx("Vervanging na gevalideerde afwezigheid","Replacement after validated absence")}/></label>
        <button className="primary" disabled={busy}>{tx("Valideer en publiceer opvolgversie","Validate and publish successor version")}</button>
      </form>
      <small>{tx("De server controleert kwalificatie, beschikbaarheid, rust, overlap en maximumuren opnieuw. De bestaande publicatie blijft in de auditgeschiedenis.","The server rechecks qualification, availability, rest, overlap and maximum hours. The existing publication remains in the audit history.")}</small>
    </>:<div className="empty-state"><strong>{tx("Geen volledige geldige directe vervanging gevonden.","No complete valid direct replacement found.")}</strong><p>{plan.uncoveredFrom?`${tx("Onbezet vanaf","Uncovered from")} ${date(plan.uncoveredFrom)}.`:""} {tx("Bied de dienst alleen aan medewerkers aan die server-side geschikt zijn.","Offer the shift only to employees who are eligible server-side.")}</p><button type="button" className="primary" disabled={busy} onClick={offerOpenShift}>{tx("Start gecontroleerde open dienst","Start governed open shift")}</button></div>}
  </div>;
}

function ShiftEditor({
  row,
  breakPlan,
  departments,
  roles,
  staff,
  locale,
  busy,
  toLocal,
  save,
  resize,
  planBreak,
  duplicate,
  toggleLock,
  cancel,
  offerOpenShift,
}: {
  row: Shift;
  breakPlan?: BreakPlan;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  locale: string;
  busy: boolean;
  toLocal: (value: string) => string;
  save: (values: Record<string, string>) => void;
  resize: (minutes: number) => void;
  planBreak: (values: Record<string, string>) => void;
  duplicate: () => void;
  toggleLock: () => void;
  cancel: () => void;
  offerOpenShift: () => void;
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [openedAt] = useState(() => Date.now());
  const published = row.status === "published";
  const offerable = row.status === "published" && !row.staff_id && new Date(row.starts_at).getTime() > openedAt + 20 * 60_000;
  const breakDuration=Math.max(1,row.break_minutes||30),shiftStart=new Date(row.starts_at).getTime(),shiftEnd=new Date(row.ends_at).getTime();
  const defaultBreakStart=breakPlan?new Date(breakPlan.starts_at):new Date(shiftStart+Math.max(0,Math.floor((shiftEnd-shiftStart-breakDuration*60000)/2))),defaultBreakEnd=breakPlan?new Date(breakPlan.ends_at):new Date(defaultBreakStart.getTime()+breakDuration*60000);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>);
      }}
    >
      <h3>{published ? tx("Gepubliceerde dienst", "Published shift") : tx("Dienst bewerken", "Edit shift")}</h3>
      {published && !offerable ? <p className="published-note">{tx("Dit rooster is al bij je team. Direct wijzigen kan niet meer: bij ziekte of verlof vervang je via \u2018Actie nodig\u2019, medewerkers kunnen onderling ruilen, en een open dienst bied je aan.", "This roster is already with your team. It can't be edited directly: replace via \u2018Action needed\u2019 for sickness or leave, employees can swap, and open shifts can be offered.")}</p> : null}
      {offerable ? (
        <section className="context-detail">
          <span className="eyebrow">{tx("OPEN DIENST", "OPEN SHIFT")}</span>
          <p>{tx("Deze dienst is gepubliceerd zonder medewerker. Bied hem aan: alleen wie beschikbaar, gekwalificeerd en uitgerust is ziet hem, en de eerste claim krijgt de dienst.", "This shift is published without an employee. Offer it: only people who are available, qualified and rested see it, and the first claim gets the shift.")}</p>
          <button type="button" className="primary" disabled={busy} onClick={offerOpenShift}>{tx("Aanbieden aan team", "Offer to team")}</button>
        </section>
      ) : null}
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
      <fieldset>
        <legend>{tx("Gepland pauzevenster","Planned break window")}</legend>
        {breakPlan?<small>{tx("Opgeslagen","Saved")} · {tx(breakPlan.status,breakPlan.status)}</small>:null}
        <label>{tx("Pauze start","Break starts")}<input name="breakStartsAt" type="datetime-local" defaultValue={toLocal(defaultBreakStart.toISOString())}/></label>
        <label>{tx("Pauze einde","Break ends")}<input name="breakEndsAt" type="datetime-local" defaultValue={toLocal(defaultBreakEnd.toISOString())}/></label>
        <button type="button" disabled={busy||row.locked||row.break_minutes<=0} onClick={(event)=>{const form=event.currentTarget.form;if(form)planBreak(Object.fromEntries(new FormData(form)) as Record<string,string>)}}>{tx("Pauzevenster opslaan","Save break window")}</button>
        {row.break_minutes<=0?<small>{tx("Stel eerst pauzeminuten in en sla de dienst op.","Set break minutes and save the shift first.")}</small>:null}
      </fieldset>
      <div className="resize-actions">
        <button type="button" disabled={busy||row.locked||published} onClick={() => resize(-30)}>
          −30m
        </button>
        <button type="button" disabled={busy||row.locked||published} onClick={() => resize(30)}>
          +30m
        </button>
      </div>
      <div className="resize-actions"><button type="button" disabled={busy} onClick={duplicate}>{tx("Dupliceer als open dienst","Duplicate as open shift")}</button><button type="button" disabled={busy} onClick={toggleLock}>{row.locked?tx("Ontgrendel","Unlock"):tx("Vergrendel","Lock")}</button></div>
      {!published ? <>
      <button className="primary" disabled={busy||row.locked}>
        {tx("Opslaan", "Save")}
      </button>
      <button className="danger" type="button" disabled={busy} onClick={cancel}>
        {tx("Dienst verwijderen", "Delete shift")}
      </button>
      </> : null}
    </form>
  );
}

function TeamSetup({
  organisationId,
  venueId,
  plannerUserIds,
  canManageMembers,
  departments,
  roles,
  staff,
  busy,
  mutate,
  tx,
}: {
  organisationId: string;
  venueId: string;
  plannerUserIds: string[];
  canManageMembers: boolean;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  busy: boolean;
  mutate: (action: string, values: Record<string, string>) => Promise<{message?:string;errorCode?:string;invitation?:{id:string;link:string;message:string;whatsappUrl:string;deliveryState:string;providerConnected:boolean}}|undefined>;
  tx: (nl: string, en: string) => string;
}) {
  const [invitation,setInvitation]=useState<{id:string;link:string;message:string;whatsappUrl:string;deliveryState:string;providerConnected:boolean}|null>(null);
  const [staffDepartment,setStaffDepartment]=useState(departments[0]?.id??"");
  const [plannerBusy,setPlannerBusy]=useState("");
  const [plannerNote,setPlannerNote]=useState("");
  const router=useRouter();
  async function setPlanner(person:Staff,enabled:boolean){
    setPlannerBusy(person.id);setPlannerNote("");
    try{
      const response=await fetch("/api/planning/nights",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,action:"planner_access",values:{staffId:person.id,enabled:String(enabled)}})});
      const result=await response.json() as {message?:string;errorCode?:string};
      if(!response.ok)throw new Error(result.errorCode==="STAFF_HAS_NO_ACCOUNT"?tx(`${person.full_name} heeft nog geen account. Laat de uitnodiging eerst accepteren.`,`${person.full_name} has no account yet. Have them accept the invitation first.`):result.errorCode==="FORBIDDEN"?tx("Alleen eigenaar of beheerder kan planners aanwijzen.","Only an owner or administrator can assign planners."):tx("Plannerrecht kon niet worden aangepast.","Planner access could not be changed."));
      setPlannerNote(enabled?tx(`${person.full_name} kan nu plannen, beschikbaarheid opvragen en publiceren.`,`${person.full_name} can now plan, request availability and publish.`):tx(`${person.full_name} is geen planner meer.`,`${person.full_name} is no longer a planner.`));
      router.refresh();
    }catch(error){setPlannerNote(error instanceof Error?error.message:tx("Mislukt.","Failed."))}finally{setPlannerBusy("")}
  }
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
          onSubmit={async (event) => {
            event.preventDefault();
            const result=await mutate(
              "staff",
              Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
            );
            if(result?.invitation)setInvitation(result.invitation);
          }}
        >
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="accessRole" value="employee" />
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
          <label>{tx("Team / afdeling","Team / department")}<select name="departmentId" value={staffDepartment} onChange={event=>setStaffDepartment(event.target.value)}>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>{tx("Planningsrol","Planning role")}<select name="roleId" key={staffDepartment}>{roles.filter(role=>role.department_id===staffDepartment).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label>{tx("Toegang","Access role")}<input value={tx("Medewerker","Employee")} disabled/></label>
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
      {invitation?<section className="manual-invitation" aria-live="polite"><b>{tx("Beveiligde uitnodiging klaar","Secure invitation ready")}</b><p>{invitation.message}</p><small>{invitation.providerConnected?tx("Provider verbonden","Provider connected"):tx("Geen geverifieerde provider; handmatig delen","No verified provider; share manually")}</small><div><a className="primary" href={invitation.whatsappUrl} target="_blank" rel="noreferrer" onClick={()=>void mutate("invitation_state",{venueId,invitationId:invitation.id,state:"opened_in_whatsapp"})}>{tx("Open in WhatsApp","Open in WhatsApp")}</a><button type="button" onClick={()=>{void navigator.clipboard.writeText(invitation.message);void mutate("invitation_state",{venueId,invitationId:invitation.id,state:"copied"})}}>{tx("Kopieer bericht","Copy message")}</button><button type="button" onClick={()=>{void navigator.clipboard.writeText(invitation.link);void mutate("invitation_state",{venueId,invitationId:invitation.id,state:"copied"})}}>{tx("Kopieer link","Copy link")}</button></div></section>:null}
      <div className="team-list">
        {staff.map((person) => (
          <div key={person.id}>
            <span className="avatar">{person.full_name.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{person.full_name}</b>
              <small>{person.role_name} · {person.invitation_state==="accepted"?tx("actief","active"):person.invitation_state==="pending"?tx("uitgenodigd","invited"):tx("profiel onvolledig","profile incomplete")}</small>
              <small>{[person.contact_email,person.contact_phone,person.contracted_minutes_week!=null?tx("contract compleet","contract complete"):null].filter(Boolean).length}/3 {tx("profielonderdelen","profile fields")}</small>
            </div>
            <button
              disabled={busy}
              onClick={() => void mutate("staff_deactivate", { staffId: person.id })}
            >
              {tx("Deactiveer", "Deactivate")}
            </button>
            {canManageMembers?(person.auth_user_id?<button type="button" className={plannerUserIds.includes(person.auth_user_id)?"planner-on":""} aria-pressed={plannerUserIds.includes(person.auth_user_id)} disabled={plannerBusy===person.id} onClick={()=>void setPlanner(person,!plannerUserIds.includes(person.auth_user_id!))}>{plannerUserIds.includes(person.auth_user_id)?tx("Planner ✓","Planner ✓"):tx("Maak planner","Make planner")}</button>:<small className="planner-hint">{tx("Planner na accountactivatie","Planner after account activation")}</small>):null}
          </div>
        ))}
      </div>
      {canManageMembers?<p className="quiet planner-explainer">{plannerNote||tx("Een planner kan diensten maken en toewijzen, beschikbaarheid opvragen, avonden openen en publiceren. Geen toegang tot financiën of afsluitingen.","A planner can create and assign shifts, request availability, open nights and publish. No access to finance or closes.")}</p>:null}
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
  mutate: (action: string, values: Record<string, string>) => Promise<unknown>;
  tx: (nl: string, en: string) => string;
}) {
  return (
    <div>
      <h3>{tx("Verlof en ziekte", "Leave and sickness")}</h3>
      {!staff.length?<p className="quiet">{tx("Voeg eerst een medewerker toe via Team beheren.","Add an employee through Manage team first.")}</p>:null}
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
          <select name="staffId" required disabled={!staff.length}>
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
        <button className="primary" disabled={busy||!staff.length}>
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
                        reason: tx("Goedgekeurd na controle van de betrokken diensten en dekking", "Approved after reviewing affected shifts and coverage"),
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
                        reason: tx("Afgewezen na beoordeling van de aanvraag en operationele dekking", "Rejected after reviewing the request and operational coverage"),
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

function MissedTimePanel({venueId,staff,shifts,busy,save,tx}:{venueId:string;staff:Staff[];shifts:Shift[];busy:boolean;save:(values:Record<string,string>)=>void;tx:(nl:string,en:string)=>string}){
  return <form onSubmit={event=>{event.preventDefault();save({...Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>,idempotencyKey:crypto.randomUUID()})}}><h3>{tx("Gemiste klokregistratie","Missed clock event")}</h3><p>{tx("Gebruik dit alleen wanneer brongebeurtenissen ontbreken. De managerreden wordt onveranderlijk vastgelegd.","Use only when source events are missing. The manager reason is recorded immutably.")}</p>{!staff.length?<p className="quiet">{tx("Voeg eerst een medewerker toe via Team beheren.","Add an employee through Manage team first.")}</p>:null}<input type="hidden" name="venueId" value={venueId}/><label>{tx("Medewerker","Employee")}<select name="staffId" required disabled={!staff.length}>{staff.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>{tx("Geplande dienst (optioneel)","Scheduled shift (optional)")}<select name="shiftId"><option value="">—</option>{shifts.filter(shift=>shift.staff_id).map(shift=><option key={shift.id} value={shift.id}>{staff.find(person=>person.id===shift.staff_id)?.full_name} · {new Date(shift.starts_at).toLocaleString()}</option>)}</select></label><label>{tx("Start","Start")}<input name="clockedInAt" type="datetime-local" required/></label><label>{tx("Einde","End")}<input name="clockedOutAt" type="datetime-local" required/></label><label>{tx("Pauze (min)","Break (min)")}<input name="breakMinutes" type="number" min="0" max="480" defaultValue="0" required/></label><label>{tx("Reden en bewijs","Reason and evidence")}<textarea name="reason" minLength={5} maxLength={1000} required/></label><button className="primary" disabled={busy||!staff.length}>{tx("Als correctie vastleggen","Record as correction")}</button></form>
}
