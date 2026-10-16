export type WorkforceExceptionType="sickness_coverage"|"approved_leave_coverage"|"coverage_gap"|"swap_decision"|"time_correction"|"submitted_hours"|"open_shift"|"stale_proposal";
export type WorkforceExceptionInput={actionKey:string;type:WorkforceExceptionType;relevantAt:string;gap?:number;state?:string};
export type RankedWorkforceException=WorkforceExceptionInput&{severity:"critical"|"high"|"medium";rankScore:number};

const hoursUntil=(relevantAt:string,referenceAt:string)=>Math.floor((new Date(relevantAt).getTime()-new Date(referenceAt).getTime())/3_600_000);

export function rankWorkforceExceptions(inputs:readonly WorkforceExceptionInput[],referenceAt:string):RankedWorkforceException[]{
  return inputs.map(item=>{
    const hours=hoursUntil(item.relevantAt,referenceAt);
    if(item.type==="sickness_coverage")return{...item,severity:"critical" as const,rankScore:400_000+Math.max(0,100_000-Math.min(100_000,hours*1_000))};
    if(item.type==="approved_leave_coverage")return{...item,severity:"high" as const,rankScore:330_000+Math.max(0,80_000-Math.min(80_000,hours*800))};
    if(item.type==="coverage_gap"){const live=hours<=0;return{...item,severity:live?"critical" as const:"high" as const,rankScore:(live?400_000:300_000)+Math.min(90_000,Math.max(0,item.gap??0)*15_000)+Math.max(0,60_000-Math.min(60_000,hours*500))}}
    if(item.type==="swap_decision")return{...item,severity:item.state==="candidate_accepted"?"high" as const:"medium" as const,rankScore:item.state==="candidate_accepted"?340_000:220_000};
    if(item.type==="time_correction")return{...item,severity:"high" as const,rankScore:320_000};
    if(item.type==="submitted_hours")return{...item,severity:"medium" as const,rankScore:250_000};
    if(item.type==="open_shift"){const expired=item.state==="expired";const imminent=hours<12;return{...item,severity:expired||imminent?"critical" as const:"high" as const,rankScore:expired?430_000:imminent?390_000:300_000}}
    return{...item,severity:"medium" as const,rankScore:210_000};
  }).sort((left,right)=>right.rankScore-left.rankScore||left.relevantAt.localeCompare(right.relevantAt)||left.actionKey.localeCompare(right.actionKey));
}
