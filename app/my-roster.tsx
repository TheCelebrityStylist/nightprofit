"use client";

import { useMemo, useState } from "react";

type Colleague = { name: string; role_name: string; starts_at: string; ends_at: string };
type MyShift = { id: string; venue_id: string; starts_at: string; ends_at: string; break_minutes: number; status: string; role_name: string; department_kind: string; colleagues: Colleague[] };
type AvailabilityRow = { starts_at: string; availability: string };
type State = "available" | "preferably_not" | "unavailable";

const dayMs = 86400000;
const mondayOf = (value: Date) => { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date; };
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const isoWeekday = (date: Date) => ((date.getDay() + 6) % 7) + 1;

export function MyRoster({
  organisationId,
  venueId,
  venueName,
  timezone,
  firstName,
  shifts,
  availability,
  openWeekdays,
  locale,
}: {
  organisationId: string;
  venueId: string;
  venueName: string;
  timezone: string;
  firstName: string;
  shifts: MyShift[];
  availability: AvailabilityRow[];
  openWeekdays: number[];
  locale: "nl" | "en";
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const intl = locale === "nl" ? "nl-NL" : "en-GB";
  const time = (value: string) => new Date(value).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const dayLabel = (value: Date | string, long = true) => new Date(value).toLocaleDateString(intl, { weekday: long ? "long" : "short", day: "numeric", month: "short", timeZone: timezone });
  const [now] = useState(() => Date.now());
  const thisMonday = useMemo(() => mondayOf(new Date(now)), [now]);
  const [week, setWeek] = useState(0);
  const [showAllDays, setShowAllDays] = useState(openWeekdays.length === 0);
  const [answers, setAnswers] = useState<Record<string, State | "">>(() => {
    const result: Record<string, State | ""> = {};
    for (const row of availability) {
      const start = new Date(row.starts_at);
      const key = localDate(new Date(start.getTime() - (start.getHours() < 12 ? dayMs : 0)));
      result[key] = row.availability === "preferred" ? "available" : (row.availability as State);
    }
    return result;
  });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const upcoming = shifts.filter((shift) => new Date(shift.ends_at).getTime() > now);
  const next = upcoming[0];
  const weekStart = new Date(thisMonday.getTime() + week * 7 * dayMs);
  const weekEnd = new Date(weekStart.getTime() + 7 * dayMs);
  const weekShifts = shifts.filter((shift) => new Date(shift.starts_at) >= weekStart && new Date(shift.starts_at) < weekEnd);
  const weekMinutes = weekShifts.reduce((sum, shift) => sum + Math.max(0, (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 60000 - shift.break_minutes), 0);
  const weekTitle = week === 0 ? tx("Deze week", "This week") : week === 1 ? tx("Volgende week", "Next week") : tx(`Over ${week} weken`, `In ${week} weeks`);

  const nights = Array.from({ length: 35 }, (_, index) => new Date(thisMonday.getTime() + index * dayMs)).filter((day) => day.getTime() + dayMs > now);
  const shownNights = showAllDays ? nights : nights.filter((day) => openWeekdays.includes(isoWeekday(day)));
  const unanswered = nights.filter((day) => openWeekdays.includes(isoWeekday(day)) && !answers[localDate(day)]).length;

  async function answer(day: Date, state: State) {
    const key = localDate(day);
    const nextState = answers[key] === state ? "" : state;
    setAnswers((current) => ({ ...current, [key]: nextState }));
    setSaving(key);
    setError("");
    try {
      const response = await fetch("/api/workforce/my-availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, venueId, entries: [{ date: key, availability: nextState }] }) });
      if (!response.ok) throw new Error();
    } catch {
      setAnswers((current) => ({ ...current, [key]: answers[key] ?? "" }));
      setError(tx("Opslaan lukte niet. Check je verbinding en probeer opnieuw.", "Couldn't save. Check your connection and try again."));
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="my-roster">
      <section className="my-next">
        <span className="eyebrow">{venueName || tx("JOUW ROOSTER", "YOUR ROSTER")}</span>
        <h2>{tx(`Hoi ${firstName}`, `Hi ${firstName}`)}</h2>
        {next ? (
          <article className="my-next-card">
            <small>{tx("Je volgende dienst", "Your next shift")}</small>
            <b>{dayLabel(next.starts_at)}</b>
            <strong>{time(next.starts_at)}–{time(next.ends_at)}</strong>
            <span>{next.role_name}{next.colleagues.length ? ` · ${tx("met", "with")} ${next.colleagues.slice(0, 4).map((person) => person.name).join(", ")}${next.colleagues.length > 4 ? ` +${next.colleagues.length - 4}` : ""}` : ""}</span>
          </article>
        ) : (
          <p className="my-empty">{tx("Nog geen gepubliceerde diensten. Geef hieronder door wanneer je kunt.", "No published shifts yet. Let us know below when you can work.")}</p>
        )}
      </section>

      <section className="my-week">
        <header>
          <button type="button" aria-label={tx("Vorige week", "Previous week")} disabled={week === 0} onClick={() => setWeek((value) => Math.max(0, value - 1))}>←</button>
          <div><b>{weekTitle}</b><small>{dayLabel(weekStart, false)} – {dayLabel(new Date(weekEnd.getTime() - dayMs), false)}{weekShifts.length ? ` · ${Math.round(weekMinutes / 6) / 10} ${tx("uur", "h")}` : ""}</small></div>
          <button type="button" aria-label={tx("Volgende week", "Next week")} disabled={week >= 4} onClick={() => setWeek((value) => Math.min(4, value + 1))}>→</button>
        </header>
        {weekShifts.length ? (
          <ul>
            {weekShifts.map((shift) => (
              <li key={shift.id}>
                <div className="my-shift-day"><b>{new Date(shift.starts_at).toLocaleDateString(intl, { weekday: "short", timeZone: timezone })}</b><span>{new Date(shift.starts_at).toLocaleDateString(intl, { day: "numeric", timeZone: timezone })}</span></div>
                <div className="my-shift-main">
                  <strong>{time(shift.starts_at)}–{time(shift.ends_at)}</strong>
                  <small>{shift.role_name}</small>
                  {shift.colleagues.length ? <p>{tx("Met", "With")} {shift.colleagues.map((person) => person.name).join(", ")}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="my-empty">{week === 0 ? tx("Deze week sta je niet ingeroosterd.", "You're not scheduled this week.") : tx("Nog niets gepubliceerd voor deze week.", "Nothing published for this week yet.")}</p>
        )}
      </section>

      <section className="my-availability">
        <header>
          <div><b>{tx("Wanneer kun je werken?", "When can you work?")}</b><small>{unanswered ? tx(`${unanswered} open avonden nog niet ingevuld`, `${unanswered} opening nights not answered yet`) : tx("Alles ingevuld. Wijzigen kan altijd.", "All answered. You can change it any time.")}</small></div>
          {openWeekdays.length ? <button type="button" className="ghost" onClick={() => setShowAllDays((value) => !value)}>{showAllDays ? tx("Alleen open avonden", "Opening nights only") : tx("Alle dagen", "All days")}</button> : null}
        </header>
        {error ? <p className="my-error" role="alert">{error}</p> : null}
        <ul>
          {shownNights.map((day) => {
            const key = localDate(day);
            const value = answers[key] ?? "";
            return (
              <li key={key} className={isoWeekday(day) === 1 ? "week-break" : ""}>
                <span className="my-night">{day.toLocaleDateString(intl, { weekday: "short", day: "numeric", month: "short" })}</span>
                <div className="my-choice" role="group" aria-label={day.toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "long" })}>
                  {([["available", tx("Kan", "Can")], ["preferably_not", tx("Liever niet", "Rather not")], ["unavailable", tx("Kan niet", "Can't")]] as const).map(([state, text]) => (
                    <button type="button" key={state} aria-pressed={value === state} className={value === state ? `on ${state}` : ""} disabled={saving === key} onClick={() => void answer(day, state)}>{text}</button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
