import sys
path=sys.argv[1]; src=open(path,encoding="utf-8").read()
def rep(old,new,count=1):
    global src
    n=src.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:90]!r}")
    src=src.replace(old,new)

# Availability belongs to the night it starts on (an 18:00-05:00 entry is one night, not two days).
rep('''    const states = weekAvailability.filter((row) => row.staff_id === staffId && new Date(row.starts_at) < end && new Date(row.ends_at) > day).map((row) => row.availability);''',
    '''    const states = weekAvailability.filter((row) => row.staff_id === staffId && new Date(row.starts_at) >= day && new Date(row.starts_at) < end).map((row) => row.availability);''')

# Candidate list for one-tap assigning.
rep('''  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";''','''  const candidatesFor = (target: Shift) => {
    const night = new Date(target.starts_at); night.setHours(0, 0, 0, 0);
    const targetLane = laneOfDepartment(target.department_id);
    const order: Record<string, number> = { preferred: 0, available: 1, unknown: 2, preferably_not: 3, unavailable: 4 };
    return activeStaff
      .filter((person) => targetLane === "dj" ? roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj") : !roles.some((role) => role.name === person.role_name && laneOfRole(role.id) === "dj"))
      .map((person) => {
        const absent = absences.some((row) => row.staff_id === person.id && row.status !== "rejected" && new Date(row.starts_at) < new Date(target.ends_at) && new Date(row.ends_at) > new Date(target.starts_at));
        const busyThatNight = weekShifts.some((row) => row.id !== target.id && row.staff_id === person.id && new Date(row.starts_at) < new Date(target.ends_at) && new Date(row.ends_at) > new Date(target.starts_at));
        const state = absent ? "unavailable" : availabilityOn(person.id, night) ?? "unknown";
        const minutes = weekShifts.filter((row) => row.staff_id === person.id).reduce((sum, row) => sum + shiftMinutes(row), 0);
        return { person, state, absent, busyThatNight, minutes, current: target.staff_id === person.id };
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || Number(a.busyThatNight) - Number(b.busyThatNight) || order[a.state] - order[b.state] || a.minutes - b.minutes || a.person.full_name.localeCompare(b.person.full_name));
  };
  const assignShift = (target: Shift, staffId: string | null) => {
    const next = { ...target, staff_id: staffId, status: "draft" };
    void mutate("shift_update", { ...shiftValues(target), staffId: staffId ?? "open" }, () => {
      setShifts((current) => current.map((item) => (item.id === target.id ? { ...next, revision: (target.revision ?? 1) + 1 } : item)));
      setSelected(null);
      setPanel(null);
    });
  };
  const venueName = venues.find((row) => row.id === venueId)?.name ?? "";''')
rep('''            ) : panel === "shift" && selected ? (
              <ShiftEditor''','''            ) : panel === "shift" && selected ? (
              <>
              {selected.status === "draft" ? <QuickAssign row={selected} candidates={candidatesFor(selected)} busy={busy} locale={locale} label={availabilityLabel} timeLabel={`${zonedTime(selected.starts_at, { weekday: "long", day: "numeric", month: "short" })} · ${zonedTime(selected.starts_at, { hour: "2-digit", minute: "2-digit" })}–${zonedTime(selected.ends_at, { hour: "2-digit", minute: "2-digit" })}`} assign={(staffId) => assignShift(selected, staffId)} /> : null}
              <ShiftEditor''')
rep('''                cancel={() =>
                  void mutate(
                    "shift_cancel",
                    { venueId: selected.venue_id, shiftId: selected.id },
                    () => {
                      setShifts((current) => current.filter((item) => item.id !== selected.id));
                      setPanel(null);
                    },
                  )
                }
              />''','''                cancel={() =>
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
              </>''')
rep('''function MissedTimePanel(''','''type Candidate = { person: Staff; state: string; absent: boolean; busyThatNight: boolean; minutes: number; current: boolean };
function QuickAssign({ row, candidates, busy, locale, label, timeLabel, assign }: { row: Shift; candidates: Candidate[]; busy: boolean; locale: string; label: (state: string) => string; timeLabel: string; assign: (staffId: string | null) => void }) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [showAll, setShowAll] = useState(false);
  const good = candidates.filter((item) => !item.busyThatNight && !item.absent && item.state !== "unavailable");
  const rest = candidates.filter((item) => !good.includes(item));
  const visible = showAll ? candidates : good;
  return (
    <section className="quick-assign" aria-label={tx("Wie werkt deze dienst?", "Who works this shift?")}>
      <span className="eyebrow">{tx("WIE WERKT?", "WHO WORKS?")}</span>
      <h3>{timeLabel}</h3>
      <ul>
        {visible.map(({ person, state, busyThatNight, absent, minutes, current }) => (
          <li key={person.id}>
            <button type="button" className={current ? "current" : ""} disabled={busy || current} onClick={() => assign(person.id)}>
              <span className="avatar">{person.full_name.slice(0, 2).toUpperCase()}</span>
              <span className="who"><b>{person.full_name}</b><small>{Math.round(minutes / 6) / 10} {tx("u deze week", "h this week")}{person.contracted_minutes_week ? ` / ${Math.round(person.contracted_minutes_week / 60)}` : ""}</small></span>
              <em className={`avail-chip ${current ? "preferred" : busyThatNight || absent ? "unavailable" : state}`}>{current ? tx("Ingepland", "Assigned") : absent ? tx("Afwezig", "Absent") : busyThatNight ? tx("Werkt al", "Already working") : state === "unknown" ? tx("Onbekend", "Unknown") : label(state)}</em>
            </button>
          </li>
        ))}
      </ul>
      {!good.length && !showAll ? <p className="quiet">{tx("Niemand heeft aangegeven dat hij kan.", "Nobody said they can work.")}</p> : null}
      <div className="quick-assign-foot">
        {rest.length ? <button type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? tx("Alleen beschikbaar", "Available only") : tx(`Toon iedereen (${rest.length} meer)`, `Show everyone (${rest.length} more)`)}</button> : null}
        {row.staff_id ? <button type="button" disabled={busy} onClick={() => assign(null)}>{tx("Maak open dienst", "Make open shift")}</button> : null}
      </div>
    </section>
  );
}

function MissedTimePanel(''')
rep('<button type="button" className="mobile-shift-card" key={shift.id}','<button type="button" className={`mobile-shift-card ${shift.staff_id ? "" : "open-shift"}`} key={shift.id}')
open(path,"w",encoding="utf-8").write(src); print("ok7")
