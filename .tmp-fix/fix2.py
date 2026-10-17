import sys
path=sys.argv[1]; src=open(path,encoding="utf-8").read()
def rep(old,new):
    global src
    n=src.count(old)
    if n!=1: raise SystemExit(f"expected 1 got {n}: {old[:60]!r}")
    src=src.replace(old,new)
start=src.index('      <section className="mobile-day-roster"')
end=src.index('      </section>\n',start)+len('      </section>\n')
new='''      <section className="mobile-day-roster" aria-label={tx("Mobiel dagrooster", "Mobile day roster")}>
        <div className="mobile-day-chips" role="tablist">{days.map((day,index)=><button type="button" role="tab" aria-selected={index===mobileIndex} className={index===mobileIndex?"active":""} key={day.toISOString()} onClick={()=>setMobileDay(index)}><small>{day.toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short"})}</small><b>{day.getDate()}</b><em>{dayTotals[index].count||""}</em></button>)}</div>
        <div className="mobile-coverage"><span>{days[mobileIndex].toLocaleDateString(locale==="nl"?"nl-NL":"en-GB",{weekday:"long",day:"numeric",month:"short"})}</span><b>{coverage[mobileIndex]?.planned ?? 0} / {coverage[mobileIndex]?.required ?? 0} {tx("bezet","filled")}</b></div>
        {mobileShifts.length ? mobileShifts.map(shift=><button type="button" className="mobile-shift-card" key={shift.id} onClick={()=>{setSelected(shift);setPanel("shift")}}><span><b>{staff.find(person=>person.id===shift.staff_id)?.full_name??tx("Open dienst","Open shift")}</b><small>{roles.find(role=>role.id===shift.role_id)?.name??tx("Dienst","Shift")}{shift.status==="draft"?tx(" · concept"," · draft"):""}</small></span><strong>{new Date(shift.starts_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}–{new Date(shift.ends_at).toLocaleTimeString(locale==="nl"?"nl-NL":"en-GB",{hour:"2-digit",minute:"2-digit"})}</strong></button>) : <div className="mobile-empty"><b>{tx("Geen diensten op deze dag", "No shifts this day")}</b><span>{tx("Kies een andere dag of voeg een dienst toe.", "Pick another day or add a shift.")}</span></div>}
      </section>
'''
src=src[:start]+new+src[end:]
rep('  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";',
'''  const firstBusyDay = dayTotals.findIndex((total) => total.count > 0);
  const todayIndex = days.findIndex((day) => day.toDateString() === new Date(nowMs).toDateString());
  const mobileIndex = mobileDay ?? (todayIndex >= 0 && dayTotals[todayIndex].count ? todayIndex : firstBusyDay >= 0 ? firstBusyDay : Math.max(todayIndex, 0));
  const mobileShifts = visibleShifts.filter((shift) => new Date(shift.starts_at).toDateString() === days[mobileIndex].toDateString()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";''')
rep('`${health.issues.length} ${tx("aandachtspunten", "issues")}`','`${health.issues.length} ${health.issues.length===1?tx("aandachtspunt","issue"):tx("aandachtspunten", "issues")}`')
rep('open: rows.filter((row) => !row.staff_id).length };','open: rows.filter((row) => !row.staff_id).length, count: rows.length };')
rep('  const [tab, setTab] = useState<"roster" | "actions" | "insights" | "hours">("roster");','  const [tab, setTab] = useState<"roster" | "actions" | "insights" | "hours">("roster");\n  const [mobileDay, setMobileDay] = useState<number | null>(null);\n  const [nowMs] = useState(() => Date.now());')
open(path,"w",encoding="utf-8").write(src); print("ok2")
css='''.roster-head>div.quiet{padding:12px 6px;text-align:center}.roster-head>div.quiet small{display:none}.shift-cell.quiet{padding:4px;background:#fafbf9!important}.shift-cell.quiet .avail-chip{display:none}.roster-foot>div.quiet{padding:10px 4px;text-align:center}.roster-foot>div.quiet small{display:none}.roster-product .blocked{background:#fff3dc;color:#754c12;border-color:#f0cf95}.context-detail li small{flex-basis:100%;color:var(--roster-muted)}.context-detail li{flex-wrap:wrap}
.mobile-day-chips{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px}.mobile-day-chips button{display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 0;min-height:0;border-radius:10px;border:1px solid #dfe5dc;background:#fff;color:#18231c}.mobile-day-chips button small{font-size:10px;text-transform:lowercase;color:#69736b}.mobile-day-chips button b{font-size:14px}.mobile-day-chips button em{font-style:normal;font-size:10px;height:12px;color:#2f6b3f}.mobile-day-chips button.active{background:#173b2a;border-color:#173b2a;color:#fff}.mobile-day-chips button.active small,.mobile-day-chips button.active em{color:#d5f5a0}
'''
open("app/real-app.css","a",encoding="utf-8").write(css); print("css")
