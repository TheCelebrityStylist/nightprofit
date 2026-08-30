import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729002200_authoritative_labour_propagation.sql","utf8");

describe("authoritative labour propagation",()=>{
  it("keeps recurring template shifts inside the constrained source vocabulary",()=>{
    expect(sql).toContain("'recurring_template'");
    expect(sql).toContain("add constraint shifts_source_check");
  });
  it("makes approved results immutable and manager scoped",()=>{
    expect(sql).toContain("approved_labour_results_immutable");
    expect(sql).toContain("immutable_approved_labour_result");
    expect(sql).toContain("has_capability(target_organisation_id,target_venue_id,'time.approve')");
  });
  it("requires a published roster and fully approved time evidence",()=>{
    expect(sql).toContain("published_roster_required");
    expect(sql).toContain("unapproved_time_records");
    expect(sql).toContain("t.status='approved'");
  });
  it("uses venue-time paid minutes, recorded breaks and dated supplements",()=>{
    expect(sql.match(/generate_series/g)?.length).toBe(2);
    expect(sql).toContain("at time zone venue_row.timezone");
    expect(sql).toContain("public.shift_break_plans");
    expect(sql).toContain("public.time_breaks");
    expect(sql).toContain("public.staff_cost_supplements");
    expect(sql).toContain("600000");
  });
  it("stores deterministic evidence and is retry safe",()=>{
    expect(sql).toContain("nightprofit-labour-v2");
    expect(sql).toContain("roster_content_hash");
    expect(sql).toContain("approved_time_records");
    expect(sql).toContain("on conflict(organisation_id,venue_id,trading_date,content_hash) do nothing");
  });
  it("propagates only approved labour into pulse, learning and close",()=>{
    expect(sql).toContain("enforce_authoritative_service_labour");
    expect(sql).toContain("awaiting_manager_approval");
    expect(sql).toContain("labour.approved_and_propagated");
    expect(sql).toContain("'authoritative-labour'");
    expect(sql).toContain("on conflict(organisation_id,closing_session_id,idempotency_key)");
  });
  it("makes time approval the propagation boundary",()=>{
    expect(sql).toContain("function public.approve_time_record");
    expect(sql).toContain("perform public.calculate_approved_labour_result");
  });
});
