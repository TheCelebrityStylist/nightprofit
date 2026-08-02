"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthLocaleProvider, AuthLocaleSwitch, useAuthLocale } from "./auth-locale";
import type { AuthLocale } from "../lib/i18n/authenticated";

export function AuthForm({ mode, locale = "nl" }: { mode:"login"|"signup"|"forgot"|"update"; locale?:AuthLocale }) {
  return <AuthLocaleProvider initialLocale={locale}><LocalizedAuthForm mode={mode}/></AuthLocaleProvider>;
}

function LocalizedAuthForm({ mode }: { mode:"login"|"signup"|"forgot"|"update" }) {
  const { t, locale } = useAuthLocale();
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); setMessage("");
    const body=Object.fromEntries(new FormData(e.currentTarget));
    const response=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({errorCode:"UNKNOWN"})) as {error?:string;errorCode?:string;redirect?:string;message?:string;messageCode?:string};
    setBusy(false);
    if(!response.ok){setMessage(result.errorCode ? t("auth.genericError") : result.error??t("auth.genericError"));return;}
    if(result.redirect){window.location.assign(result.redirect);return;}
    setMessage(result.messageCode ? t("auth.checkEmail") : result.message??t("auth.checkEmail"));
  }
  return <main className="auth-page" lang={locale}><div className="auth-brand-row"><Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link><AuthLocaleSwitch/></div><section className="auth-card" aria-labelledby="auth-title">
    <span className="eyebrow">{mode==="login"?t("auth.secureLogin"):mode==="signup"?t("auth.start"):t("auth.recovery")}</span>
    <h1 id="auth-title">{mode==="login"?t("auth.welcome"):mode==="signup"?t("auth.createAccount"):mode==="forgot"?t("auth.forgotTitle"):t("auth.newPassword")}</h1>
    <p>{mode==="signup"?t("auth.signupHelp"):t("auth.sessionHelp")}</p>
    <form onSubmit={submit}>
      {mode==="signup"&&<label>{t("auth.name")}<input name="fullName" autoComplete="name" required minLength={2}/></label>}
      {mode!=="update"&&<label>{t("auth.email")}<input name="email" type="email" autoComplete="email" required/></label>}
      {mode!=="forgot"&&<label>{t("auth.password")}<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={10}/></label>}
      <button className="primary" disabled={busy} aria-busy={busy}>{busy?t("auth.busy"):mode==="login"?t("auth.login"):mode==="signup"?t("auth.signup"):mode==="forgot"?t("auth.sendReset"):t("auth.updatePassword")}</button>
      {message&&<div className="form-message" role={message===t("auth.genericError")?"alert":"status"} aria-live="polite">{message}</div>}
    </form>
    <footer>{mode==="login"?<><Link href="/forgot-password">{t("auth.forgot")}</Link><Link href="/signup">{t("auth.noAccount")}</Link></>:<Link href="/login">{t("auth.back")}</Link>}</footer>
  </section></main>;
}
