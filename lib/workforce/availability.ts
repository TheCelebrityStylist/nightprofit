import {createHash,randomBytes} from "node:crypto";

export const AVAILABILITY_TOKEN_BYTES=32;
export function createAvailabilityToken(){
  return randomBytes(AVAILABILITY_TOKEN_BYTES).toString("base64url");
}
export function hashAvailabilityToken(token:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error("Invalid availability token");
  return createHash("sha256").update(token,"utf8").digest("hex");
}
export type AvailabilityEntry={startsAt:string;endsAt:string;availability:"available"|"preferred"|"unavailable";note?:string};
export function validateAvailabilityEntries(entries:AvailabilityEntry[],periodStart:string,periodEnd:string){
  if(!entries.length||entries.length>100)throw new Error("Availability entries required");
  const start=new Date(periodStart).getTime(),end=new Date(periodEnd).getTime();
  const sorted=entries.map(entry=>({...entry,start:new Date(entry.startsAt).getTime(),end:new Date(entry.endsAt).getTime()})).sort((a,b)=>a.start-b.start);
  for(let index=0;index<sorted.length;index++){
    const entry=sorted[index];
    if(!Number.isFinite(entry.start)||!Number.isFinite(entry.end)||entry.start<start||entry.end>end||entry.end<=entry.start)throw new Error("Availability outside request period");
    if(index>0&&entry.start<sorted[index-1].end)throw new Error("Availability ranges overlap");
  }
  return sorted.map(entry=>({startsAt:entry.startsAt,endsAt:entry.endsAt,availability:entry.availability,note:entry.note}));
}
