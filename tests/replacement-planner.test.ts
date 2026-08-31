import {describe,expect,it} from "vitest";
import {planReplacementSegments,type ReplacementCandidate} from "../lib/workforce/replacement-planner";

const shift={startsAt:"2026-09-04T18:00:00.000Z",endsAt:"2026-09-05T02:00:00.000Z",breakMinutes:30};
const candidate=(staffId:string,startsAt:string,endsAt:string,cost=1800,eligible=true):ReplacementCandidate=>({staffId,name:staffId,hourlyCostMinor:BigInt(cost),eligible,availability:[{startsAt,endsAt}]});

describe("governed replacement preview",()=>{
  it("prefers one complete, lower-cost candidate deterministically",()=>{
    const plan=planReplacementSegments(shift,[candidate("b",shift.startsAt,shift.endsAt,1900),candidate("a",shift.startsAt,shift.endsAt,1800)]);
    expect(plan.complete).toBe(true);expect(plan.segments).toHaveLength(1);expect(plan.segments[0]).toMatchObject({staff_id:"a",break_minutes:30});expect(plan.plannedCostMinor).toBe(13_500n);
  });
  it("joins contiguous availability into at most four segments and preserves breaks",()=>{
    const plan=planReplacementSegments(shift,[candidate("early",shift.startsAt,"2026-09-04T22:00:00.000Z"),candidate("late","2026-09-04T22:00:00.000Z",shift.endsAt)]);
    expect(plan.complete).toBe(true);expect(plan.segments.map(row=>row.staff_id)).toEqual(["early","late"]);expect(plan.segments.reduce((sum,row)=>sum+row.break_minutes,0)).toBe(30);
  });
  it("reports an exact uncovered point instead of inventing coverage",()=>{
    const plan=planReplacementSegments(shift,[candidate("early",shift.startsAt,"2026-09-04T21:00:00.000Z"),candidate("late","2026-09-04T22:00:00.000Z",shift.endsAt)]);
    expect(plan.complete).toBe(false);expect(plan.uncoveredFrom).toBe("2026-09-04T21:00:00.000Z");
  });
  it("excludes candidates that failed server-equivalent prechecks",()=>{
    const plan=planReplacementSegments(shift,[candidate("invalid",shift.startsAt,shift.endsAt,1000,false)]);
    expect(plan.complete).toBe(false);expect(plan.segments).toEqual([]);
  });
  it("uses remaining weekly capacity to build a valid split",()=>{
    const first={...candidate("first",shift.startsAt,shift.endsAt),maxWorkMinutes:240};
    const plan=planReplacementSegments(shift,[first,candidate("second","2026-09-04T22:00:00.000Z",shift.endsAt)]);
    expect(plan.complete).toBe(true);expect(plan.segments.map(row=>row.staff_id)).toEqual(["first","second"]);
  });
});
