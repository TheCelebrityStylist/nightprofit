export type WarningLevel="block"|"override"|"info";
export type OpenShiftState="draft"|"offered"|"claiming"|"assigned"|"confirmed"|"withdrawn"|"expired"|"cancelled";
export type SwapState="requested"|"candidate_accepted"|"approved"|"rejected"|"cancelled";

const openTransitions:Record<OpenShiftState,readonly OpenShiftState[]>={
  draft:["offered","cancelled"],offered:["claiming","expired","cancelled"],
  claiming:["assigned","expired","cancelled"],assigned:["confirmed","withdrawn","cancelled"],
  confirmed:[],withdrawn:[],expired:[],cancelled:[],
};
const swapTransitions:Record<SwapState,readonly SwapState[]>={
  requested:["candidate_accepted","rejected","cancelled"],
  candidate_accepted:["approved","rejected","cancelled"],approved:[],rejected:[],cancelled:[],
};

export function transitionOpenShift(from:OpenShiftState,to:OpenShiftState){
  if(!openTransitions[from].includes(to))throw new Error(`Invalid open-shift transition: ${from} → ${to}`);
  return to;
}

export function transitionSwap(from:SwapState,to:SwapState){
  if(!swapTransitions[from].includes(to))throw new Error(`Invalid swap transition: ${from} → ${to}`);
  return to;
}

export function workedMinutes(clockIn:string,clockOut:string,breakMinutes:number){
  const elapsed=Math.floor((new Date(clockOut).getTime()-new Date(clockIn).getTime())/60_000);
  if(!Number.isInteger(breakMinutes)||breakMinutes<0||elapsed<=0||breakMinutes>elapsed)throw new Error("Invalid attendance duration");
  return elapsed-breakMinutes;
}

export function laborCostMinor(minutes:number,hourlyCostMinor:bigint){
  if(!Number.isInteger(minutes)||minutes<0||hourlyCostMinor<0n)throw new Error("Invalid labor input");
  return (BigInt(minutes)*hourlyCostMinor+30n)/60n;
}

export function restWarning(previousEnd:string,nextStart:string,minimumRestMinutes=660):WarningLevel|null{
  const rest=Math.floor((new Date(nextStart).getTime()-new Date(previousEnd).getTime())/60_000);
  if(rest<0)return "block";
  return rest<minimumRestMinutes?"override":null;
}

export function normalizeDutchPhone(value:string){
  const digits=value.replace(/\D/g,"");
  const normalized=digits.startsWith("00")?`+${digits.slice(2)}`:digits.startsWith("0")?`+31${digits.slice(1)}`:digits.startsWith("31")?`+${digits}`:value.startsWith("+")?`+${digits}`:"";
  if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new Error("Invalid destination phone");
  return normalized;
}
