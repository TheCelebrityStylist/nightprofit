import re, sys
path = "app/roster-board.tsx"
src = open(path, encoding="utf-8").read()
lines = src.split("\n")

def find(prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    raise SystemExit(f"anchor not found: {prefix!r}")

i_toolbar  = find('      <header className="roster-toolbar">')
i_context  = find('      <section className="roster-context"', i_toolbar)
i_edit     = find('      <section className="planner-edit-bar"', i_context)
i_template = find('      <section className="planner-template-bar"', i_edit)
i_summary  = find('      <section className="planner-summary"', i_template)
i_inbox    = find('      <section className="workforce-inbox"', i_summary)
i_intel    = find('      <section className="roster-intelligence"', i_inbox)
i_coverage = find('      <section className="coverage-layer"', i_intel)
i_staffing = find('      <section className="staffing-command"', i_coverage)
i_learning = find('      <section className="learning-card"', i_staffing)
i_message  = find('      {message ? (', i_learning)
i_props    = find('      {proposals.some(', i_message)
i_panel    = find('      {panel ? (', i_props)
i_return   = find('  return (', i_toolbar - 5) if False else None

context_block  = lines[i_context:i_edit]
edit_block     = lines[i_edit:i_template]
template_block = lines[i_template:i_summary]
summary_block  = lines[i_summary:i_inbox]
inbox_block    = lines[i_inbox:i_intel]
intel_block    = lines[i_intel:i_coverage]
coverage_block = lines[i_coverage:i_staffing]
staffing_block = lines[i_staffing:i_learning]
learning_block = lines[i_learning:i_message]
message_block  = lines[i_message:i_props]
grid_block     = lines[i_props:i_panel]

def j(block): return "\n".join(block)

# Plain-language headings instead of internal jargon.
inbox = j(inbox_block).replace('tx("WERKFORCE INBOX","WORKFORCE INBOX")','tx("ACTIE NODIG","ACTION NEEDED")').replace('tx("Defensief gerangschikte acties","Defensibly ranked actions")','tx("Belangrijkste eerst","Most important first")').replace('tx("Geen open workforce-uitzonderingen voor deze locatie.","No open workforce exceptions for this venue.")','tx("Niets te doen. Ziekmeldingen, ruilverzoeken en uren om goed te keuren verschijnen hier.","Nothing to do. Sick reports, swap requests and hours to approve appear here.")')
intel = j(intel_block).replace('<span className="eyebrow">ROSTER HEALTH</span>','<span className="eyebrow">{tx("ROOSTERCHECK","ROSTER CHECK")}</span>')
learning = j(learning_block).replace('<span className="eyebrow">CLOSE → LEARN</span>','<span className="eyebrow">{tx("NA DE AVOND","AFTER SERVICE")}</span>').replace('tx("Alleen uit vergrendeld bewijs","Only from locked evidence")','tx("Gepland versus gewerkt","Planned versus worked")')

edit = j(edit_block)
edit = "      {selectedIds.length||undoStack.length||redoStack.length?<>\n" + edit + "\n      </>:null}"

template_inner = j(template_block).replace('<section className="planner-template-bar"', '<section className="planner-template-bar in-panel"')

header = '''      <header className="planner-head">
        <div className="planner-title">
          <h2>{tx("Rooster", "Roster")}</h2>
          <p><span>{tx("Week","Week")} {isoWeek(weekStart)}</span><span className={`week-state ${weekState}`}>{weekStateLabel}</span>{teamReady?<span>{tx("Beschikbaarheid","Availability")} {respondedStaff}/{activeStaff.length}</span>:null}</p>
        </div>
        <div className="planner-head-actions">
          {teamReady?<button type="button" onClick={() => setPanel("availability")}>{tx("Beschikbaarheid opvragen", "Request availability")}</button>:null}
          {weekState==="setup"?<button type="button" className="primary" onClick={()=>setPanel("team")}>{tx("Team instellen","Set up team")}</button>
          :weekState==="empty"?(previousWeekCount?<button type="button" className="primary" disabled={busy} onClick={() => void mutate("copy_week", {venueId,startsAt:new Date(weekStart.getTime()-7*dayMs).toISOString(),endsAt:weekStart.toISOString(),idempotencyKey:crypto.randomUUID()})}>{tx(`Kopieer vorige week (${previousWeekCount})`,`Copy last week (${previousWeekCount})`)}</button>
            :visibleIntervals.length?<button type="button" className="primary" disabled={busy} onClick={()=>void mutate("proposal",{venueId,startsAt:weekStart.toISOString(),endsAt:weekEnd.toISOString()})}>{tx("Rooster voorstellen","Suggest roster")}</button>
            :<button type="button" className="primary" onClick={()=>{if(venueDepartments[0]){setNewShift({day:weekStart,departmentId:venueDepartments[0].id,staffId:"open"});setPanel("new")}}}>{tx("Eerste dienst toevoegen","Add first shift")}</button>)
          :weekState==="draft"?<button type="button" className="primary publish" disabled={busy || !health.publishable} title={!health.publishable?tx("Los eerst de blokkerende punten op (tab Inzicht).","Resolve blocking issues first (Insights tab)."):undefined} onClick={() => setPanel("publish")}>{tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>
          :<button type="button" className="primary" onClick={()=>setPanel("share")}>{tx("Delen via WhatsApp","Share via WhatsApp")}</button>}
        </div>
      </header>
      <nav className="planner-tabs" role="tablist" aria-label={tx("Planneronderdelen","Planner sections")}>
        {([["roster",tx("Rooster","Roster"),0],["actions",tx("Actie nodig","Action needed"),venueExceptions.length],["insights",tx("Inzicht","Insights"),health.issues.length],["hours",tx("Uren","Hours"),pendingRecords.length+timeCorrections.filter(row=>row.venue_id===venueId).length]] as const).map(([key,label,count])=><button type="button" role="tab" key={key} aria-selected={tab===key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{label}{count?<em>{count}</em>:null}</button>)}
      </nav>'''

# "More" menu gains Templates and Share entries.
ctx = j(context_block).replace(
    '<button type="button" onClick={() => setPanel("scenario")}>{tx("Scenario testen", "Test scenario")}</button>',
    '<button type="button" onClick={() => setPanel("scenario")}>{tx("Scenario testen", "Test scenario")}</button>\n          <button type="button" onClick={() => setPanel("templates")}>{tx("Templates en herhaling", "Templates and recurrence")}</button>\n          <button type="button" onClick={() => setPanel("share")}>{tx("Rooster delen via WhatsApp", "Share roster via WhatsApp")}</button>\n          <button type="button" onClick={() => setPanel("team")}>{tx("Team en rollen", "Team and roles")}</button>')
if ctx == j(context_block):
    raise SystemExit("more-menu anchor not found")

out = (lines[:i_toolbar]
    + [header]
    + ['      {tab==="roster"?<>'] + [ctx] + [edit] + summary_block + ['      </>:null}']
    + ['      {tab==="actions"?' + inbox.strip() + ':null}']
    + ['      {tab==="insights"?<>'] + [intel] + coverage_block + [learning] + ['      </>:null}']
    + ['      {tab==="hours"?' + j(staffing_block).strip() + ':null}']
    + message_block
    + ['      {tab==="roster"?<>'] + grid_block + ['      </>:null}']
    + lines[i_panel:])
src = "\n".join(out)

# Panels: templates + share, inserted before the health panel.
health_anchor = '            ) : panel === "health" ? ('
if src.count(health_anchor) != 1: raise SystemExit("health panel anchor")
share_panel = '''            ) : panel === "templates" ? (
              <section className="context-detail"><span className="eyebrow">{tx("TEMPLATES","TEMPLATES")}</span><h3>{tx("Vaste weken hergebruiken","Reuse standard weeks")}</h3><p>{tx("Selecteer diensten in het rooster (Ctrl/Cmd + klik) om ze als template op te slaan, of pas een template toe op deze week.","Select shifts in the roster (Ctrl/Cmd + click) to save them as a template, or apply a template to this week.")}</p>
''' + template_inner + '''
              </section>
            ) : panel === "share" ? (
              <section className="context-detail share-roster"><span className="eyebrow">{tx("ROOSTER DELEN","SHARE ROSTER")}</span><h3>{tx("Stuur iedereen zijn diensten","Send everyone their shifts")}</h3><p>{tx("Eén tik per medewerker opent WhatsApp met zijn eigen diensten van deze week. Alleen gepubliceerde diensten.","One tap per employee opens WhatsApp with their own shifts for this week. Published shifts only.")}</p>
                {shareRows.length?<ul>{shareRows.map(({person,rows,text,phone,minutes})=><li key={person.id}><div><b>{person.full_name}</b><small>{rows.length} {rows.length===1?tx("dienst","shift"):tx("diensten","shifts")} · {Math.round(minutes/6)/10} {tx("uur","h")}</small></div><div className="share-actions">{phone?<a className="primary" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>:<small>{tx("Geen geldig 06-nummer","No valid mobile number")}</small>}<button type="button" onClick={()=>{void navigator.clipboard.writeText(text);setMessage(tx(`Bericht voor ${person.full_name} gekopieerd.`,`Message for ${person.full_name} copied.`))}}>{tx("Kopieer","Copy")}</button></div></li>)}</ul>:<p className="quiet">{tx("Nog geen gepubliceerde diensten deze week.","No published shifts this week yet.")}</p>}
              </section>
''' + health_anchor
src = src.replace(health_anchor, share_panel)

# After publishing, go straight to sharing.
pub_old = 'idempotencyKey:crypto.randomUUID()},()=>setPanel(null))}>{tx("Controle bevestigd en publiceren", "Confirm review and publish")}'
if src.count(pub_old) != 1: raise SystemExit("publish anchor")
src = src.replace(pub_old, 'idempotencyKey:crypto.randomUUID()},()=>setPanel("share"))}>{tx("Controle bevestigd en publiceren", "Confirm review and publish")}')

# Panel union + tab state.
p_old = '"missed" | "health" | "scenario" | "publish" | null>('
if src.count(p_old) != 1: raise SystemExit("panel type anchor")
src = src.replace(p_old, '"missed" | "health" | "scenario" | "publish" | "templates" | "share" | null>(')
st_old = '  const [newShift, setNewShift] = useState<{'
src = src.replace(st_old, '  const [tab, setTab] = useState<"roster" | "actions" | "insights" | "hours">("roster");\n' + st_old, 1)

# Derived planner state, right before render.
derived = '''  const draftCount = visibleShifts.filter((row) => row.status === "draft").length;
  const publishedCount = visibleShifts.filter((row) => row.status === "published").length;
  const teamReady = venueDepartments.length > 0 && roles.length > 0 && activeStaff.length > 0;
  const weekState: "setup" | "empty" | "draft" | "published" = !teamReady ? "setup" : draftCount ? "draft" : publishedCount ? "published" : "empty";
  const weekStateLabel = { setup: tx("Team nog niet ingesteld", "Team not set up"), empty: tx("Nog leeg", "Empty"), draft: tx("Concept · niet zichtbaar voor team", "Draft · not visible to team"), published: tx("Gepubliceerd", "Published") }[weekState];
  const previousWeekStart = new Date(weekStart.getTime() - 7 * dayMs);
  const previousWeekCount = shifts.filter((row) => row.venue_id === venueId && row.status !== "cancelled" && new Date(row.starts_at) >= previousWeekStart && new Date(row.starts_at) < weekStart).length;
  const weekAvailability = staffAvailability.filter((row) => row.venue_id === venueId && new Date(row.starts_at) < weekEnd && new Date(row.ends_at) > weekStart);
  const respondedStaff = new Set(weekAvailability.map((row) => row.staff_id)).size;
  const availabilityOn = (staffId: string, day: Date) => {
    const end = new Date(day.getTime() + dayMs);
    const states = weekAvailability.filter((row) => row.staff_id === staffId && new Date(row.starts_at) < end && new Date(row.ends_at) > day).map((row) => row.availability);
    return states.includes("unavailable") ? "unavailable" : states.includes("preferably_not") ? "preferably_not" : states.includes("preferred") ? "preferred" : states.includes("available") ? "available" : null;
  };
  const availabilityLabel = (state: string) => ({ available: tx("Kan", "Available"), preferred: tx("Liefst", "Preferred"), preferably_not: tx("Liever niet", "Rather not"), unavailable: tx("Kan niet", "Unavailable") } as Record<string, string>)[state] ?? state;
  const shiftMinutes = (row: Shift) => Math.max(0, Math.floor((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000) - row.break_minutes);
  const dayTotals = days.map((day) => {
    const rows = visibleShifts.filter((row) => new Date(row.starts_at).toDateString() === day.toDateString());
    return { minutes: rows.reduce((sum, row) => sum + shiftMinutes(row), 0), cost: rows.reduce((sum, row) => sum + (BigInt(row.hourly_cost_minor) * BigInt(shiftMinutes(row)) + 30n) / 60n, 0n), open: rows.filter((row) => !row.staff_id).length };
  });
  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";
  const zonedTime = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { timeZone: venueTimezone, ...options });
  const shareRows = activeStaff.map((person) => {
    const rows = visibleShifts.filter((row) => row.staff_id === person.id && row.status === "published").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const minutes = rows.reduce((sum, row) => sum + shiftMinutes(row), 0);
    const lines = rows.map((row) => `• ${zonedTime(row.starts_at, { weekday: "short", day: "numeric", month: "short" })} ${zonedTime(row.starts_at, { hour: "2-digit", minute: "2-digit" })}–${zonedTime(row.ends_at, { hour: "2-digit", minute: "2-digit" })} · ${roles.find((role) => role.id === row.role_id)?.name ?? ""}`);
    const first = person.full_name.trim().split(/\\s+/)[0];
    const text = person.preferred_language === "en"
      ? `Hi ${first}, your roster at ${venueName} for week ${isoWeek(weekStart)}:\\n${lines.join("\\n")}\\n\\nTotal ${Math.round(minutes / 6) / 10} hours. Something wrong or want to swap? Let me know.`
      : `Hoi ${first}, je rooster bij ${venueName} voor week ${isoWeek(weekStart)}:\\n${lines.join("\\n")}\\n\\nTotaal ${Math.round(minutes / 6) / 10} uur. Klopt er iets niet of wil je ruilen? Laat het weten.`;
    let phone: string | null = null;
    try { phone = person.contact_phone ? normalizeDutchPhone(person.contact_phone).replace(/^\\+/, "") : null; } catch { phone = null; }
    return { person, rows, minutes, text, phone };
  }).filter((row) => row.rows.length);
'''
ret_anchor = '  return (\n    <div className="roster-product">'
if src.count(ret_anchor) != 1: raise SystemExit("return anchor")
src = src.replace(ret_anchor, derived + ret_anchor)

# isoWeek helper next to monday().
mon_anchor = 'const phoneState=('
src = src.replace(mon_anchor, 'const isoWeek = (value: Date) => {\n  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));\n  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));\n  return Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / dayMs + 1) / 7);\n};\n' + mon_anchor, 1)

# Availability inside the grid + daily totals footer.
cell_old = '''                    <div
                      className={`shift-cell ${dayAbsence ? "unavailable" : ""}`}'''
if src.count(cell_old) != 1: raise SystemExit("cell anchor")
src = src.replace(cell_old, '''                    <div
                      className={`shift-cell ${dayAbsence ? "unavailable" : ""} ${person.id !== "open" && !dayAbsence ? `avail-${availabilityOn(person.id, day) ?? "unknown"}` : ""}`}''')
chip_old = '''                      ) : null}
                      {cell.map((row) => ('''
if src.count(chip_old) != 1: raise SystemExit("chip anchor")
src = src.replace(chip_old, '''                      ) : person.id !== "open" && availabilityOn(person.id, day) && availabilityOn(person.id, day) !== "available" ? (
                        <span className={`avail-chip ${availabilityOn(person.id, day)}`}>{availabilityLabel(availabilityOn(person.id, day)!)}</span>
                      ) : null}
                      {cell.map((row) => (''')
foot_old = '''          </div>
        ))}
      </section>:null}'''
if src.count(foot_old) != 1: raise SystemExit("grid end anchor")
src = src.replace(foot_old, '''          </div>
        ))}
        <div className="roster-grid roster-foot">
          <div className="employee-cell"><b>{tx("Totaal", "Total")}</b><small className="avail-legend"><i className="avail-available" />{tx("kan", "available")} <i className="avail-unavailable" />{tx("kan niet", "unavailable")} <i className="avail-unknown" />{tx("onbekend", "unknown")}</small></div>
          {dayTotals.map((total, index) => <div key={days[index].toISOString()}><b>{Math.round(total.minutes / 6) / 10} {tx("uur", "h")}</b><small>{currency(total.cost)}{total.open ? ` · ${total.open} ${tx("open", "open")}` : ""}</small></div>)}
        </div>
      </section>:null}''')

# Published shifts: say what is possible instead of failing silently.
ed_old = '''      <h3>{tx("Dienst bewerken", "Edit shift")}</h3>
      {offerable ? ('''
if src.count(ed_old) != 1: raise SystemExit("editor anchor")
src = src.replace(ed_old, '''      <h3>{published ? tx("Gepubliceerde dienst", "Published shift") : tx("Dienst bewerken", "Edit shift")}</h3>
      {published && !offerable ? <p className="published-note">{tx("Dit rooster is al bij je team. Direct wijzigen kan niet meer: bij ziekte of verlof vervang je via \\u2018Actie nodig\\u2019, medewerkers kunnen onderling ruilen, en een open dienst bied je aan.", "This roster is already with your team. It can't be edited directly: replace via \\u2018Action needed\\u2019 for sickness or leave, employees can swap, and open shifts can be offered.")}</p> : null}
      {offerable ? (''')
off_old = '  const offerable = row.status === "published"'
src = src.replace(off_old, '  const published = row.status === "published";\n' + off_old, 1)
save_old = '''      <button className="primary" disabled={busy||row.locked}>
        {tx("Opslaan", "Save")}
      </button>
      <button className="danger" type="button" disabled={busy} onClick={cancel}>
        {tx("Dienst verwijderen", "Delete shift")}
      </button>'''
if src.count(save_old) != 1: raise SystemExit("save anchor")
src = src.replace(save_old, '''      {!published ? <>
      <button className="primary" disabled={busy||row.locked}>
        {tx("Opslaan", "Save")}
      </button>
      <button className="danger" type="button" disabled={busy} onClick={cancel}>
        {tx("Dienst verwijderen", "Delete shift")}
      </button>
      </> : null}''')
for old in ['disabled={busy||row.locked} onClick={() => resize(-30)}', 'disabled={busy||row.locked} onClick={() => resize(30)}']:
    if src.count(old) != 1: raise SystemExit("resize anchor")
    src = src.replace(old, old.replace('busy||row.locked', 'busy||row.locked||published'))

open(path, "w", encoding="utf-8").write(src)
print("ok", len(src.split("\n")), "lines")
