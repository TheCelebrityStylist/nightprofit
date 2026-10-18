"use client";
import {useState} from "react";

export function EmployeeOnboardingForm({token,name,venue,language}:{token:string;name:string;venue:string;language:"nl"|"en"}){
  const tx=(nl:string,en:string)=>language==="nl"?nl:en;
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <>
    <span className="eyebrow">{tx("WELKOM BIJ HET TEAM","WELCOME TO THE TEAM")}</span>
    <h1>{name?tx(`Hoi ${name}!`,`Hi ${name}!`):tx("Hoi!","Hi!")}</h1>
    <p>{tx(`Je staat in het team van ${venue}. Maak je account aan, dan zie je je diensten en geef je door wanneer je kunt.`,`You're on the ${venue} team. Create your account to see your shifts and tell us when you can work.`)}</p>
    <form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError("");
      const values=Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>;
      if(values.password!==values.confirm){setBusy(false);setError(tx("De wachtwoorden zijn niet hetzelfde.","The passwords don't match."));return}
      const response=await fetch("/api/workforce/onboarding",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,email:values.email,password:values.password})}).catch(()=>null);
      const result=response?await response.json().catch(()=>({})) as {next?:string;errorCode?:string}:{errorCode:"NETWORK"};
      if(!response?.ok){setBusy(false);setError(result.errorCode==="EMAIL_IN_USE"?tx("Dit e-mailadres heeft al een account. Log in of gebruik een ander adres.","This email already has an account. Log in or use another address."):result.errorCode==="INVITATION_UNAVAILABLE"?tx("Deze link werkt niet meer. Vraag je planner om een nieuwe.","This link no longer works. Ask your planner for a new one."):tx("Dat lukte niet. Check je gegevens en probeer het opnieuw.","That didn't work. Check your details and try again."));return}
      window.location.assign(result.next||"/app/my-work");
    }}>
      <label>{tx("E-mailadres","Email")}<input name="email" type="email" autoComplete="email" required/></label>
      <label>{tx("Kies een wachtwoord","Choose a password")} <small>{tx("minimaal 10 tekens","at least 10 characters")}</small><input name="password" type="password" autoComplete="new-password" minLength={10} required/></label>
      <label>{tx("Herhaal wachtwoord","Repeat password")}<input name="confirm" type="password" autoComplete="new-password" minLength={10} required/></label>
      {error?<p className="form-message error" role="alert">{error}</p>:null}
      <button className="primary" disabled={busy}>{busy?tx("Even geduld…","One moment…"):tx("Account aanmaken","Create account")}</button>
    </form>
  </>;
}
