import { add, marginBasisPoints, type Minor } from "../calculations";

export type DemandInterval = {
  startsAt: string;
  endsAt: string;
  expectedGuests: number;
  expectedRevenueMinor: Minor;
  requiredStaff: number;
};

export type PlannedShift = {
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  hourlyCostMinor: Minor;
  staffId: string | null;
};

export function shiftMinutes(shift: Pick<PlannedShift,"startsAt"|"endsAt"|"breakMinutes">) {
  const elapsed=Math.floor((new Date(shift.endsAt).getTime()-new Date(shift.startsAt).getTime())/60000);
  return Math.max(0,elapsed-shift.breakMinutes);
}

export function shiftCostMinor(shift: PlannedShift): Minor {
  return (shift.hourlyCostMinor*BigInt(shiftMinutes(shift))+30n)/60n;
}

export function planSummary(intervals:DemandInterval[],shifts:PlannedShift[]) {
  const expectedRevenueMinor=add(...intervals.map(interval=>interval.expectedRevenueMinor));
  const scheduledLaborMinor=add(...shifts.map(shiftCostMinor));
  const requiredStaffPeak=intervals.reduce((peak,interval)=>Math.max(peak,interval.requiredStaff),0);
  const scheduledStaffPeak=intervals.reduce((peak,interval)=>{
    const concurrent=shifts.filter(shift=>new Date(shift.startsAt)<new Date(interval.endsAt)&&new Date(shift.endsAt)>new Date(interval.startsAt)).length;
    return Math.max(peak,concurrent);
  },0);
  return {
    expectedRevenueMinor,
    scheduledLaborMinor,
    laborBasisPoints:marginBasisPoints(scheduledLaborMinor,expectedRevenueMinor),
    requiredStaffPeak,
    scheduledStaffPeak,
    staffingGap:scheduledStaffPeak-requiredStaffPeak,
  };
}

export function overlapExists(candidate:PlannedShift,existing:PlannedShift[]) {
  if(!candidate.staffId)return false;
  return existing.some(shift=>shift.staffId===candidate.staffId&&new Date(shift.startsAt)<new Date(candidate.endsAt)&&new Date(shift.endsAt)>new Date(candidate.startsAt));
}

export function requiredStaff(expectedGuests:number,minimumStaff:number,guestsPerStaff:number) {
  return Math.max(minimumStaff,Math.ceil(expectedGuests/guestsPerStaff));
}
