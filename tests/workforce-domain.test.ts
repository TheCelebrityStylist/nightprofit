import {describe,expect,it} from "vitest";
import {laborCostMinor,normalizeDutchPhone,restWarning,transitionOpenShift,transitionSwap,workedMinutes} from "../lib/workforce/domain";

describe("workforce execution rules",()=>{
  it("enforces open-shift states",()=>{
    expect(transitionOpenShift("draft","offered")).toBe("offered");
    expect(()=>transitionOpenShift("confirmed","claiming")).toThrow();
  });
  it("requires manager resolution for swaps",()=>{
    expect(transitionSwap("requested","candidate_accepted")).toBe("candidate_accepted");
    expect(()=>transitionSwap("requested","approved")).toThrow();
  });
  it("calculates exact worked time and cost",()=>{
    expect(workedMinutes("2026-07-28T16:00:00Z","2026-07-29T00:00:00Z",30)).toBe(450);
    expect(laborCostMinor(450,2250n)).toBe(16875n);
    expect(()=>workedMinutes("2026-07-28T16:00:00Z","2026-07-28T15:00:00Z",0)).toThrow();
  });
  it("separates overlap blocks from rest overrides",()=>{
    expect(restWarning("2026-07-28T22:00:00Z","2026-07-28T21:00:00Z")).toBe("block");
    expect(restWarning("2026-07-28T22:00:00Z","2026-07-29T06:00:00Z")).toBe("override");
    expect(restWarning("2026-07-28T22:00:00Z","2026-07-29T10:00:00Z")).toBeNull();
  });
  it("normalizes Dutch WhatsApp destinations without implying connectivity",()=>{
    expect(normalizeDutchPhone("06 1234 5678")).toBe("+31612345678");
    expect(()=>normalizeDutchPhone("123")).toThrow();
  });
});
