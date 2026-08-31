"use client";

import {useEffect,useMemo,useState} from "react";

type QueueRow={
  action_key:string;
  action_type:string;
  severity:string;
  rank_score:number|string;
  due_at:string|null;
  title:string;
  rationale:string;
  evidence_refs:unknown;
  shift_id:string|null;
  staff_id:string|null;
  related_id:string|null;
};

type LearningRow={
  id:string;
  service_date:string;
  comparison_basis:Record<string,unknown>;
  lessons:unknown;
  evidence_refs:Record<string,unknown>;
  calculation_version:string;
  content_hash:string;
  created_at:string;
};

const actionCopy:Record<string,{nl:string;en:string}>={
  coverage_gap:{nl:"Dekkingsgat sluiten",en:"Close coverage gap"},
  sickness_replacement:{nl:"Vervanging bij ziekmelding",en:"Sickness replacement"},
  leave_coverage:{nl:"Dekking na goedgekeurd verlof",en:"Coverage after approved leave"},
  shift_swap:{nl:"Ruilverzoek beoordelen",en:"Review shift swap"},
  time_correction:{nl:"Uurcorrectie beoordelen",en:"Review time correction"},
  submitted_hours:{nl:"Ingediende uren goedkeuren",en:"Approve submitted hours"},
};

const severityCopy:Record<string,{nl:string;en:string}>={
  critical:{nl:"kritiek",en:"critical"},
  high:{nl:"hoog",en:"high"},
  medium:{nl:"normaal",en:"medium"},
  low:{nl:"laag",en:"low"},
};

function evidenceSources(value:unknown){
  if(!Array.isArray(value))return [] as string[];
  return value.map(item=>item&&typeof item==="object"&&"source" in item?String((item as {source:unknown}).source):"").filter(Boolean);
}

function numberFrom(value:unknown){
  const parsed=typeof value==="number"?value:Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

export function WorkforceDecisionQueue({organisationId,venueId,windowStart,windowEnd,locale}:{organisationId:string;venueId:string;windowStart:string;windowEnd:string;locale:"nl"|"en"}){
  const [queue,setQueue]=useState<QueueRow[]>([]),[learning,setLearning]=useState<LearningRow[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const tx=(nl:string,en:string)=>locale==="nl"?nl:en;

  useEffect(()=>{
    if(!organisationId||!venueId||!windowStart||!windowEnd)return;
    const controller=new AbortController();
    setLoading(true);setError("");
    const params=new URLSearchParams({organisationId,venueId,startsAt:windowStart,endsAt:windowEnd});
    void fetch(`/api/workforce/exceptions?${params.toString()}`,{signal:controller.signal,headers:{accept:"application/json"}})
      .then(async response=>{const payload=await response.json() as {queue?:QueueRow[];learning?:LearningRow[]};if(!response.ok)throw new Error("queue_failed");setQueue(payload.queue??[]);setLearning(payload.learning??[])})
      .catch(fetchError=>{if(fetchError instanceof DOMException&&fetchError.name==="AbortError")return;setError(tx("Beslisvolgorde kon niet worden geladen.","Decision priority could not be loaded."))})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[organisationId,venueId,windowStart,windowEnd,locale]);

  const latestLearning=learning[0]??null;
  const learningSummary=useMemo(()=>{
    if(!latestLearning)return null;
    const basis=latestLearning.comparison_basis??{};
    const comparableCount=numberFrom(basis.comparable_count)??0;
    const currentBp=numberFrom(basis.actual_labour_basis_points);
    const comparableBp=numberFrom(basis.comparable_actual_labour_basis_points);
    const lessons=Array.isArray(latestLearning.lessons)?latestLearning.lessons:[];
    const insufficient=lessons.some(item=>item&&typeof item==="object"&&(item as {state?:unknown}).state==="insufficient_evidence");
    return{comparableCount,currentBp,comparableBp,insufficient};
  },[latestLearning]);

  return <section className="workforce-inbox persisted-workforce-queue" aria-label={tx("Geverifieerde beslisvolgorde","Verified manager decision priority")}>
    <header><div><span className="eyebrow">{tx("GEVERIFIEERDE BESLISVOLGORDE","VERIFIED DECISION PRIORITY")}</span><h3>{tx("Wat eerst aandacht nodig heeft","What needs attention first")}</h3><small>{tx("Serverrangschikking uit vastgelegde vraag, rooster-, verzuim- en urenfeiten. Geen AI-score.","Server ranking from persisted demand, roster, absence and time facts. No AI score.")}</small></div><b>{loading?"…":queue.length}</b></header>
    {error?<p className="quiet" role="status">{error}</p>:null}
    {!loading&&!error&&!queue.length?<p className="quiet">{tx("Geen open personeelsuitzonderingen in deze periode.","No open workforce exceptions in this period.")}</p>:null}
    {queue.slice(0,8).map((row,index)=>{
      const copy=actionCopy[row.action_type];
      const sources=evidenceSources(row.evidence_refs);
      return <article key={row.action_key} className={`persisted-decision severity-${row.severity}`}>
        <div><strong>{index+1}. {copy?copy[locale]:row.title}</strong><span>{severityCopy[row.severity]?.[locale]??row.severity}{row.due_at?` · ${new Date(row.due_at).toLocaleString(locale==="nl"?"nl-NL":"en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}`:""}</span><small>{tx("Rangscore","Rank score")} {row.rank_score}{sources.length?` · ${tx("bewijs","evidence")}: ${sources.join(", ")}`:""}</small></div>
        <details><summary>{tx("Bekijk bronbewijs","View source evidence")}</summary><pre>{JSON.stringify(row.evidence_refs,null,2)}</pre></details>
      </article>;
    })}
    {latestLearning&&learningSummary?<aside className="workforce-learning-proof"><div><span className="eyebrow">{tx("LEREN UIT AFGERONDE SERVICES","LEARNING FROM CLOSED SERVICES")}</span><b>{latestLearning.service_date}</b></div>{learningSummary.insufficient?<p>{tx(`Nog onvoldoende vergelijkbare services (${learningSummary.comparableCount}/2). NightProfit trekt nog geen conclusie.`,`Not enough comparable services yet (${learningSummary.comparableCount}/2). NightProfit does not infer a conclusion yet.`)}</p>:<p>{tx(`${learningSummary.comparableCount} vergelijkbare afgesloten services · actuele loonkostenratio ${learningSummary.currentBp==null?"—":`${(learningSummary.currentBp/100).toFixed(1)}%`} versus ${learningSummary.comparableBp==null?"—":`${(learningSummary.comparableBp/100).toFixed(1)}%`}.`,`${learningSummary.comparableCount} comparable closed services · current labor ratio ${learningSummary.currentBp==null?"—":`${(learningSummary.currentBp/100).toFixed(1)}%`} versus ${learningSummary.comparableBp==null?"—":`${(learningSummary.comparableBp/100).toFixed(1)}%`}.`)}</p>}<small>{tx("Onveranderlijk bewijs","Immutable evidence")} · {latestLearning.content_hash.slice(0,12)} · {latestLearning.calculation_version}</small></aside>:null}
  </section>;
}
