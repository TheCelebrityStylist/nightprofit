"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";

export function CloseForm({organisationId,venues}:{organisationId:string;venues:{id:string;name:string;timezone:string}[]}){
  const {t}=useAuthLocale();
  const router=useRouter();
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  async function submit(formData:FormData){
    setPending(true);setError("");
    const response=await fetch("/api/closes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      organisationId,venueId:formData.get("venueId"),tradingDate:formData.get("tradingDate")
    })});
    const result=await response.json() as {id?:string;errorCode?:string};
    setPending(false);
    if(!response.ok||!result.id){setError(t("close.createFailed"));return;}
    router.push(`/app/close/${result.id}`);
    router.refresh();
  }
  return <form className="form-grid" action={submit}>
    <div><h2>{t("close.createTitle")}</h2><p>{t("close.createHelp")}</p></div>
    <label>{t("common.venue")}<select name="venueId" required defaultValue=""><option value="" disabled>{t("close.chooseVenue")}</option>{venues.map((venue)=><option value={venue.id} key={venue.id}>{venue.name}</option>)}</select></label>
    <label>{t("close.tradingDate")}<input name="tradingDate" type="date" required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={pending||!venues.length} aria-busy={pending}>{pending?t("close.creating"):t("close.create")}</button>
  </form>;
}
