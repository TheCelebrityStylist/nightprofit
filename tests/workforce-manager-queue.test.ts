import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const route=readFileSync("app/api/workforce/exceptions/route.ts","utf8");
const component=readFileSync("app/workforce-decision-queue.tsx","utf8");

describe("manager workforce decision queue",()=>{
  it("loads the ranked queue only through a planning-manager membership boundary",()=>{
    expect(route).toContain('requireMembership(input.organisationId,"planning.manage",input.venueId)');
    expect(route).toContain('supabase.rpc("get_workforce_exception_queue"');
    expect(route).toContain("target_window_start:input.startsAt");
    expect(route).toContain("target_window_end:input.endsAt");
  });

  it("returns immutable learning evidence for the same venue and visible window",()=>{
    expect(route).toContain('from("workforce_learning_results"');
    expect(route).toContain('.eq("venue_id",input.venueId)');
    expect(route).toContain('.gte("service_date",startDate)');
    expect(route).toContain('.lt("service_date",endDate)');
    expect(route).toContain("comparison_basis,lessons,evidence_refs,calculation_version,content_hash");
  });

  it("renders the persisted server ranking rather than calculating a competing client score",()=>{
    expect(component).toContain("VERIFIED DECISION PRIORITY");
    expect(component).toContain("queue.slice(0,8)");
    expect(component).toContain("row.rank_score");
    expect(component).toContain("JSON.stringify(row.evidence_refs,null,2)");
    expect(component).not.toContain("rankReplacements");
    expect(component).not.toContain("calculateCoverage");
  });

  it("is bilingual and refuses to infer learning from insufficient comparable evidence",()=>{
    expect(component).toContain("GEVERIFIEERDE BESLISVOLGORDE");
    expect(component).toContain("insufficient_evidence");
    expect(component).toContain("NightProfit trekt nog geen conclusie");
    expect(component).toContain("NightProfit does not infer a conclusion yet");
  });

  it("refetches when the active venue or visible planner window changes",()=>{
    expect(component).toContain("[organisationId,venueId,windowStart,windowEnd,locale]");
    expect(component).toContain("AbortController");
    expect(component).toContain("/api/workforce/exceptions?");
  });
});
