"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary, type Locale } from "../lib/i18n";

export function CloseForm({organisationId,venues,locale}:{organisationId:string;venues:{id:string;name:string;timezone:string}[];locale:Locale}){
  const router=useRouter();
  const dict=getDictionary(locale);
  const t=dict.closeForm;
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  function messageForCode(code:string|undefined):string{
    switch(code){
      case "duplicate":return t.errorDuplicate;
      case "invalid":return t.errorInvalid;
      default:return t.errorCreateFailed;
    }
  }
  async function submit(formData:FormData){
    setPending(true);setError("");
    const response=await fetch("/api/closes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      organisationId,venueId:formData.get("venueId"),tradingDate:formData.get("tradingDate")
    })});
    const result=await response.json().catch(()=>({}))as {id?:string;code?:string};
    setPending(false);
    if(!response.ok||!result.id){setError(messageForCode(result.code));return;}
    router.push(`/app/close/${result.id}`);
    router.refresh();
  }
  return <form className="form-grid" action={submit}>
    <div><h2>{t.title}</h2><p>{t.desc}</p></div>
    <label>{t.venue}<select name="venueId" required defaultValue=""><option value="" disabled>{t.venuePlaceholder}</option>{venues.map((venue)=><option value={venue.id} key={venue.id}>{venue.name}</option>)}</select></label>
    <label>{t.tradingDate}<input name="tradingDate" type="date" required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={pending||!venues.length}>{pending?dict.common.saving:t.submit}</button>
  </form>;
}
