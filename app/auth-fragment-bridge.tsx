"use client";

import { useEffect } from "react";

export function AuthFragmentBridge(){
  useEffect(()=>{
    const fragment=new URLSearchParams(window.location.hash.slice(1));
    if(!fragment.size)return;
    const accessToken=fragment.get("access_token");
    const refreshToken=fragment.get("refresh_token");
    const recoveryError=fragment.get("error")||fragment.get("error_code");
    window.history.replaceState(null,"",window.location.pathname+window.location.search);
    if(recoveryError){window.location.replace("/forgot-password?error=link_invalid");return;}
    if(!accessToken||!refreshToken)return;
    void fetch("/api/auth/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accessToken,refreshToken})})
      .then(async response=>{const result=await response.json().catch(()=>({})) as {redirect?:string};if(!response.ok)throw new Error("RECOVERY_SESSION_FAILED");window.location.replace(result.redirect||"/update-password");})
      .catch(()=>window.location.replace("/forgot-password?error=link_invalid"));
  },[]);
  return null;
}
