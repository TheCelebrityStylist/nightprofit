"use client";

import { useEffect } from "react";

export function RootRedirect(){
  useEffect(()=>{if(!window.location.hash)window.location.replace("/app/planning");},[]);
  return <main className="root-redirect" aria-busy="true"/>;
}
