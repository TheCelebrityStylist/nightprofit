"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CloseForm({organisationId,venues}:{organisationId:string;venues:{id:string;name:string;timezone:string}[]}){
  const router=useRouter();
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  async function submit(formData:FormData){
    setPending(true);setError("");
    const response=await fetch("/api/closes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      organisationId,venueId:formData.get("venueId"),tradingDate:formData.get("tradingDate")
    })});
    const result=await response.json() as {id?:string;error?:string};
    setPending(false);
    if(!response.ok||!result.id){setError(result.error??"Afsluiting kon niet worden aangemaakt.");return;}
    router.push(`/app/close/${result.id}`);
    router.refresh();
  }
  return <form className="form-grid" action={submit}>
    <div><h2>Nieuwe nightly close</h2><p>Bedragen worden na invoer server-side in gehele centen opgeslagen.</p></div>
    <label>Vestiging<select name="venueId" required defaultValue=""><option value="" disabled>Kies een vestiging</option>{venues.map((venue)=><option value={venue.id} key={venue.id}>{venue.name}</option>)}</select></label>
    <label>Handelsdatum<input name="tradingDate" type="date" required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={pending||!venues.length}>{pending?"Opslaan…":"Afsluiting aanmaken"}</button>
  </form>;
}
