import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729001900_controlled_shift_swaps.sql","utf8");
describe("controlled shift swaps",()=>{
  it("requires employee ownership, candidate consent and manager authority",()=>{expect(sql).toContain("requester.auth_user_id=auth.uid()");expect(sql).toContain("id=result.candidate_staff_id and auth_user_id=auth.uid()");expect(sql).toContain("candidate_consent_required");expect(sql).toContain("has_capability(target_organisation_id,swap_row.venue_id,'planning.manage')")});
  it("revalidates eligibility on approval",()=>{for(const rule of ["candidate_unqualified","candidate_unavailable","candidate_absent","candidate_overlap_or_rest","candidate_maximum_hours"])expect(sql).toContain(rule)});
  it("preserves publication history through a successor",()=>{expect(sql).toContain("update public.roster_versions set status='superseded'");expect(sql).toContain("supersedes_id");expect(sql).toContain("successor_roster_version_id");expect(sql).toContain("'swap.approved'");expect(sql).toContain("roster_acknowledgements")});
  it("is idempotent and keeps employee reads scoped",()=>{expect(sql).toContain("swap_requests_idempotency_unique");expect(sql).toContain("swap_employee_read");expect(sql).toContain("s.id in(swap_requests.requester_staff_id,swap_requests.candidate_staff_id)")});
});
