"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthLocaleProvider, AuthLocaleSwitch, useAuthLocale } from "./auth-locale";
import type { AuthLocale, AuthMessageKey } from "../lib/i18n/authenticated";

type AuthErrorCode="LINK_INVALID"|"RECOVERY_SESSION_MISSING"|"PASSWORD_POLICY"|"PASSWORD_MISMATCH"|"TOO_MANY_ATTEMPTS"|"RATE_LIMITED"|"AUTH_CONFIGURATION_INCOMPLETE"|"AUTH_NETWORK"|"AUTH_UNEXPECTED"|"PASSWORD_UPDATE_FAILED"|"INVALID_CREDENTIALS"|"INVALID_AUTH_INPUT"|"AUTH_PROVIDER_UNAVAILABLE"|"AUTH_SESSION_FAILED";
const authErrorMessages:Record<AuthErrorCode,AuthMessageKey>={LINK_INVALID:"auth.linkInvalid",RECOVERY_SESSION_MISSING:"auth.sessionMissing",PASSWORD_POLICY:"auth.passwordPolicy",PASSWORD_MISMATCH:"auth.passwordMismatch",TOO_MANY_ATTEMPTS:"auth.tooManyAttempts",RATE_LIMITED:"auth.tooManyAttempts",AUTH_CONFIGURATION_INCOMPLETE:"auth.configurationIncomplete",AUTH_NETWORK:"auth.networkError",AUTH_UNEXPECTED:"auth.unexpectedError",PASSWORD_UPDATE_FAILED:"auth.unexpectedError",INVALID_CREDENTIALS:"auth.invalidCredentials",INVALID_AUTH_INPUT:"auth.invalidCredentials",AUTH_PROVIDER_UNAVAILABLE:"auth.providerUnavailable",AUTH_SESSION_FAILED:"auth.sessionFailed"};

export function authErrorMessageKey(mode:"login"|"signup"|"forgot"|"update",errorCode:AuthErrorCode):AuthMessageKey{
  if(mode==="login"&&(errorCode==="AUTH_UNEXPECTED"||errorCode==="PASSWORD_UPDATE_FAILED"))return "auth.genericError";
  return authErrorMessages[errorCode];
}

export function AuthForm({ mode, locale = "nl", initialError }: { mode:"login"|"signup"|"forgot"|"update"; locale?:AuthLocale;initialError?:AuthErrorCode }) {
  return <AuthLocaleProvider initialLocale={locale}><LocalizedAuthForm mode={mode} initialError={initialError}/></AuthLocaleProvider>;
}

function LocalizedAuthForm({ mode,initialError }: { mode:"login"|"signup"|"forgot"|"update";initialError?:AuthErrorCode }) {
  const { t, locale } = useAuthLocale();
  const [errorCode,setErrorCode]=useState<AuthErrorCode|undefined>(mode==="update"?undefined:initialError);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(mode==="update"&&!!initialError);
  useEffect(()=>{
    if(mode!=="update"||!initialError)return;
    const fragment=new URLSearchParams(window.location.hash.slice(1));
    const accessToken=fragment.get("access_token");
    const refreshToken=fragment.get("refresh_token");
    if(!accessToken||!refreshToken){queueMicrotask(()=>{setBusy(false);setErrorCode(initialError);});return;}
    window.history.replaceState(null,"",window.location.pathname+window.location.search);
    void fetch("/api/auth/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accessToken,refreshToken})})
      .then(async response=>{const result=await response.json().catch(()=>({errorCode:"AUTH_UNEXPECTED"})) as {redirect?:string;errorCode?:string};if(!response.ok)throw new Error(result.errorCode||"AUTH_UNEXPECTED");window.location.replace(result.redirect||"/update-password");})
      .catch(error=>{setBusy(false);const code=error instanceof Error&&error.message in authErrorMessages?error.message:"AUTH_UNEXPECTED";setErrorCode(code as AuthErrorCode);});
  },[initialError,mode]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); if(busy)return; setBusy(true); setMessage(""); setErrorCode(undefined);
    const body=Object.fromEntries(new FormData(e.currentTarget));
    if(mode==="update"&&body.password!==body.confirmPassword){setBusy(false);setErrorCode("PASSWORD_MISMATCH");return;}
    delete body.confirmPassword;
    try{const response=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>({errorCode:"AUTH_UNEXPECTED"})) as {error?:string;errorCode?:string;redirect?:string;message?:string;messageCode?:string};
      setBusy(false);
      if(!response.ok){setErrorCode((result.errorCode&&result.errorCode in authErrorMessages?result.errorCode:"AUTH_UNEXPECTED") as AuthErrorCode);return;}
      if(result.redirect){window.location.assign(result.redirect);return;}
      setMessage(result.messageCode ? t("auth.checkEmail") : result.message??t("auth.checkEmail"));
    }catch{setBusy(false);setErrorCode("AUTH_NETWORK");}
  }
  return <main className="auth-page" lang={locale}><div className="auth-brand-row"><Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link><AuthLocaleSwitch/></div><section className="auth-card" aria-labelledby="auth-title">
    <span className="eyebrow">{mode==="login"?t("auth.secureLogin"):mode==="signup"?t("auth.start"):t("auth.recovery")}</span>
    <h1 id="auth-title">{mode==="login"?t("auth.welcome"):mode==="signup"?t("auth.createAccount"):mode==="forgot"?t("auth.forgotTitle"):t("auth.newPassword")}</h1>
    <p>{mode==="signup"?t("auth.signupHelp"):t("auth.sessionHelp")}</p>
    <form onSubmit={submit}>
      {mode==="signup"&&<label>{t("auth.name")}<input name="fullName" autoComplete="name" required minLength={2}/></label>}
      {mode!=="update"&&<label>{t("auth.email")}<input name="email" type="email" autoComplete="email" required/></label>}
      {mode!=="forgot"&&<label>{t("auth.password")}<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={10}/></label>}
      {mode==="update"&&<label>{t("auth.confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10}/></label>}
      <button className="primary" disabled={busy||mode==="update"&&!!errorCode} aria-busy={busy}>{busy?t("auth.busy"):mode==="login"?t("auth.login"):mode==="signup"?t("auth.signup"):mode==="forgot"?t("auth.sendReset"):t("auth.updatePassword")}</button>
      {errorCode&&<div className="form-message error" role="alert" aria-live="assertive">{t(authErrorMessageKey(mode,errorCode))}</div>}
      {message&&<div className="form-message" role="status" aria-live="polite">{message}</div>}
    </form>
    <footer>{mode==="login"?<><Link href="/forgot-password">{t("auth.forgot")}</Link><Link href="/signup">{t("auth.noAccount")}</Link></>:<><Link href="/login">{t("auth.back")}</Link>{mode==="update"&&errorCode?<Link href="/forgot-password">{t("auth.requestNewLink")}</Link>:null}</>}</footer>
  </section></main>;
}
