import sys
path=sys.argv[1]; src=open(path,encoding="utf-8").read()
def rep(old,new,count=1):
    global src
    n=src.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:90]!r}")
    src=src.replace(old,new)
rep('''    const planned = visibleShifts.filter(
      (row) => new Date(row.starts_at) >= day && new Date(row.starts_at) < end,
    ).length;''','''    const planned = visibleShifts.filter(
      (row) => row.staff_id && new Date(row.starts_at) >= day && new Date(row.starts_at) < end,
    ).length;''')
rep('''        <span><small>{tx("Omzetprognose", "Revenue forecast")}</small>''','''        {activeLane==="dj"?<>
        <span><small>{tx("DJ's ingepland", "DJs booked")}</small><b>{coverage.reduce((sum,row)=>sum+row.planned,0)} / {coverage.reduce((sum,row)=>sum+row.required,0)}</b></span>
        <span><small>{tx("DJ-uren", "DJ hours")}</small><b>{Math.round(visibleShifts.reduce((sum,row)=>sum+shiftMinutes(row),0)/6)/10} u</b></span>
        <span><small>{tx("DJ-kosten", "DJ cost")}</small><b>{currency(visibleShifts.reduce((sum,row)=>sum+(BigInt(row.hourly_cost_minor)*BigInt(shiftMinutes(row))+30n)/60n,0n))}</b></span>
        </>:<>
        <span><small>{tx("Omzetprognose", "Revenue forecast")}</small>''')
rep('''<b>{visibleIntervals.length ? `${coverageIntervals.reduce((sum,row)=>sum+row.plannedStaff,0)} / ${coverageIntervals.reduce((sum,row)=>sum+row.requiredStaff,0)}` : tx("Forecast ontbreekt", "Forecast missing")}</b></span>''',
    '''<b>{standardWeekReady ? `${coverage.reduce((sum,row)=>sum+row.planned,0)} / ${coverage.reduce((sum,row)=>sum+row.required,0)}` : visibleIntervals.length ? `${coverageIntervals.reduce((sum,row)=>sum+row.plannedStaff,0)} / ${coverageIntervals.reduce((sum,row)=>sum+row.requiredStaff,0)}` : tx("Forecast ontbreekt", "Forecast missing")}</b></span>''')
rep('''        <span><small>{tx("Loonkosten", "Labor cost")}</small><b>{visibleShifts.length ? currency(labor) : tx("Nog niet berekend", "Not calculated yet")}</b></span>
        <span><small>{tx("Loonpercentage", "Labor percentage")}</small><b>{visibleIntervals.length && visibleShifts.length ? percent : "—"}</b></span>''',
    '''        <span><small>{hasDjLane?tx("Loonkosten incl. DJ", "Labor cost incl. DJ"):tx("Loonkosten", "Labor cost")}</small><b>{weekShifts.length ? currency(labor) : tx("Nog niet berekend", "Not calculated yet")}</b></span>
        <span><small>{tx("Loonpercentage", "Labor percentage")}</small><b>{visibleIntervals.length && weekShifts.length ? percent : "—"}</b></span>
        </>}''')
rep('''              {coverageIntervals.filter(interval=>interval.gap>0''','''              {activeLane==="dj"?null:coverageIntervals.filter(interval=>interval.gap>0''')
open(path,"w",encoding="utf-8").write(src); print("ok4")
