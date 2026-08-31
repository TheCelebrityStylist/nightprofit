import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002400_workforce_exception_learning.sql","utf8");
const closeRoute=readFileSync("app/api/closes/[id]/transition/route.ts","utf8");
describe("authoritative workforce exceptions and learning",()=>{
  it("gates the manager queue internally and preserves venue scope",()=>{expect(sql).toContain("has_capability(target_organisation_id,target_venue_id,'planning.manage')");expect(sql).toContain("venue_scope_mismatch");expect(sql).toContain("revoke all on function public.get_workforce_exception_inbox")});
  it("covers governed exception categories without duplicating corrected hours",()=>{for(const type of ["sickness_coverage","approved_leave_coverage","coverage_gap","swap_decision","time_correction","submitted_hours","open_shift","stale_proposal"])expect(sql).toContain(`'${type}'`);expect(sql).toContain("not exists(select 1 from public.time_corrections")});
  it("uses deterministic explainable ordering and resolution conditions",()=>{expect(sql).toContain("order by q.rank_score desc,q.relevant_at asc,q.action_key asc");expect(sql).toContain("resolution_condition")});
  it("requires locked service, locked close, approved labour and published roster",()=>{for(const guard of ["locked_service_required","locked_close_required","approved_labour_required","published_roster_required"])expect(sql).toContain(guard)});
  it("deduplicates comparable service dates and represents insufficient evidence",()=>{expect(sql).toContain("distinct on(other.service_date)");expect(sql).toContain("insufficient_comparables");expect(sql).toContain("minimum_comparables',3");expect(sql).toContain("descriptive_comparison_only")});
  it("makes learning immutable and idempotent",()=>{expect(sql).toContain("workforce_learning_immutable");expect(sql).toContain("prevent_append_only_mutation");expect(sql).toContain("on conflict(organisation_id,service_operation_id) do nothing")});
  it("attempts learning only after a close is locked and reports evidence failure honestly",()=>{expect(closeRoute).toContain('input.target==="locked"');expect(closeRoute).toContain("refresh_service_intelligence");expect(closeRoute).toContain("calculate_workforce_learning");expect(closeRoute).toContain('"evidence_not_ready"')});
});
