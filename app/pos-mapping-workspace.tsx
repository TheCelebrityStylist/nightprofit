"use client";
import {useState} from "react";
import {useAuthLocale} from "./auth-locale";
type MenuItem={id:string;name:string};type Row={sourceValue:string;category:string|null;quantity:string;revenueMinor:string;existingTargetId:string|null;suggestedTargetId:string|null;confidenceBasisPoints:number;reasonCode:"exact"|"manual"};
type VenueWorkspace={id:string;name:string;rows:Row[];menuItems:MenuItem[]};
export function PosMappingWorkspace({organisationId,venues}:{organisationId:string;venues:VenueWorkspace[]}){
  const {t,intlLocale}=useAuthLocale();
  const [venueId,setVenueId]=useState(venues[0]?.id??"");
  const key=(targetVenueId:string,sourceValue:string)=>`${targetVenueId}:${sourceValue}`;
  const [resolved,setResolved]=useState(new Set(
    venues.flatMap(venue=>venue.rows.filter(row=>row.existingTargetId).map(row=>key(venue.id,row.sourceValue))),
  ));
  const [choices,setChoices]=useState<Record<string,string>>(Object.fromEntries(
    venues.flatMap(venue=>venue.rows.map(row=>[
      key(venue.id,row.sourceValue),
      row.existingTargetId??row.suggestedTargetId??"",
    ])),
  ));
  const [message,setMessage]=useState("");
  const selected=venues.find(venue=>venue.id===venueId)??venues[0];
  async function confirm(row:Row){if(!selected)return;const rowKey=key(selected.id,row.sourceValue),menuItemId=choices[rowKey];if(!menuItemId)return;setMessage("");const response=await fetch("/api/mappings/pos",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,venueId:selected.id,sourceValue:row.sourceValue,menuItemId,confidenceBasisPoints:row.confidenceBasisPoints,reasoning:row.reasonCode,effectiveFrom:new Date().toISOString().slice(0,10)})});await response.json() as {errorCode?:string};if(!response.ok){setMessage(t("mapping.failed"));return;}setResolved(current=>new Set(current).add(rowKey));setMessage(`${row.sourceValue}: ${t("mapping.confirmed")}`);}
  const euro=(minor:string)=>new Intl.NumberFormat(intlLocale,{style:"currency",currency:"EUR"}).format(Number(BigInt(minor))/100);
  return <section className="panel mapping-workspace" aria-labelledby="mapping-title"><header><div><h3 id="mapping-title">{t("mapping.title")}</h3><p>{t("mapping.help")}</p></div></header><label>{t("common.venue")}<select aria-label={t("common.venue")} value={selected?.id??""} onChange={event=>{setVenueId(event.target.value);setMessage("");}}>{venues.map(venue=><option value={venue.id} key={venue.id}>{venue.name}</option>)}</select></label>{message?<p className="import-message" role="status" aria-live="polite">{message}</p>:null}<div className="mapping-table">{selected?.rows.map(row=>{const rowKey=key(selected.id,row.sourceValue);return <div className="mapping-item" key={row.sourceValue}><div><b>{row.sourceValue}</b><span>{row.category??t("mapping.noCategory")} · {row.quantity} {t("mapping.sold")}</span></div><div><b>{euro(row.revenueMinor)}</b><span>{row.confidenceBasisPoints/100}% · {t(row.reasonCode==="exact"?"mapping.exact":"mapping.manual")}</span></div><select aria-label={`${t("mapping.menuItem")} ${row.sourceValue}`} value={choices[rowKey]??""} onChange={event=>setChoices(current=>({...current,[rowKey]:event.target.value}))}><option value="">{t("mapping.choose")}</option>{selected.menuItems.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><button disabled={resolved.has(rowKey)||!choices[rowKey]} onClick={()=>void confirm(row)}>{resolved.has(rowKey)?t("mapping.done"):t("mapping.confirm")}</button></div>})}</div>{selected&&!selected.rows.length?<p>{t("mapping.empty")}</p>:null}</section>;
}
