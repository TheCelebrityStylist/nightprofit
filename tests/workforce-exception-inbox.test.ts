import {describe,expect,it} from "vitest";
import {rankWorkforceExceptions,type WorkforceExceptionInput} from "../lib/workforce/exception-inbox";

const now="2026-08-31T10:00:00.000Z";
describe("workforce exception inbox",()=>{
  it("returns an empty queue for empty evidence",()=>expect(rankWorkforceExceptions([],now)).toEqual([]));
  it("ranks live gaps, sickness and expired offers ahead of administrative work",()=>{
    const input:WorkforceExceptionInput[]=[
      {actionKey:"hours:1",type:"submitted_hours",relevantAt:now},
      {actionKey:"sickness:1",type:"sickness_coverage",relevantAt:"2026-08-31T12:00:00.000Z"},
      {actionKey:"gap:1",type:"coverage_gap",relevantAt:"2026-08-31T09:00:00.000Z",gap:3},
      {actionKey:"offer:1",type:"open_shift",relevantAt:"2026-08-31T11:00:00.000Z",state:"expired"},
    ];
    expect(rankWorkforceExceptions(input,now).map(item=>item.actionKey)).toEqual(["gap:1","sickness:1","offer:1","hours:1"]);
  });
  it("elevates a consented swap above one awaiting consent",()=>{
    const ranked=rankWorkforceExceptions([{actionKey:"requested",type:"swap_decision",state:"requested",relevantAt:now},{actionKey:"accepted",type:"swap_decision",state:"candidate_accepted",relevantAt:now}],now);
    expect(ranked.map(item=>item.actionKey)).toEqual(["accepted","requested"]);
  });
  it("is reproducible with stable tie-breaking",()=>{
    const input:WorkforceExceptionInput[]=[{actionKey:"b",type:"time_correction",relevantAt:now},{actionKey:"a",type:"time_correction",relevantAt:now}];
    expect(rankWorkforceExceptions(input,now)).toEqual(rankWorkforceExceptions(input,now));
    expect(rankWorkforceExceptions(input,now).map(item=>item.actionKey)).toEqual(["a","b"]);
  });
  it("keeps leave, correction and stale evidence explicit",()=>{
    const ranked=rankWorkforceExceptions([{actionKey:"leave",type:"approved_leave_coverage",relevantAt:"2026-09-01T10:00:00.000Z"},{actionKey:"correction",type:"time_correction",relevantAt:now},{actionKey:"stale",type:"stale_proposal",relevantAt:now}],now);
    expect(ranked.map(item=>item.type)).toEqual(["approved_leave_coverage","time_correction","stale_proposal"]);
  });
});
