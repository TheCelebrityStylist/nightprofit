"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";

export function AuthForm({ mode }: { mode:"login"|"signup"|"forgot"|"update" }) {
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); setMessage("");
    const body=Object.fromEntries(new FormData(e.currentTarget));
    const response=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({error:"Er ging iets mis."})) as {error?:string;redirect?:string;message?:string};
    setBusy(false);
    if(!response.ok){setMessage(result.error??"Er ging iets mis.");return;}
    if(result.redirect){window.location.assign(result.redirect);return;}
    setMessage(result.message??"Controleer je e-mail.");
  }
  return <main className="auth-page"><Link href="/" className="brand"><span className="logo">N</span><b>NightProfit</b></Link><section className="auth-card">
    <span className="eyebrow">{mode==="login"?"VEILIG INLOGGEN":mode==="signup"?"START JE WINSTDIAGNOSE":"ACCOUNT HERSTEL"}</span>
    <h1>{mode==="login"?"Welkom terug":mode==="signup"?"Maak je account":mode==="forgot"?"Wachtwoord vergeten":"Nieuw wachtwoord"}</h1>
    <p>{mode==="signup"?"Je bevestigt eerst je e-mailadres. Daarna richt je organisatie en eerste vestiging in.":"Je sessie wordt veilig beheerd met httpOnly cookies."}</p>
    <form onSubmit={submit}>
      {mode==="signup"&&<label>Naam<input name="fullName" autoComplete="name" required minLength={2}/></label>}
      {mode!=="update"&&<label>E-mailadres<input name="email" type="email" autoComplete="email" required/></label>}
      {mode!=="forgot"&&<label>Wachtwoord<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={10}/></label>}
      <button className="primary" disabled={busy}>{busy?"Bezig…":mode==="login"?"Inloggen":mode==="signup"?"Account maken":mode==="forgot"?"Herstellink versturen":"Wachtwoord bijwerken"}</button>
      {message&&<div className="form-message" role="status">{message}</div>}
    </form>
    <footer>{mode==="login"?<><Link href="/forgot-password">Wachtwoord vergeten?</Link><Link href="/signup">Nog geen account?</Link></>:<Link href="/login">Terug naar inloggen</Link>}</footer>
  </section></main>;
}
