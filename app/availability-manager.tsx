"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/workforce/timezone";

type Option = { id: string; label: string };
type StaffOption = Option & { phoneState: "valid" | "missing" | "invalid"; preferredLanguage: "nl" | "en" };
const defaultSchedule=(venueTimezone:string)=>{const start=new Date();start.setUTCDate(start.getUTCDate()+((8-start.getUTCDay())%7||7));start.setUTCHours(0,0,0,0);const end=new Date(start.getTime()+7*86400000),deadline=new Date(start.getTime()-2*86400000+18*3600000);return{startsAt:utcToZonedInput(start.toISOString(),venueTimezone),endsAt:utcToZonedInput(end.toISOString(),venueTimezone),deadlineAt:utcToZonedInput(deadline.toISOString(),venueTimezone)}};
export function AvailabilityManager({
  organisationId,
  venueTimezone,
  venues,
  staff,
}: {
  organisationId: string;
  venueTimezone: string;
  venues: Option[];
  staff: StaffOption[];
}) {
  const { t, locale } = useAuthLocale();
  const tx=(nl:string,en:string)=>locale==="nl"?nl:en;
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [activeVenueId, setActiveVenueId] = useState(venues[0]?.id || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState("");
  const [schedule,setSchedule]=useState(()=>defaultSchedule(venueTimezone));
  const [commandKey,setCommandKey]=useState(()=>crypto.randomUUID());
  const [recipientIds, setRecipientIds] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<
    Record<
      string,
      { message: string; whatsappUrl: string | null; phoneState: "valid" | "missing" | "invalid" }
    >
  >({});
  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setMessage("");
    setLinks({});
    setShares({});
    const response = await fetch("/api/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId,
        venueId: formData.get("venueId"),
        startsAt: zonedInputToUtc(String(formData.get("startsAt")), venueTimezone),
        endsAt: zonedInputToUtc(String(formData.get("endsAt")), venueTimezone),
        deadlineAt: zonedInputToUtc(String(formData.get("deadlineAt")), venueTimezone),
        staffIds: selected,
        idempotencyKey: commandKey,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string;
      links?: Record<string, string>;
      requestId?: string;
      recipientIdsByStaff?: Record<string, string>;
      shares?: Record<
        string,
        { message: string; whatsappUrl: string | null; phoneState: "valid" | "missing" | "invalid" }
      >;
    };
    setPending(false);
    if (!response.ok) {
      setError(t("common.saveFailed"));
      return;
    }
    setMessage(t("availability.prepared"));
    setLinks(result.links || {});
    setRequestId(result.requestId || "");
    setRecipientIds(result.recipientIdsByStaff || {});
    setShares(result.shares || {});
    router.refresh();
  }
  async function markShared(staffId: string) {
    const recipientId = recipientIds[staffId];
    if (!requestId || !recipientId) return;
    const response = await fetch("/api/availability", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId,
        venueId: activeVenueId,
        action: "manual_share",
        requestId,
        recipientIds: [recipientId],
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (response.ok) setMessage(t("availability.sent"));
    else setError(t("common.saveFailed"));
  }
  return (
    <form className="workflow-card" action={submit}>
      <h3>{t("availability.title")}</h3>
      <section className="availability-campaign-summary" aria-label={tx("Verzendcontrole","Delivery review")}>
        <div><span>{tx("Geselecteerd","Selected")}</span><b>{selected.length}</b></div>
        <div><span>{tx("Geldig mobiel nummer","Valid mobile number")}</span><b>{selected.filter(id=>staff.find(person=>person.id===id)?.phoneState==="valid").length}</b></div>
        <div><span>{tx("Nummer ontbreekt of is ongeldig","Missing or invalid number")}</span><b>{selected.filter(id=>staff.find(person=>person.id===id)?.phoneState!=="valid").length}</b></div>
      </section>
      <p className="delivery-readiness"><b>{tx("WhatsApp-provider niet verbonden.","WhatsApp provider not connected.")}</b> {tx("Persoonlijke links worden veilig voorbereid, maar niets wordt als verzonden of afgeleverd gemarkeerd. Deel links daarna handmatig.","Personal links will be prepared securely, but nothing is marked sent or delivered. Share links manually afterwards.")}</p>
      <div className="workflow-fields">
        <label>
          {t("common.venue")}
          <select
            name="venueId"
            required
            value={activeVenueId}
            onChange={(event) => {setActiveVenueId(event.target.value);setCommandKey(crypto.randomUUID())}}
          >
            <option value="" disabled>
              {t("common.choose")}
            </option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("availability.periodStart")}
          <input name="startsAt" type="datetime-local" required value={schedule.startsAt} onChange={event=>{setSchedule(current=>({...current,startsAt:event.target.value}));setCommandKey(crypto.randomUUID())}}/>
        </label>
        <label>
          {t("availability.periodEnd")}
          <input name="endsAt" type="datetime-local" required value={schedule.endsAt} onChange={event=>{setSchedule(current=>({...current,endsAt:event.target.value}));setCommandKey(crypto.randomUUID())}}/>
        </label>
        <label>
          {t("availability.deadline")}
          <input name="deadlineAt" type="datetime-local" required value={schedule.deadlineAt} onChange={event=>{setSchedule(current=>({...current,deadlineAt:event.target.value}));setCommandKey(crypto.randomUUID())}}/>
        </label>
      </div>
      <fieldset className="recipient-picker">
        <legend>{t("availability.recipients")}</legend>
        {staff.length?<div className="recipient-actions"><button type="button" onClick={()=>{setSelected(staff.map(person=>person.id));setCommandKey(crypto.randomUUID())}}>{tx("Iedereen selecteren","Select all")}</button><button type="button" disabled={!selected.length} onClick={()=>{setSelected([]);setCommandKey(crypto.randomUUID())}}>{tx("Selectie wissen","Clear selection")}</button></div>:null}
        {staff.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={selected.includes(person.id)}
              onChange={(event) =>
                {setSelected((current) =>
                  event.target.checked
                    ? [...current, person.id]
                    : current.filter((id) => id !== person.id),
                );setCommandKey(crypto.randomUUID())}
              }
            />
            <span>{person.label}<small>{person.phoneState==="valid"?"WhatsApp":person.phoneState==="missing"?tx("mobiel nummer ontbreekt","mobile number missing"):tx("mobiel nummer ongeldig","invalid mobile number")} · {person.preferredLanguage.toUpperCase()}</small></span>
          </label>
        ))}
        {!staff.length?<p className="quiet">{t("availability.noRecipients")}</p>:null}
      </fieldset>
      <section className="message-preview"><b>{tx("Berichtvoorbeeld","Message preview")}</b><p>{tx("Hoi [naam]! Kun je je beschikbaarheid voor volgende week uiterlijk vóór de deadline doorgeven? Via je persoonlijke beveiligde link duurt dat minder dan een minuut.","Hi [name]! Can you share your availability for next week before the deadline? Your personal secure link takes less than a minute.")}</p><small>{tx("Herinneringen: 48 en 12 uur vóór de deadline, alleen voor medewerkers die nog niet hebben gereageerd.","Reminders: 48 and 12 hours before the deadline, only for employees who have not responded.")}</small></section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {Object.entries(links).length ? (
        <div className="copy-links">
          <b>{t("availability.fallback")}</b>
          <p>{t("availability.fallbackHelp")}</p>
          {Object.entries(links).map(([id, url]) => (
            <div className="share-recipient" key={id}>
              <b>{staff.find((s) => s.id === id)?.label}</b>
              <span>
                {shares[id]?.phoneState === "valid"
                  ? "WhatsApp"
                  : shares[id]?.phoneState === "missing"
                    ? tx("Mobiel nummer ontbreekt","No mobile number")
                    : tx("Ongeldig mobiel nummer","Invalid mobile number")}
              </span>
              <textarea
                readOnly
                value={shares[id]?.message || url}
                aria-label={`${staff.find((s) => s.id === id)?.label} message`}
              />
              <div className="share-actions">
                {shares[id]?.whatsappUrl ? (
                  <a
                    className="primary"
                    href={shares[id].whatsappUrl!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tx("Open in WhatsApp","Open in WhatsApp")}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigator.clipboard.writeText(shares[id]?.message || url)}
                >
                  {tx("Kopieer bericht","Copy message")}
                </button>
                <button type="button" className="secondary" onClick={() => void markShared(id)}>
                  {tx("Markeer als handmatig gedeeld","Mark as manually shared")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <button className="primary" disabled={pending || !selected.length || !staff.length} aria-busy={pending}>
        {pending ? t("availability.sending") : t("availability.create")}
      </button>
    </form>
  );
}
