"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuthLocale } from "../auth-locale";
export function OnboardingForm() {
  const { t } = useAuthLocale();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const result = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    });
    const body = (await result.json()) as {
      errorCode?: string;
      redirect?: string;
    };
    setBusy(false);
    if (body.redirect) window.location.assign(body.redirect);
    else setMessage(t("common.saveFailed"));
  }
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        <span className="logo">N</span>
        <b>NightProfit</b>
      </Link>
      <section className="auth-card onboarding-card">
        <span className="eyebrow">{t("onboarding.eyebrow")}</span>
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.help")}</p>
        <form onSubmit={submit}>
          <label>
            {t("onboarding.organisation")}
            <input name="organisationName" required minLength={2} />
          </label>
          <label>
            {t("onboarding.venue")}
            <input name="venueName" required minLength={2} />
          </label>
          <label>
            {t("onboarding.type")}
            <select name="venueType" defaultValue="nightclub">
              <option value="nightclub">{t("onboarding.nightclub")}</option>
              <option value="bar">{t("onboarding.bar")}</option>
              <option value="event_venue">{t("onboarding.eventVenue")}</option>
            </select>
          </label>
          <label>
            {t("onboarding.timezone")}
            <select name="timezone" defaultValue="Europe/Amsterdam">
              <option>Europe/Amsterdam</option>
              <option>Europe/Brussels</option>
            </select>
          </label>
          <button className="primary" disabled={busy} aria-busy={busy}>
            {busy ? t("common.saving") : t("onboarding.create")}
          </button>
          {message && (
            <div className="form-message" role="alert">
              {message}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
