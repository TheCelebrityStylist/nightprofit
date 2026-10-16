"use client";
import { useMemo, useState } from "react";
import { utcToZonedInput, zonedInputToUtc } from "../../../lib/workforce/timezone";

type State = "unknown" | "available" | "preferred" | "preferably_not" | "unavailable";
type Entry = { day: string; startsAt: string; endsAt: string; availability: State; note: string };
type PersistedEntry = {
  starts_at: string;
  ends_at: string;
  availability: Exclude<State, "unknown">;
  note?: string | null;
};

export function AvailabilityResponse({
  token,
  periodStart,
  periodEnd,
  deadlineAt,
  venueName,
  venueTimezone,
  employeeName,
  preferredLanguage,
  initialEntries,
}: {
  token: string;
  periodStart: string;
  periodEnd: string;
  deadlineAt: string;
  venueName: string;
  venueTimezone: string;
  employeeName: string;
  preferredLanguage: "nl" | "en";
  initialEntries: PersistedEntry[];
}) {
  const nl = preferredLanguage !== "en",
    tx = (nlCopy: string, enCopy: string) => (nl ? nlCopy : enCopy),
    locale = nl ? "nl-NL" : "en-GB";
  const days = useMemo(() => {
    const result: string[] = [];
    const firstDay = utcToZonedInput(periodStart, venueTimezone).slice(0, 10);
    const lastDay = utcToZonedInput(periodEnd, venueTimezone).slice(0, 10);
    const cursor = new Date(`${firstDay}T12:00:00Z`);
    while (cursor.toISOString().slice(0, 10) < lastDay && result.length < 31) {
      result.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }, [periodStart, periodEnd, venueTimezone]);
  const [entries, setEntries] = useState<Entry[]>(() =>
    days.flatMap((day) => {
      const savedRows = initialEntries.filter(
        (row) => utcToZonedInput(row.starts_at, venueTimezone).slice(0, 10) === day,
      );
      const next = new Date(`${day}T12:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      if(savedRows.length)return savedRows.map(saved=>({day,startsAt:utcToZonedInput(saved.starts_at,venueTimezone),endsAt:utcToZonedInput(saved.ends_at,venueTimezone),availability:saved.availability,note:saved.note??""}));
      return [{
        day,
        startsAt: `${day}T18:00`,
        endsAt: `${next.toISOString().slice(0, 10)}T05:00`,
        availability: "unknown" as State,
        note: "",
      }];
    }),
  );
  const [review, setReview] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const update = (index: number, patch: Partial<Entry>) =>
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  const addWindow=(index:number)=>setEntries(current=>{const source=current[index],end=new Date(zonedInputToUtc(source.endsAt,venueTimezone)),nextEnd=new Date(end.getTime()+2*3600000);return [...current.slice(0,index+1),{...source,startsAt:utcToZonedInput(end.toISOString(),venueTimezone),endsAt:utcToZonedInput(nextEnd.toISOString(),venueTimezone),note:""},...current.slice(index+1)]});
  const removeWindow=(index:number)=>setEntries(current=>current.filter((_,entryIndex)=>entryIndex!==index));
  const copyPreviousDay = (index: number) => {
    const previous = entries.slice(0,index).reverse().find(entry=>entry.day!==entries[index].day);
    if(!previous)return;
    const start = `${entries[index].day}${previous.startsAt.slice(10)}`;
    const duration =
      new Date(zonedInputToUtc(previous.endsAt, venueTimezone)).getTime() -
      new Date(zonedInputToUtc(previous.startsAt, venueTimezone)).getTime();
    const end = utcToZonedInput(
      new Date(new Date(zonedInputToUtc(start, venueTimezone)).getTime() + duration).toISOString(),
      venueTimezone,
    );
    update(index, {
      availability: previous.availability,
      startsAt: start,
      endsAt: end,
      note: previous.note,
    });
  };
  const applyFirstAnsweredToUnresolved = () => {
    const source = entries.find((entry) => entry.availability !== "unknown");
    if (!source) return;
    setEntries((current) => current.map((entry) => {
      if (entry.availability !== "unknown") return entry;
      const start = `${entry.day}${source.startsAt.slice(10)}`;
      const duration = new Date(zonedInputToUtc(source.endsAt, venueTimezone)).getTime() - new Date(zonedInputToUtc(source.startsAt, venueTimezone)).getTime();
      const end = utcToZonedInput(new Date(new Date(zonedInputToUtc(start, venueTimezone)).getTime()+duration).toISOString(),venueTimezone);
      return {...entry,availability:source.availability,startsAt:start,endsAt:end,note:source.note};
    }));
  };
  async function save(final: boolean) {
    const known = entries.filter((entry) => entry.availability !== "unknown");
    if (final && known.length !== entries.length) {
      setError(tx("Beantwoord eerst iedere servicedag.", "Answer every service day first."));
      setReview(false);
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch("/api/availability/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        periodStart,
        periodEnd,
        final,
        entries: known.map(({ startsAt, endsAt, availability, note }) => ({
          startsAt: zonedInputToUtc(startsAt, venueTimezone),
          endsAt: zonedInputToUtc(endsAt, venueTimezone),
          availability,
          note,
        })),
      }),
    });
    const result = (await response.json()) as { message?: string };
    setPending(false);
    if (!response.ok) {
      setError(
        tx(
          "Opslaan is niet gelukt. Controleer de tijden en probeer opnieuw.",
          "Saving failed. Check the times and try again.",
        ),
      );
      return;
    }
    if (final) setMessage(result.message || tx("Bevestigd.", "Confirmed."));
    else setMessage(result.message || tx("Gedeeltelijk opgeslagen.", "Partially saved."));
  }
  if (message && review)
    return (
      <main className="availability-page">
        <section className="availability-card success-card">
          <div className="logo">N</div>
          <p className="eyebrow">{tx("BEVESTIGD", "CONFIRMED")}</p>
          <h1>{tx("Beschikbaarheid ontvangen", "Availability received")}</h1>
          <p>
            {message}{" "}
            {tx(
              "Je kunt tot de deadline via dezelfde link wijzigingen doorgeven.",
              "You can update your response through the same link until the deadline.",
            )}
          </p>
        </section>
      </main>
    );
  return (
    <main className="availability-page">
      <section className="availability-card">
        <div className="logo">N</div>
        <p className="eyebrow">NIGHTPROFIT · {venueName}</p>
        <h1>
          {review
            ? tx("Controleer je week", "Review your week")
            : tx(
                `Hoi ${employeeName}, wanneer kun je werken?`,
                `Hi ${employeeName}, when can you work?`,
              )}
        </h1>
        <p>
          {tx(
            "Een nachtelijke dienst blijft bij de dag waarop de service begint, bijvoorbeeld vrijdag 22:00–zaterdag 05:00.",
            "An overnight shift stays with the service day it starts on, for example Friday 22:00–Saturday 05:00.",
          )}
        </p>
        <p>
          <b>{tx("Deadline", "Deadline")}:</b>{" "}
          {new Date(deadlineAt).toLocaleString(locale, {
            timeZone: venueTimezone,
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        {!review ? (
          <><div className="availability-quick-actions" aria-label={tx("Snelle invoer","Quick entry")}><b>{entries.filter(entry=>entry.availability==="unknown").length} {tx("dagen open","days unresolved")}</b><button type="button" onClick={()=>setEntries(current=>current.map(entry=>({...entry,availability:"available"})))}>{tx("Beschikbaar tijdens alle openingstijden","Available for all opening hours")}</button><button type="button" disabled={!entries.some(entry=>entry.availability!=="unknown")} onClick={applyFirstAnsweredToUnresolved}>{tx("Pas eerste antwoord toe op open dagen","Apply first answer to unresolved days")}</button><button type="button" onClick={()=>setEntries(current=>current.map(entry=>({...entry,availability:"unavailable"})))}>{tx("Alles niet beschikbaar","Mark all unavailable")}</button></div><div className="availability-days">
            {entries.map((entry, index) => (
              <fieldset key={`${entry.day}-${index}`}>
                <legend>
                  {new Date(`${entry.day}T12:00:00Z`).toLocaleDateString(locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}{" "}
                  {tx("service", "service")}
                </legend>
                <label>
                  {tx("Status", "Status")}
                  <select
                    value={entry.availability}
                    onChange={(event) =>
                      update(index, { availability: event.target.value as State })
                    }
                  >
                    <option value="unknown">{tx("Nog niet beantwoord", "Not answered yet")}</option>
                    <option value="available">{tx("Beschikbaar", "Available")}</option>
                    <option value="preferred">{tx("Bij voorkeur", "Preferred")}</option>
                    <option value="preferably_not">{tx("Liever niet", "Preferably not")}</option>
                    <option value="unavailable">{tx("Niet beschikbaar", "Unavailable")}</option>
                  </select>
                </label>
                <label>
                  {tx("Van", "From")}
                  <input
                    type="datetime-local"
                    value={entry.startsAt.slice(0, 16)}
                    disabled={entry.availability === "unknown"}
                    onChange={(event) => update(index, { startsAt: event.target.value })}
                  />
                </label>
                <label>
                  {tx("Tot", "Until")}
                  <input
                    type="datetime-local"
                    value={entry.endsAt.slice(0, 16)}
                    disabled={entry.availability === "unknown"}
                    onChange={(event) => update(index, { endsAt: event.target.value })}
                  />
                </label>
                <label className="wide">
                  {tx("Korte toelichting (optioneel)", "Short note (optional)")}
                  <input
                    value={entry.note}
                    maxLength={500}
                    onChange={(event) => update(index, { note: event.target.value })}
                  />
                </label>
                {entries.slice(0,index).some(candidate=>candidate.day!==entry.day) ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => copyPreviousDay(index)}
                  >
                    {tx("Kopieer vorige dag", "Copy previous day")}
                  </button>
                ) : null}
                <button type="button" className="ghost" disabled={entry.availability==="unknown"} onClick={()=>addWindow(index)}>{tx("Tijdvenster toevoegen","Add time window")}</button>
                {entries.filter(candidate=>candidate.day===entry.day).length>1?<button type="button" className="ghost" onClick={()=>removeWindow(index)}>{tx("Tijdvenster verwijderen","Remove time window")}</button>:null}
              </fieldset>
            ))}
          </div></>
        ) : (
          <div className="availability-review">
            {entries.map((entry,index) => (
              <div className={entry.availability === "unknown" ? "unanswered" : ""} key={`${entry.day}-${index}`}>
                <b>
                  {new Date(`${entry.day}T12:00:00Z`).toLocaleDateString(locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </b>
                <span>
                  {entry.availability === "unknown"
                    ? tx("Niet beantwoord", "Not answered")
                    : `${entry.availability} · ${new Date(zonedInputToUtc(entry.startsAt, venueTimezone)).toLocaleString(locale, { timeZone: venueTimezone, weekday: "short", hour: "2-digit", minute: "2-digit" })}–${new Date(zonedInputToUtc(entry.endsAt, venueTimezone)).toLocaleString(locale, { timeZone: venueTimezone, weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
                </span>
              </div>
            ))}
          </div>
        )}
        {message && !review ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="action-bar">
          {review ? (
            <button className="ghost" type="button" onClick={() => setReview(false)}>
              {tx("Terug", "Back")}
            </button>
          ) : (
            <button
              className="secondary"
              type="button"
              disabled={pending || !entries.some((entry) => entry.availability !== "unknown")}
              onClick={() => void save(false)}
            >
              {pending
                ? tx("Opslaan…", "Saving…")
                : tx("Gedeeltelijk opslaan", "Save partial response")}
            </button>
          )}
          <button
            className="primary"
            type="button"
            disabled={pending}
            onClick={() => (review ? void save(true) : setReview(true))}
          >
            {pending
              ? tx("Opslaan…", "Saving…")
              : review
                ? tx("Definitief versturen", "Submit response")
                : tx("Week controleren", "Review week")}
          </button>
        </div>
      </section>
    </main>
  );
}
