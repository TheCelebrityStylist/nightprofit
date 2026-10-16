import {describe,expect,it} from "vitest";
import {overlapExists,planSummary,requiredStaff,shiftCostMinor,shiftMinutes} from "../lib/operations/planning";

describe("operations planning financial truth",()=>{
  const shift={startsAt:"2026-07-28T16:00:00Z",endsAt:"2026-07-28T22:00:00Z",breakMinutes:30,hourlyCostMinor:1800n,staffId:"staff-a"};
  it("calculates payable minutes and rounded minor-unit cost",()=>{
    expect(shiftMinutes(shift)).toBe(330);
    expect(shiftCostMinor(shift)).toBe(9900n);
  });
  it("calculates labor percentage and staffing gap",()=>{
    const result=planSummary([{startsAt:"2026-07-28T18:00:00Z",endsAt:"2026-07-28T20:00:00Z",expectedGuests:120,expectedRevenueMinor:240000n,requiredStaff:5}],[shift]);
    expect(result.expectedRevenueMinor).toBe(240000n);
    expect(result.scheduledLaborMinor).toBe(9900n);
    expect(result.laborBasisPoints).toBe(412n);
    expect(result.staffingGap).toBe(-4);
  });
  it("detects overlaps only for named staff",()=>{
    expect(overlapExists({...shift,startsAt:"2026-07-28T21:00:00Z",endsAt:"2026-07-28T23:00:00Z"},[shift])).toBe(true);
    expect(overlapExists({...shift,staffId:null},[shift])).toBe(false);
  });
  it("ceilings staffing requirements for safety",()=>expect(requiredStaff(91,2,30)).toBe(4));
});
