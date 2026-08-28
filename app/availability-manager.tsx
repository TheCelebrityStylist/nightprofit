"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";
import { zonedInputToUtc } from "@/lib/workforce/timezone";

type Option = { id: string; label: string };
export function AvailabilityManager({
  organisationId,
  venueTimezone,
  venues,
  staff,
}: {
  organisationId: string;
  venueTimezone: string;
  venues: Option[];
  staff: Option[];
}) {
  const { t } = useAuthLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [activeVenueId, setActiveVenueId] = useState(venues[0]?.id || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState("");
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
      <div className="workflow-fields">
        <label>
          {t("common.venue")}
          <select
            name="venueId"
            required
            value={activeVenueId}
            onChange={(event) => setActiveVenueId(event.target.value)}
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
          <input name="startsAt" type="datetime-local" required />
        </label>
        <label>
          {t("availability.periodEnd")}
          <input name="endsAt" type="datetime-local" required />
        </label>
        <label>
          {t("availability.deadline")}
          <input name="deadlineAt" type="datetime-local" required />
        </label>
      </div>
      <fieldset className="recipient-picker">
        <legend>{t("availability.recipients")}</legend>
        {staff.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={selected.includes(person.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, person.id]
                    : current.filter((id) => id !== person.id),
                )
              }
            />
            {person.label}
          </label>
        ))}
      </fieldset>
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
                    ? "No telephone number"
                    : "Invalid telephone number"}
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
                    Open in WhatsApp
                  </a>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigator.clipboard.writeText(shares[id]?.message || url)}
                >
                  Copy message
                </button>
                <button type="button" className="secondary" onClick={() => void markShared(id)}>
                  Mark as manually shared
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <button className="primary" disabled={pending || !selected.length} aria-busy={pending}>
        {pending ? t("availability.sending") : t("availability.create")}
      </button>
    </form>
  );
}
