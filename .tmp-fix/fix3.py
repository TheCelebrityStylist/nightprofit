import sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count: raise SystemExit(f"expected {count} got {n}: {old[:90]!r}")
    src = src.replace(old, new)

# --- imports & types -------------------------------------------------------
rep('import { normalizeDutchPhone } from "@/lib/workforce/domain";',
    'import { normalizeDutchPhone } from "@/lib/workforce/domain";\nimport { isoWeekday, patternHeadcount, type LaneKind, type ServicePattern } from "@/lib/workforce/service-nights";\nimport { ServiceNightsPanel } from "./service-nights";')
rep('type Department = { id: string; venue_id: string; name: string };',
    'type Department = { id: string; venue_id: string; name: string; kind?: LaneKind };')
rep('''  preferences?: Record<string,unknown>;
};''', '''  preferences?: Record<string,unknown>;
  auth_user_id?: string | null;
};''')

# --- props ------------------------------------------------------------------
rep('''  proposals,
}: {''', '''  proposals,
  servicePatterns = [],
  plannerUserIds = [],
  canManageMembers = false,
}: {''')
rep('''  proposals: Proposal[];
}) {''', '''  proposals: Proposal[];
  servicePatterns?: ServicePattern[];
  plannerUserIds?: string[];
  canManageMembers?: boolean;
}) {''')

# --- lanes ------------------------------------------------------------------
rep('''  const visibleShifts = shifts.filter(
    (row) =>''', '''  const [lane, setLane] = useState<LaneKind>("staff");
  const laneOfDepartment = (departmentId: string): LaneKind => departments.find((row) => row.id === departmentId)?.kind === "dj" ? "dj" : "staff";
  const laneOfRole = (roleId: string): LaneKind => laneOfDepartment(roles.find((row) => row.id === roleId)?.department_id ?? "");
  const hasDjLane = departments.some((row) => row.venue_id === venueId && row.kind === "dj");
  const activeLane: LaneKind = hasDjLane ? lane : "staff";
  const weekShifts = shifts.filter(
    (row) =>''')
rep('''      row.status !== "cancelled",
  );
  const visibleIntervals = intervals.filter(''', '''      row.status !== "cancelled",
  );
  const staffShifts = weekShifts.filter((row) => laneOfDepartment(row.department_id) === "staff");
  const visibleShifts = weekShifts.filter((row) => laneOfDepartment(row.department_id) === activeLane);
  const visibleIntervals = intervals.filter(''')
# break conflicts, coverage maths, constraints work on the right sets
rep('const breakConflicts=visibleIntervals.filter(interval=>{const assigned=visibleShifts.filter(', 'const breakConflicts=visibleIntervals.filter(interval=>{const assigned=staffShifts.filter(')
rep('''  const venueDepartments = departments.filter((row) => row.venue_id === venueId);''',
    '''  const allVenueDepartments = departments.filter((row) => row.venue_id === venueId);
  const venueDepartments = allVenueDepartments.filter((row) => (row.kind === "dj" ? "dj" : "staff") === activeLane);''')
rep('  const labor = visibleShifts.reduce((sum, row) => {', '  const labor = weekShifts.reduce((sum, row) => {')
rep('''    visibleShifts.map((row) => ({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",staffId:row.staff_id''',
    '''    staffShifts.map((row) => ({id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,roleId:"all",staffId:row.staff_id''')
rep('const constraints=analyzeRosterConstraints(visibleShifts.map(', 'const constraints=analyzeRosterConstraints(weekShifts.map(')
rep('  const availabilityConflicts=visibleShifts.filter(shift=>{', '  const availabilityConflicts=weekShifts.filter(shift=>{')
rep('  const skillConflicts=visibleShifts.filter(', '  const skillConflicts=weekShifts.filter(')

# --- per-day requirement: forecast for staff, else the standard night ------
rep('''    const required = visibleIntervals
      .filter((row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end)
      .reduce((max, row) => Math.max(max, row.required_staff), 0);''', '''    const forecast = activeLane === "staff" ? visibleIntervals
      .filter((row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end)
      .reduce((max, row) => Math.max(max, row.required_staff), 0) : 0;
    const required = Math.max(forecast, patternHeadcount(venuePatterns.find((row) => row.iso_weekday === isoWeekday(day)), laneOfRole, activeLane));''')
rep('''  const coverage = days.map((day) => {''', '''  const venuePatterns = servicePatterns.filter((row) => row.venue_id === venueId);
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
  const coverage = days.map((day) => {''')

# --- week state uses the whole week, both lanes ----------------------------
rep('  const draftCount = visibleShifts.filter((row) => row.status === "draft").length;', '  const draftCount = weekShifts.filter((row) => row.status === "draft").length;\n  const laneDraftCount = (kind: LaneKind) => weekShifts.filter((row) => row.status === "draft" && laneOfDepartment(row.department_id) === kind).length;')
rep('  const publishedCount = visibleShifts.filter((row) => row.status === "published").length;', '  const publishedCount = weekShifts.filter((row) => row.status === "published").length;')
rep('  const teamReady = venueDepartments.length > 0 && roles.length > 0 && activeStaff.length > 0;', '  const teamReady = allVenueDepartments.length > 0 && roles.length > 0 && activeStaff.length > 0;')
rep('''  const quietDays = days.map((day, index) => dayTotals[index].minutes === 0 && !dayTotals[index].open && !visibleIntervals.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()));''',
    '''  const quietDays = days.map((day, index) => dayTotals[index].minutes === 0 && !dayTotals[index].open && !weekShifts.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()) && !venuePatterns.some((row) => row.active && row.iso_weekday === isoWeekday(day)) && !visibleIntervals.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()));''')
rep('''  const shareRows = activeStaff.map((person) => {''', '''  const laneStaff = activeStaff.filter((person) => venueDepartments.some((department) => staffInDepartment(person, department.id)) && (activeLane === "dj" ? roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj") : !roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj")));
  const laneLabel = (kind: LaneKind) => kind === "dj" ? tx("DJ's", "DJs") : tx("Personeel", "Staff");
  const shareRows = laneStaff.map((person) => {''')

# --- header -----------------------------------------------------------------
rep('''<span>{tx("Beschikbaarheid","Availability")} {respondedStaff}/{activeStaff.length}</span>''',
    '''<span>{tx("Beschikbaarheid","Availability")} {laneStaff.filter((person) => weekAvailability.some((row) => row.staff_id === person.id)).length}/{laneStaff.length}{hasDjLane ? ` · ${laneLabel(activeLane)}` : ""}</span>''')
rep('''          {teamReady?<button type="button" onClick={() => setPanel("availability")}>{tx("Beschikbaarheid opvragen", "Request availability")}</button>:null}''',
    '''          {teamReady||allVenueDepartments.length?<button type="button" onClick={() => setPanel("nights")}>{tx("Avonden", "Nights")}</button>:null}
          {teamReady?<button type="button" onClick={() => setPanel("availability")}>{hasDjLane&&activeLane==="dj"?tx("DJ's vragen", "Ask DJs"):tx("Beschikbaarheid opvragen", "Request availability")}</button>:null}''')
rep('''          :weekState==="empty"?(previousWeekCount?''', '''          :weekState==="empty"&&standardWeekReady&&standardMissing?<button type="button" className="primary" disabled={busy} onClick={()=>setPanel("nights")}>{tx(`Standaardweek invullen (${standardMissing})`,`Fill standard week (${standardMissing})`)}</button>
          :weekState==="empty"?(previousWeekCount?''')
rep('''{tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>
            :<button type="button" className="primary blocked"''', '''{hasDjLane&&laneDraftCount("dj")&&laneDraftCount("staff")?tx(`Publiceren · ${laneDraftCount("staff")} personeel + ${laneDraftCount("dj")} DJ`,`Publish · ${laneDraftCount("staff")} staff + ${laneDraftCount("dj")} DJ`):tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>
            :<button type="button" className="primary blocked"''')
rep('''        <label>{tx("Afdeling", "Department")}<select value={departmentFilter}''', '''        {hasDjLane?<div className="lane-switch" role="tablist" aria-label={tx("Planning","Planning")}>{(["staff","dj"] as const).map((kind)=><button type="button" role="tab" key={kind} aria-selected={activeLane===kind} className={activeLane===kind?"active":""} onClick={()=>{setLane(kind);setDepartmentFilter("");setSelectedIds([])}}>{laneLabel(kind)}{laneDraftCount(kind)?<em>{laneDraftCount(kind)}</em>:null}</button>)}</div>:null}
        {venueDepartments.length>1?<label>{tx("Afdeling", "Department")}<select value={departmentFilter}''')
rep('''{venueDepartments.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>''',
    '''{venueDepartments.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>:null}''')
rep('''          <button type="button" onClick={() => setPanel("templates")}>{tx("Templates en herhaling", "Templates and recurrence")}</button>''',
    '''          <button type="button" onClick={() => setPanel("nights")}>{tx("Standaardweek en extra avonden", "Standard week and extra nights")}</button>
          <button type="button" onClick={() => setPanel("templates")}>{tx("Templates en herhaling", "Templates and recurrence")}</button>''')

# --- panels -----------------------------------------------------------------
rep('''"publish" | "templates" | "share" | null>(''', '''"publish" | "templates" | "share" | "nights" | null>(''')
rep('''<dd>{new Set(visibleShifts.filter(row=>row.status==="draft"&&row.staff_id).map(row=>row.staff_id)).size}</dd>''', '''<dd>{new Set(weekShifts.filter(row=>row.status==="draft"&&row.staff_id).map(row=>row.staff_id)).size}</dd>''')
rep('''<dd>{visibleShifts.filter(row=>!row.staff_id).length}</dd></div>''', '''<dd>{weekShifts.filter(row=>!row.staff_id).length}</dd></div>
                  {hasDjLane?<div><dt>{tx("Concept per planning","Drafts per lane")}</dt><dd>{laneDraftCount("staff")} {tx("personeel","staff")} · {laneDraftCount("dj")} DJ</dd></div>:null}''')
rep('''{visibleShifts.some(row=>!row.staff_id&&row.status==="draft")?<div><dt>{tx("Na publicatie"''', '''{weekShifts.some(row=>!row.staff_id&&row.status==="draft")?<div><dt>{tx("Na publicatie"''')
rep('''<dd>{Math.round(visibleShifts.reduce((sum,row)=>sum+Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes),0)/6)/10} u</dd>''',
    '''<dd>{Math.round(weekShifts.reduce((sum,row)=>sum+Math.max(0,(new Date(row.ends_at).getTime()-new Date(row.starts_at).getTime())/60000-row.break_minutes),0)/6)/10} u</dd>''')
rep('''expectedRevision:String(Math.max(...visibleShifts.filter(row=>row.status==="draft").map(row=>row.revision??1)))''',
    '''expectedRevision:String(Math.max(...weekShifts.filter(row=>row.status==="draft").map(row=>row.revision??1)))''')
rep('''            ) : panel === "templates" ? (''', '''            ) : panel === "nights" ? (
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
            ) : panel === "templates" ? (''')
rep('''                staff={activeStaff.map((row) => ({
                  id: row.id,''', '''                staff={laneStaff.map((row) => ({
                  id: row.id,''')
rep('''<MissedTimePanel venueId={venueId} staff={activeStaff} shifts={visibleShifts}''', '''<MissedTimePanel venueId={venueId} staff={activeStaff} shifts={weekShifts}''')
rep('''                <TeamSetup
                  organisationId={organisationId}
                  venueId={venueId}
                  departments={venueDepartments}''', '''                <TeamSetup
                  organisationId={organisationId}
                  venueId={venueId}
                  plannerUserIds={plannerUserIds}
                  canManageMembers={canManageMembers}
                  departments={allVenueDepartments}''')

# --- TeamSetup: department-aware role choice + planner access ---------------
rep('''function TeamSetup({
  venueId,
  departments,''', '''function TeamSetup({
  venueId,
  plannerUserIds,
  canManageMembers,
  departments,''')
rep('''  organisationId: string;
  venueId: string;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  busy: boolean;''', '''  organisationId: string;
  venueId: string;
  plannerUserIds: string[];
  canManageMembers: boolean;
  departments: Department[];
  roles: Role[];
  staff: Staff[];
  busy: boolean;''')
rep('''  const [invitation,setInvitation]=useState<{id:string;link:string;message:string;whatsappUrl:string;deliveryState:string;providerConnected:boolean}|null>(null);
  return (
    <div>''', '''  const [invitation,setInvitation]=useState<{id:string;link:string;message:string;whatsappUrl:string;deliveryState:string;providerConnected:boolean}|null>(null);
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
    <div>''')
rep('''function TeamSetup({
  venueId,
  plannerUserIds,''', '''function TeamSetup({
  organisationId,
  venueId,
  plannerUserIds,''')
rep('''              {tx("Deactiveer", "Deactivate")}
            </button>
          </div>
        ))}
      </div>''', '''              {tx("Deactiveer", "Deactivate")}
            </button>
            {canManageMembers?(person.auth_user_id?<button type="button" className={plannerUserIds.includes(person.auth_user_id)?"planner-on":""} aria-pressed={plannerUserIds.includes(person.auth_user_id)} disabled={plannerBusy===person.id} onClick={()=>void setPlanner(person,!plannerUserIds.includes(person.auth_user_id!))}>{plannerUserIds.includes(person.auth_user_id)?tx("Planner ✓","Planner ✓"):tx("Maak planner","Make planner")}</button>:<small className="planner-hint">{tx("Planner na accountactivatie","Planner after account activation")}</small>):null}
          </div>
        ))}
      </div>
      {canManageMembers?<p className="quiet planner-explainer">{plannerNote||tx("Een planner kan diensten maken en toewijzen, beschikbaarheid opvragen, avonden openen en publiceren. Geen toegang tot financiën of afsluitingen.","A planner can create and assign shifts, request availability, open nights and publish. No access to finance or closes.")}</p>:null}''')
rep('''<label>{tx("Team / afdeling","Team / department")}<select name="departmentId">{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>{tx("Planningsrol","Planning role")}<select name="roleId">{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>''',
    '''<label>{tx("Team / afdeling","Team / department")}<select name="departmentId" value={staffDepartment} onChange={event=>setStaffDepartment(event.target.value)}>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>{tx("Planningsrol","Planning role")}<select name="roleId" key={staffDepartment}>{roles.filter(role=>role.department_id===staffDepartment).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>''')
open(path, "w", encoding="utf-8").write(src)
print("ok3")
