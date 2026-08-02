"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";

type Option = { id: string; label: string };
export function AvailabilityManager({
  organisationId,
  venues,
  staff,
}: {
  organisationId: string;
  venues: Option[];
  staff: Option[];
}) {
  const { t } = useAuthLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setMessage("");
    setLinks({});
    const response = await fetch("/api/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId,
        venueId: formData.get("venueId"),
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
        deadlineAt: formData.get("deadlineAt"),
        staffIds: selected,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string;
      links?: Record<string, string>;
    };
    setPending(false);
    if (!response.ok) {
      setError(t("common.saveFailed"));
      return;
    }
    setMessage(t("availability.sent"));
    setLinks(result.links || {});
    router.refresh();
  }
  return (
    <form className="workflow-card" action={submit}>
      <h3>{t("availability.title")}</h3>
      <div className="workflow-fields">
        <label>
          {t("common.venue")}
          <select name="venueId" required defaultValue="">
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
            <label key={id}>
              {staff.find((s) => s.id === id)?.label}
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          ))}
        </div>
      ) : null}
      <button
        className="primary"
        disabled={pending || !selected.length}
        aria-busy={pending}
      >
        {pending ? t("availability.sending") : t("availability.create")}
      </button>
    </form>
  );
}
