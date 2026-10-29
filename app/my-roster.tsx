"use client";

import { useEffect, useState } from "react";
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

      <PhoneNotifications organisationId={organisationId} locale={locale} />
      <CalendarLink organisationId={organisationId} locale={locale} />
    </div>
  );
}

// ---------- shifts in your own calendar ----------
function CalendarLink({ organisationId, locale }: { organisationId: string; locale: "nl" | "en" }) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [links, setLinks] = useState<{ https: string; webcal: string; google: string } | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");

  async function create() {
    setState("busy");
    try {
      const response = await fetch("/api/workforce/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId }) });
      if (!response.ok) throw new Error();
      setLinks((await response.json()) as { https: string; webcal: string; google: string });
      setState("idle");
    } catch { setState("error"); }
  }

  return (
    <section className="me-cal" aria-labelledby="me-cal-title">
      <h2 id="me-cal-title">{tx("Rooster in je agenda", "Roster in your calendar")}</h2>
      {!links ? (
        <>
          <p>{tx("Eén keer koppelen. Daarna staan je diensten vanzelf in je agenda, en wijzigingen ook.", "Connect once. Your shifts then show up in your calendar by themselves, changes included.")}</p>
          <button type="button" className="me-cal-go" disabled={state === "busy"} onClick={() => void create()}>{state === "busy" ? tx("Bezig…", "Working…") : tx("Koppel mijn agenda", "Connect my calendar")}</button>
          {state === "error" ? <p className="me-error" role="alert">{tx("Dat lukte niet. Probeer het opnieuw.", "That didn't work. Try again.")}</p> : null}
        </>
      ) : (
        <>
          <p>{tx("Kies je agenda:", "Pick your calendar:")}</p>
          <div className="me-cal-options">
            <a className="me-cal-go" href={links.webcal}>{tx("iPhone, iPad of Mac", "iPhone, iPad or Mac")}</a>
            <a className="me-cal-go" href={links.google} target="_blank" rel="noreferrer">Google {tx("Agenda", "Calendar")}</a>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(links.https).then(() => setState("copied")); }}>{state === "copied" ? tx("Gekopieerd", "Copied") : tx("Kopieer link (Outlook en andere)", "Copy link (Outlook and others)")}</button>
          </div>
          <p className="me-cal-note">{tx("Deze link is persoonlijk: deel hem niet. Een nieuwe koppeling maken zet de oude link stop. Google ververst ongeveer elke paar uur, Apple elk uur.", "This link is personal: don't share it. Connecting again stops the old link. Google refreshes every few hours, Apple every hour.")}</p>
        </>
      )}
    </section>
  );
}

// ---------- notifications on this phone ----------
type PushState = "checking" | "unsupported" | "install" | "off" | "on" | "blocked" | "busy" | "error";
const base64ToBytes = (value: string) => { const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); };
function detectPush(): PushState {
  if (typeof window === "undefined") return "checking";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "blocked" : "off";
}

function PhoneNotifications({ organisationId, locale }: { organisationId: string; locale: "nl" | "en" }) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [state, setState] = useState<PushState>("checking");
  const [note, setNote] = useState("");
  useEffect(() => {
    const initial = detectPush();
    if (initial !== "off") { queueMicrotask(() => setState(initial)); return; }
    void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      setState(subscription && Notification.permission === "granted" ? "on" : "off");
    }).catch(() => setState("off"));
  }, []);

  async function enable() {
    setState("busy"); setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const keyResponse = await fetch("/api/push/key");
      const { publicKey } = (await keyResponse.json()) as { publicKey?: string };
      if (!publicKey) throw new Error();
      const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }));
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const saved = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, endpoint: json.endpoint, keys: json.keys }) });
      if (!saved.ok) throw new Error();
      setState("on");
      setNote(tx("Je krijgt nu een testmelding.", "You'll get a test notification now."));
      await fetch("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId }) });
    } catch { setState("error"); }
  }

  async function disable() {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId, endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setState("off"); setNote("");
    } catch { setState("error"); }
  }

  if (state === "checking") return null;
  return (
    <section className="me-cal" aria-labelledby="me-push-title">
      <h2 id="me-push-title">{tx("Meldingen op je telefoon", "Notifications on your phone")}</h2>
      {state === "install" ? (
        <>
          <p>{tx("Op een iPhone werkt dit als je Cliniq Team op je beginscherm zet:", "On an iPhone this works once Cliniq Team is on your home screen:")}</p>
          <ol className="me-steps">
            <li>{tx("Tik onderin Safari op Deel", "Tap Share at the bottom of Safari")} <span aria-hidden>⬆︎</span></li>
            <li>{tx("Kies \"Zet op beginscherm\"", "Choose \"Add to Home Screen\"")}</li>
            <li>{tx("Open Cliniq Team vanaf je beginscherm en zet hier meldingen aan", "Open Cliniq Team from your home screen and turn notifications on here")}</li>
          </ol>
        </>
      ) : state === "unsupported" ? (
        <p>{tx("Deze browser ondersteunt geen meldingen. Gebruik Chrome op Android, of zet de app op je iPhone-beginscherm.", "This browser can't show notifications. Use Chrome on Android, or add the app to your iPhone home screen.")}</p>
      ) : state === "blocked" ? (
        <p>{tx("Meldingen zijn geblokkeerd voor deze site. Zet ze aan in de instellingen van je browser of telefoon en kom dan terug.", "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.")}</p>
      ) : state === "on" ? (
        <>
          <p>{tx("Aan. Je krijgt een melding als je planner vraagt wanneer je kunt, als je rooster klaarstaat en twee uur voor je dienst.", "On. You'll be notified when your planner asks when you can work, when your roster is ready, and two hours before your shift.")}</p>
          {note ? <p className="me-saved" role="status">{note}</p> : null}
          <div className="me-cal-options"><button type="button" onClick={() => void disable()}>{tx("Zet meldingen uit op deze telefoon", "Turn off on this phone")}</button></div>
        </>
      ) : (
        <>
          <p>{tx("Krijg een melding als je planner vraagt wanneer je kunt, als je rooster klaarstaat en twee uur voor je dienst.", "Get notified when your planner asks when you can work, when your roster is ready, and two hours before your shift.")}</p>
          <button type="button" className="me-cal-go" disabled={state === "busy"} onClick={() => void enable()}>{state === "busy" ? tx("Bezig…", "Working…") : tx("Zet meldingen aan", "Turn on notifications")}</button>
          {state === "error" ? <p className="me-error" role="alert">{tx("Dat lukte niet. Probeer het opnieuw.", "That didn't work. Try again.")}</p> : null}
        </>
      )}
    </section>
  );
}
