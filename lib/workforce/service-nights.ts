import {z} from "zod";

const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const serviceLineSchema=z.object({
  role_id:z.string().uuid(),
  count:z.number().int().min(1).max(50),
  start:time,
  end:time,
  break_minutes:z.number().int().min(0).max(120).default(0),
}).refine(line=>line.start!==line.end,{message:"start and end must differ"});

export const serviceLinesSchema=z.array(serviceLineSchema).max(20);

export type ServiceLine=z.infer<typeof serviceLineSchema>;
export type ServicePattern={venue_id:string;iso_weekday:number;active:boolean;lines:ServiceLine[]};
export type LaneKind="staff"|"dj";

/** Accepts "18,50", "18.50" or "18". Returns cents, or null when not a sane hourly rate. */
export function parseEuroRate(value:string):bigint|null{
  const trimmed=value.trim().replace(/\s/g,"").replace("€","").replace(",",".");
  if(!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed))return null;
  const [whole,fraction=""]=trimmed.split(".");
  const minor=BigInt(whole)*100n+BigInt((fraction+"00").slice(0,2));
  return minor<=100_000n?minor:null;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a local calendar date. */
export const isoWeekday=(date:Date)=>((date.getDay()+6)%7)+1;

/** Minutes a line covers, crossing midnight when the end is at or before the start. */
export function lineMinutes(line:Pick<ServiceLine,"start"|"end"|"break_minutes">){
  const toMinutes=(value:string)=>{const [hours,minutes]=value.split(":").map(Number);return hours*60+minutes};
  const start=toMinutes(line.start),end=toMinutes(line.end);
  return (end>start?end-start:end+1440-start)-(line.break_minutes??0);
}

/** Head count a standard night asks for in one lane. */
export function patternHeadcount(pattern:ServicePattern|undefined,laneOfRole:(roleId:string)=>LaneKind,lane:LaneKind){
  if(!pattern?.active)return 0;
  return pattern.lines.filter(line=>laneOfRole(line.role_id)===lane).reduce((sum,line)=>sum+line.count,0);
}

/** One-line summary such as "2× 21:30–02:00 · 5× 23:00–02:00". */
export function describeLines(lines:ServiceLine[],roleName:(roleId:string)=>string,showRole=false){
  return lines.map(line=>`${line.count}× ${line.start}–${line.end}${showRole?` ${roleName(line.role_id)}`:""}`).join(" · ");
}

/** Copies a pattern's lines so a one-off night (e.g. a Wednesday event) can start from a normal night. */
export function cloneLines(lines:ServiceLine[]):ServiceLine[]{
  return lines.map(line=>({...line}));
}
