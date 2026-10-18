"use client";

import { useState } from "react";
import { addDays, deadlineLabel, mondayOf, nightOf, nightsLabel } from "../lib/planning/nights";

type Colleague = { name: string; role_name: string; starts_at: string; ends_at: string };
type MyShift = { id: string; venue_id: string; starts_at: string; ends_at: string; break_minutes: number; status: string; role_name: string; department_kind: string; colleagues: Colleague[] };
type Answer = "available" | "preferably_not" | "unavailable";
export type MyRequest = { id: string; venue_id: string; nights: string[]; deadline_at: string; status: string; answers: Record<string, string> };

const CHOICES: { value: Answer; label: string; en: string }[] = [
  { value: "available", label: "Kan", en: "Can" },
  { value: "preferably_not", label: "Liever niet", en: "Rather not" },
  { value: "unavailable", label: "Kan niet", en: "Can't" },
];
const parse = (date: string) => new Date(`${date}T12:00:00Z`);

export function MyRoster({
  organisationId,
  venueName,
  timezone,
  firstName,
  shifts,
  requests,
  locale,
}: {
  organisationId: string;
  venueName: string;
  timezone: string;
  firstName: string;
  shifts: MyShift[];
  requests: MyRequest[];
  locale: "nl" | "en";
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const intl = locale === "nl" ? "nl-NL" : "en-GB";
  const time = (iso: string) => new Date(iso).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const dayName = (date: string) => parse(date).toLocaleDateString(intl, { weekday: "long", timeZone: "UTC" });
  const dateText = (date: string) => parse(date).toLocaleDateString(intl, { day: "numeric", month: "long", timeZone: "UTC" });
  const [now] = useState(() => Date.now());
  const today = nightOf(new Date(now).toISOString(), timezone);
  const [week, setWeek] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>(() => Object.fromEntries(requests.map((request) => [request.id, Object.fromEntries(Object.entries(request.answers).map(([date, value]) => [date, (value === "preferred" ? "available" : value) as Answer]))])));
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const upcoming = shifts.filter((shift) => new Date(shift.ends_at).getTime() > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = upcoming[0];
  const monday = addDays(mondayOf(today), week * 7);
  const weekShifts = shifts.filter((shift) => { const night = nightOf(shift.starts_at, timezone); return night >= monday && night < addDays(monday, 7); }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const weekTitle = week === 0 ? tx("Deze week", "This week") : week === 1 ? tx("Volgende week", "Next week") : tx(`Over ${week} weken`, `In ${week} weeks`);

  async function choose(request: MyRequest, night: string, value: Answer) {
    const before = answers[request.id] ?? {};
    const nextAnswers = { ...before, [night]: value };
    setAnswers((current) => ({ ...current, [request.id]: nextAnswers }));
    setSaving(`${request.id}|${night}`);
    setError("");
    try {
      const response = await fetch("/api/workforce/my-availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, requestId: request.id, entries: Object.entries(nextAnswers).map(([date, availability]) => ({ date, availability })) }) });
      const body = (await response.json().catch(() => ({}))) as { errorCode?: string };
      if (!response.ok) throw new Error(body.errorCode);
      setSaved(request.id);
    } catch (caught) {
      setAnswers((current) => ({ ...current, [request.id]: before }));
      setError(caught instanceof Error && caught.message === "DEADLINE_PASSED" ? tx("De deadline is voorbij. Laat het je planner zelf weten.", "The deadline has passed. Tell your planner directly.") : tx("Opslaan lukte niet. Check je verbinding en tik nog een keer.", "Couldn't save. Check your connection and tap again."));
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="me">
      <header className="me-hello">
        <h1>{tx("Hoi", "Hi")} {firstName}</h1>
        <p>
          {next
            ? <>{tx("Je volgende dienst bij", "Your next shift at")} {venueName}: <b>{dayName(nightOf(next.starts_at, timezone))} {dateText(nightOf(next.starts_at, timezone))}, {time(next.starts_at)} – {time(next.ends_at)}</b>.</>
            : tx(`Je staat nog niet ingepland bij ${venueName}.`, `You're not on the ${venueName} roster yet.`)}
        </p>
      </header>

      {requests.map((request) => {
        const mine = answers[request.id] ?? {};
        const nights = [...request.nights].sort();
        const done = nights.every((night) => mine[night]);
        return (
          <section className="me-ask" key={request.id} aria-labelledby={`ask-${request.id}`}>
            <h2 id={`ask-${request.id}`}>{done ? tx("Dank je!", "Thanks!") : tx(`Kun je ${nightsLabel(nights)}?`, `Can you work ${nightsLabel(nights, "en")}?`)}</h2>
            <p>{done ? tx(`Je planner ziet je antwoorden. Aanpassen kan tot ${deadlineLabel(request.deadline_at, timezone)}.`, `Your planner can see your answers. You can change them until ${deadlineLabel(request.deadline_at, timezone, "en")}.`) : tx(`Laat het weten vóór ${deadlineLabel(request.deadline_at, timezone)}.`, `Let us know before ${deadlineLabel(request.deadline_at, timezone, "en")}.`)}</p>
            <ul>
              {nights.map((night) => (
                <li key={night}>
                  <div className="me-night"><b>{dayName(night)}</b><span>{dateText(night)}</span></div>
                  <div className="me-choice" role="group" aria-label={`${dayName(night)} ${dateText(night)}`}>
                    {CHOICES.map((choice) => (
                      <button key={choice.value} type="button" aria-pressed={mine[night] === choice.value} className={`c-${choice.value}${mine[night] === choice.value ? " on" : ""}`} disabled={saving === `${request.id}|${night}`} onClick={() => void choose(request, night, choice.value)}>
                        {tx(choice.label, choice.en)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {saved === request.id && !error ? <small className="me-saved" role="status">{tx("Opgeslagen", "Saved")}</small> : null}
          </section>
        );
      })}
      {error ? <p className="me-error" role="alert">{error}</p> : null}

      <section className="me-week" aria-labelledby="me-week-title">
        <div className="me-week-head">
          <h2 id="me-week-title">{weekTitle}</h2>
          <div className="me-week-nav">
            <button type="button" aria-label={tx("Vorige week", "Previous week")} disabled={week <= 0} onClick={() => setWeek(week - 1)}>‹</button>
            <button type="button" aria-label={tx("Volgende week", "Next week")} disabled={week >= 4} onClick={() => setWeek(week + 1)}>›</button>
          </div>
        </div>
        {weekShifts.length ? (
          <ul className="me-shifts">
            {weekShifts.map((shift) => {
              const night = nightOf(shift.starts_at, timezone);
              const others = shift.colleagues.map((colleague) => (colleague.role_name === "DJ" ? `DJ ${colleague.name}` : colleague.name));
              return (
                <li key={shift.id} className={night < today ? "is-past" : ""}>
                  <div className="me-shift-day"><b>{dayName(night)}</b><span>{dateText(night)}</span></div>
                  <div className="me-shift-time">{time(shift.starts_at)} – {time(shift.ends_at)}<small>{shift.role_name}</small></div>
                  {others.length ? <p>{tx("Met", "With")} {others.length > 1 ? `${others.slice(0, -1).join(", ")} ${tx("en", "and")} ${others.at(-1)}` : others[0]}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="me-empty">{tx("Geen diensten deze week.", "No shifts this week.")}{week === 0 && !requests.length ? tx(" Als je planner iets vraagt, zie je het hier.", " When your planner asks you something, it shows up here.") : ""}</p>
        )}
      </section>
    </div>
  );
}
