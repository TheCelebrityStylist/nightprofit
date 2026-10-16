import {describe,expect,it} from "vitest";
import {analyzeRosterConstraints,calculateCoverage,payrollReadyTotals,rankReplacements,rosterHealth,simulateDemand} from "../lib/workforce/decision-support";

const requirement={id:"r1",startsAt:"2026-08-29T20:00:00Z",endsAt:"2026-08-29T20:30:00Z",roleId:"bar",requiredStaff:2,expectedRevenueMinor:100000n};
const shift={id:"s1",startsAt:"2026-08-29T19:00:00Z",endsAt:"2026-08-30T03:00:00Z",roleId:"bar",staffId:"a",hourlyCostMinor:1800n,breakMinutes:30};

describe("workforce decision support",()=>{
  it("reports overlaps, minimum rest and maximum weekly minutes deterministically",()=>{
    const result=analyzeRosterConstraints([
      {id:"a",staffId:"s1",startsAt:"2026-08-01T18:00:00Z",endsAt:"2026-08-02T02:00:00Z",breakMinutes:30},
      {id:"b",staffId:"s1",startsAt:"2026-08-02T01:30:00Z",endsAt:"2026-08-02T04:00:00Z",breakMinutes:0},
      {id:"c",staffId:"s1",startsAt:"2026-08-02T12:00:00Z",endsAt:"2026-08-02T16:00:00Z",breakMinutes:0},
    ],[{id:"s1",maximumMinutes:600}]);
    expect(result).toMatchObject({overlaps:1,restViolations:1,maximumMinutesViolations:1,total:3});
    expect(result.minutesByStaff.get("s1")).toBe(840);
  });
  it("calculates interval coverage and cost using integer minor units",()=>{
    const [row]=calculateCoverage([requirement],[shift]);
    expect(row).toMatchObject({plannedStaff:1,gap:1,overstaffing:0,plannedCostMinor:900n,laborBasisPoints:90});
  });
  it("keeps blocking violations explicit instead of hiding them in a score",()=>{
    const coverage=calculateCoverage([requirement],[shift]);
    const health=rosterHealth({coverage,hardConstraintViolations:1,availabilityConflicts:0,skillConflicts:0,laborBasisPoints:1800,targetLaborBasisPoints:1500,hourImbalances:1,preferenceMisses:1,breakConflicts:0,missingEvidence:["bookings"]});
    expect(health.publishable).toBe(false);
    expect(health.issues.filter(issue=>issue.severity==="blocking").map(issue=>issue.code)).toEqual(["UNCOVERED_INTERVALS","HARD_CONSTRAINTS"]);
  });
  it("simulates demand without mutating authoritative coverage",()=>{
    const coverage=calculateCoverage([requirement],[shift]);
    const [result]=simulateDemand(coverage,2000);
    expect(result).toMatchObject({requiredStaff:3,requiredStaffChange:1,gap:2,expectedRevenueMinor:120000n});
    expect(coverage[0].requiredStaff).toBe(2);
  });
  it("filters invalid sickness replacements and ranks transparent valid options",()=>{
    const ranked=rankReplacements([
      {staffId:"cheap-but-unavailable",eligible:true,available:false,restCompliant:true,skillsValid:true,projectedMinutes:300,maximumMinutes:600,costDifferenceMinor:-500n,preferred:true},
      {staffId:"b",eligible:true,available:true,restCompliant:true,skillsValid:true,projectedMinutes:400,maximumMinutes:600,costDifferenceMinor:100n,preferred:false},
      {staffId:"a",eligible:true,available:true,restCompliant:true,skillsValid:true,projectedMinutes:500,maximumMinutes:600,costDifferenceMinor:200n,preferred:true},
    ]);
    expect(ranked.map(row=>row.staffId)).toEqual(["a","b"]);
  });
  it("rejects unapproved payroll hours and calculates supplements deterministically",()=>{
    expect(()=>payrollReadyTotals([{staffId:"a",workedMinutes:60,hourlyCostMinor:2000n,supplementBasisPoints:2500,approved:false}])).toThrow("UNAPPROVED_HOURS");
    expect(payrollReadyTotals([{staffId:"a",workedMinutes:60,hourlyCostMinor:2000n,supplementBasisPoints:2500,approved:true}])[0]).toMatchObject({baseMinor:2000n,supplementMinor:500n,totalMinor:2500n});
  });
});
