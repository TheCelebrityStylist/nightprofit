"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getDictionary, type Locale } from "../lib/i18n";

export function AuthForm({ mode, locale }: { mode:"login"|"signup"|"forgot"|"update"; locale:Locale }) {
  const dict=getDictionary(locale);
  const t=dict.auth;
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); setMessage("");
    const body=Object.fromEntries(new FormData(e.currentTarget));
    const response=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({error:dict.common.genericError})) as {error?:string;redirect?:string;message?:string};
    setBusy(false);
    if(!response.ok){setMessage(result.error??dict.common.genericError);return;}
    if(result.redirect){window.location.assign(result.redirect);return;}
    setMessage(result.message??dict.common.checkEmail);
  }
  return <main className="auth-page"><Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link><section className="auth-card">
    <span className="eyebrow">{mode==="login"?t.eyebrowLogin:mode==="signup"?t.eyebrowSignup:t.eyebrowRecover}</span>
    <h1>{mode==="login"?t.titleLogin:mode==="signup"?t.titleSignup:mode==="forgot"?t.titleForgot:t.titleUpdate}</h1>
    <p>{mode==="signup"?t.descSignup:t.descDefault}</p>
    <form onSubmit={submit}>
      {mode==="signup"&&<label>{t.fieldName}<input name="fullName" autoComplete="name" required minLength={2}/></label>}
      {mode!=="update"&&<label>{t.fieldEmail}<input name="email" type="email" autoComplete="email" required/></label>}
      {mode!=="forgot"&&<label>{t.fieldPassword}<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={10}/></label>}
      <button className="primary" disabled={busy}>{busy?dict.common.loading:mode==="login"?t.submitLogin:mode==="signup"?t.submitSignup:mode==="forgot"?t.submitForgot:t.submitUpdate}</button>
      {message&&<div className="form-message" role="status">{message}</div>}
    </form>
    <footer>{mode==="login"?<><Link href="/forgot-password">{t.footerForgot}</Link><Link href="/signup">{t.footerSignup}</Link></>:<Link href="/login">{t.footerBack}</Link>}</footer>
  </section></main>;
}
