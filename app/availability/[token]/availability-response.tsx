"use client";

import {useState} from "react";
import {deadlineLabel,nightsLabel} from "../../../lib/planning/nights";

type Answer="available"|"preferably_not"|"unavailable";
const parse=(date:string)=>new Date(`${date}T12:00:00Z`);

export function AvailabilityResponse({token,nights,initialAnswers,deadlineAt,venueName,timezone,employeeName,language}:{token:string;nights:string[];initialAnswers:Record<string,string>;deadlineAt:string;venueName:string;timezone:string;employeeName:string;language:"nl"|"en"}){
  const tx=(nl:string,en:string)=>language==="nl"?nl:en;
  const intl=language==="nl"?"nl-NL":"en-GB";
  const sorted=[...nights].sort();
  const [answers,setAnswers]=useState<Record<string,Answer>>(()=>Object.fromEntries(Object.entries(initialAnswers).map(([date,value])=>[date,(value==="preferred"?"available":value) as Answer])));
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const done=sorted.every(night=>answers[night]);

  async function choose(night:string,value:Answer){
    const before=answers,next={...answers,[night]:value};
    setAnswers(next);setBusy(true);setError("");setSaved(false);
    try{
      const response=await fetch("/api/availability/respond",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,entries:Object.entries(next).map(([date,availability])=>({date,availability}))})});
      const body=await response.json().catch(()=>({})) as {errorCode?:string};
      if(!response.ok)throw new Error(body.errorCode);
      setSaved(true);
    }catch(caught){
      setAnswers(before);
      setError(caught instanceof Error&&caught.message==="DEADLINE_PASSED"?tx("De deadline is voorbij. Laat het je planner zelf weten.","The deadline has passed. Tell your planner directly."):tx("Opslaan lukte niet. Check je verbinding en tik nog een keer.","Couldn't save. Check your connection and tap again."));
    }finally{setBusy(false)}
  }

  return <section className="auth-card me-link">
    <h1>{tx("Hoi","Hi")} {employeeName||tx("daar","there")}!</h1>
    <p>{done
      ?tx(`Dank je, ${venueName} ziet je antwoorden. Aanpassen kan tot ${deadlineLabel(deadlineAt,timezone)}.`,`Thanks, ${venueName} can see your answers. You can change them until ${deadlineLabel(deadlineAt,timezone,"en")}.`)
      :tx(`Kun je ${nightsLabel(sorted)} werken bij ${venueName}? Laat het weten vóór ${deadlineLabel(deadlineAt,timezone)}.`,`Can you work ${nightsLabel(sorted,"en")} at ${venueName}? Let us know before ${deadlineLabel(deadlineAt,timezone,"en")}.`)}</p>
    <ul className="me-ask-list">
      {sorted.map(night=><li key={night}>
        <div className="me-night"><b>{parse(night).toLocaleDateString(intl,{weekday:"long",timeZone:"UTC"})}</b><span>{parse(night).toLocaleDateString(intl,{day:"numeric",month:"long",timeZone:"UTC"})}</span></div>
        <div className="me-choice" role="group">
          {([["available",tx("Kan","Can")],["preferably_not",tx("Liever niet","Rather not")],["unavailable",tx("Kan niet","Can't")]] as [Answer,string][]).map(([value,label])=><button key={value} type="button" aria-pressed={answers[night]===value} className={`c-${value}${answers[night]===value?" on":""}`} disabled={busy} onClick={()=>void choose(night,value)}>{label}</button>)}
        </div>
      </li>)}
    </ul>
    {error?<p className="form-message error" role="alert">{error}</p>:saved?<p className="me-saved" role="status">{tx("Opgeslagen","Saved")}</p>:null}
  </section>;
}
