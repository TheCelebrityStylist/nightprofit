"use client";

import { useState } from "react";
import { detectDelimiter, parseCsvLine, type PosColumn, type PosColumnMapping } from "../lib/imports/pos-csv";
import { useAuthLocale } from "./auth-locale";
import type { AuthMessageKey } from "../lib/i18n/authenticated";

const optionKeys: Array<[PosColumn | "", AuthMessageKey]> = [
  ["", "pos.ignore"], ["external_id", "pos.transactionId"], ["timestamp", "pos.transactionTime"],
  ["trading_date", "pos.tradingDate"], ["item_name", "pos.product"], ["category", "pos.category"],
  ["quantity", "pos.quantity"], ["gross_sales", "pos.gross"], ["net_sales", "pos.net"],
  ["vat", "pos.vat"], ["discount", "pos.discount"], ["void", "pos.void"], ["refund", "pos.refund"],
  ["complimentary", "pos.complimentary"], ["payment_method", "pos.payment"], ["terminal", "pos.terminal"],
  ["external_event_reference", "pos.event"],
];
const aliases: Record<string, PosColumn> = {
  id:"external_id",transaction_id:"external_id",timestamp:"timestamp",date:"trading_date",
  trading_date:"trading_date",item:"item_name",product:"item_name",product_name:"item_name",
  category:"category",qty:"quantity",quantity:"quantity",gross:"gross_sales",gross_sales:"gross_sales",
  net:"net_sales",net_sales:"net_sales",vat:"vat",discount:"discount",void:"void",refund:"refund",
  complimentary:"complimentary",payment:"payment_method",payment_method:"payment_method",
  terminal:"terminal",event:"external_event_reference",
};
type DryRun={importId:string;status:string;delimiter:string;locale:string;acceptedCount:number;rejectedCount:number;rejectedRows:Array<{rowNumber:number;code:string}>;fileHash:string};

export function PosImportWorkspace({organisationId,venues}:{organisationId:string;venues:Array<{id:string;name:string}>}) {
  const {t}=useAuthLocale();
  const [file,setFile]=useState<File|null>(null),[headers,setHeaders]=useState<string[]>([]);
  const [mapping,setMapping]=useState<Record<string,PosColumn|"">>({});
  const [venueId,setVenueId]=useState(venues[0]?.id??"");
  const [tradingDate,setTradingDate]=useState(new Date().toISOString().slice(0,10));
  const [result,setResult]=useState<DryRun|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function inspect(selected:File|null){
    setFile(selected);setResult(null);setMessage("");if(!selected)return;
    try{
      const text=await selected.text(),delimiter=detectDelimiter(text);
      const next=parseCsvLine(text.replace(/^\uFEFF/,"").split(/\r?\n/,1)[0]??"",delimiter);
      setHeaders(next);setMapping(Object.fromEntries(next.map(header=>[header,aliases[header.toLowerCase().trim().replace(/[\s-]+/g,"_")]??""])));
    }catch{setHeaders([]);setMessage(t("pos.inspectError"));}
  }
  async function dryRun(){
    if(!file||!venueId)return;setBusy(true);setMessage("");
    const mappings:PosColumnMapping[]=Object.entries(mapping).filter((entry):entry is [string,PosColumn]=>entry[1]!=="").map(([source,target])=>({source,target}));
    try{
      const form=new FormData();form.set("organisationId",organisationId);form.set("venueId",venueId);form.set("tradingDate",tradingDate);form.set("file",file);form.set("mappings",JSON.stringify(mappings));
      const response=await fetch("/api/imports/pos",{method:"POST",body:form}),payload=await response.json() as DryRun&{errorCode?:string};
      if(!response.ok)throw new Error(t("pos.failed"));setResult(payload);
    }catch(error){setMessage(error instanceof Error?error.message:t("pos.failed"));}finally{setBusy(false);}
  }
  async function confirm(){
    if(!result)return;setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/imports/pos",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"confirm",organisationId,venueId,importId:result.importId})});
      const payload=await response.json() as {errorCode?:string;status?:string};if(!response.ok)throw new Error(t("pos.confirmFailed"));
      setResult({...result,status:payload.status??"processed"});setMessage(t("pos.processedMessage"));
    }catch(error){setMessage(error instanceof Error?error.message:t("pos.confirmFailed"));}finally{setBusy(false);}
  }
  return <div className="workflow-stack">
    <section className="panel import-panel" aria-labelledby="pos-import-title"><header><div><h3 id="pos-import-title">{t("pos.title")}</h3><p>{t("pos.help")}</p></div></header>
      <div className="import-fields"><label>{t("common.venue")}<select value={venueId} onChange={event=>setVenueId(event.target.value)}>{venues.map(venue=><option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label><label>{t("pos.tradingDate")}<input type="date" value={tradingDate} onChange={event=>setTradingDate(event.target.value)}/></label><label>{t("pos.file")}<input type="file" accept=".csv,text/csv,text/plain" onChange={event=>void inspect(event.target.files?.[0]??null)}/></label></div>
      {headers.length?<div className="mapping-grid">{headers.map(header=><label key={header}><span>{header}</span><select aria-label={`${t("pos.mapFor")} ${header}`} value={mapping[header]??""} onChange={event=>setMapping(current=>({...current,[header]:event.target.value as PosColumn|""}))}>{optionKeys.map(([value,key])=><option key={value} value={value}>{t(key)}</option>)}</select></label>)}</div>:null}
      <button className="primary" disabled={!file||!headers.length||busy} aria-busy={busy} onClick={()=>void dryRun()}>{busy?t("pos.checking"):t("pos.dryRun")}</button>{message?<p className="import-message" role="status" aria-live="polite">{message}</p>:null}
    </section>
    {result?<section className="panel import-result" aria-labelledby="pos-result-title"><header><div><h3 id="pos-result-title">{t("pos.result")}</h3><p>Hash {result.fileHash.slice(0,12)}… · {result.locale}</p></div></header><div className="import-summary" role="status"><div><b>{result.acceptedCount}</b><span>{t("pos.accepted")}</span></div><div><b>{result.rejectedCount}</b><span>{t("pos.rejected")}</span></div><div><b>{result.status}</b><span>{t("common.status")}</span></div></div>{result.rejectedRows.map(row=><div className="record-row" key={row.rowNumber}><b>{t("pos.row")} {row.rowNumber}</b><span>{row.code}</span><em>{t("pos.notImported")}</em></div>)}<button className="primary" disabled={busy||result.status==="processed"} onClick={()=>void confirm()}>{result.status==="processed"?t("pos.processed"):t("pos.confirm")}</button></section>:null}
  </div>;
}
