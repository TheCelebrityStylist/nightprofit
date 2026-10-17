import sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count: raise SystemExit(f"expected {count} got {n}: {old[:70]!r}")
    src = src.replace(old, new)

rep('  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";',
'''  const staffInDepartment = (person: Staff, departmentId: string) => {
    if (person.id === "open") return true;
    const knownRole = roles.some((role) => role.name === person.role_name);
    return !knownRole || roles.some((role) => role.department_id === departmentId && role.name === person.role_name) || visibleShifts.some((row) => row.staff_id === person.id && row.department_id === departmentId);
  };
  const quietDays = days.map((day, index) => dayTotals[index].minutes === 0 && !dayTotals[index].open && !visibleIntervals.some((row) => new Date(row.starts_at).toDateString() === day.toDateString()));
  const collapseQuiet = quietDays.some((quiet) => !quiet);
  const gridStyle = { gridTemplateColumns: `190px ${quietDays.map((quiet) => (collapseQuiet && quiet ? "64px" : "minmax(130px,1fr)")).join(" ")}`, minWidth: `${190 + quietDays.reduce((sum, quiet) => sum + (collapseQuiet && quiet ? 64 : 130), 0)}px` };
  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";''')
rep('''            {[
              ...displayedStaff,''', '''            {[
              ...displayedStaff.filter((person) => staffInDepartment(person, department.id)),''')

rep('<div className="roster-grid roster-head">', '<div className="roster-grid roster-head" style={gridStyle}>')
rep('<div className="roster-grid roster-row" key={`${department.id}-${person.id}`}>', '<div className="roster-grid roster-row" style={gridStyle} key={`${department.id}-${person.id}`}>')
rep('<div className="roster-grid roster-foot">', '<div className="roster-grid roster-foot" style={gridStyle}>')
rep('''              className={coverage[index].planned < coverage[index].required ? "coverage-gap" : ""}''',
    '''              className={`${coverage[index].planned < coverage[index].required ? "coverage-gap" : ""} ${collapseQuiet && quietDays[index] ? "quiet" : ""}`}''')
rep('''                  return (
                    <div
                      className={`shift-cell ''', '''                  const quietIndex = days.findIndex((value) => value.getTime() === day.getTime());
                  return (
                    <div
                      className={`shift-cell ${collapseQuiet && quietDays[quietIndex] ? "quiet" : ""} ''')
rep('{dayTotals.map((total, index) => <div key={days[index].toISOString()}>', '{dayTotals.map((total, index) => <div className={collapseQuiet && quietDays[index] ? "quiet" : ""} key={days[index].toISOString()}>')

rep('''<button type="button" className="primary publish" disabled={busy || !health.publishable} title={!health.publishable?tx("Los eerst de blokkerende punten op (tab Inzicht).","Resolve blocking issues first (Insights tab)."):undefined} onClick={() => setPanel("publish")}>{tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>''',
'''(health.publishable
            ?<button type="button" className="primary publish" disabled={busy} onClick={() => setPanel("publish")}>{tx(`Publiceren · ${draftCount} ${draftCount===1?"wijziging":"wijzigingen"}`,`Publish · ${draftCount} ${draftCount===1?"change":"changes"}`)}</button>
            :<button type="button" className="primary blocked" onClick={() => setPanel("health")}>{tx(`${blockingCount} ${blockingCount===1?"blokkade":"blokkades"} vóór publiceren`,`${blockingCount} ${blockingCount===1?"blocker":"blockers"} before publishing`)}</button>)''')
rep('  const draftCount = visibleShifts.filter((row) => row.status === "draft").length;',
    '  const draftCount = visibleShifts.filter((row) => row.status === "draft").length;\n  const blockingCount = health.issues.filter((issue) => issue.severity === "blocking").length;')

rep('''<span>{issue.count} · {issue.severity=== "blocking"?tx("blokkeert publicatie","blocks publication"):tx("controleren","review")}</span></li>)}</ul>''',
'''<span>{issue.count} · {issue.severity=== "blocking"?tx("blokkeert publicatie","blocks publication"):tx("controleren","review")}</span><small>{issueLabel(issue.code)}</small></li>)}</ul>''')
open(path, "w", encoding="utf-8").write(src)
print("ok")
