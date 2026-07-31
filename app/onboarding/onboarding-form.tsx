"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getDictionary, type Locale } from "../../lib/i18n";
export function OnboardingForm({ locale }: { locale:Locale }){
  const dict=getDictionary(locale);const t=dict.onboarding;
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const result=await fetch("/api/onboarding",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});const body=await result.json() as {error?:string;redirect?:string};setBusy(false);if(body.redirect)window.location.assign(body.redirect);else setMessage(body.error??dict.common.saveFailed);}
  return <main className="auth-page"><Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link><section className="auth-card onboarding-card"><span className="eyebrow">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.desc}</p><form onSubmit={submit}><label>{t.organisationName}<input name="organisationName" required minLength={2}/></label><label>{t.firstVenue}<input name="venueName" required minLength={2}/></label><label>{t.type}<select name="venueType" defaultValue="nightclub"><option value="nightclub">{t.typeNightclub}</option><option value="bar">{t.typeBar}</option><option value="event_venue">{t.typeEventVenue}</option></select></label><label>{t.timezone}<select name="timezone" defaultValue="Europe/Amsterdam"><option>Europe/Amsterdam</option><option>Europe/Brussels</option></select></label><button className="primary" disabled={busy}>{busy?dict.common.saving:t.submit}</button>{message&&<div className="form-message" role="alert">{message}</div>}</form></section></main>
}
