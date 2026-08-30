import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002300_reasoned_leave_decisions.sql","utf8");
describe("reasoned leave decisions",()=>{
  it("locks and authorizes the tenant-scoped request",()=>{expect(sql).toContain("for update");expect(sql).toContain("has_capability(target_organisation_id,absence.venue_id,'planning.manage')")});
  it("requires a reason and records affected-shift evidence",()=>{expect(sql).toContain("decision_reason_required");expect(sql).toContain("'affected_shifts',affected");expect(sql).toContain("'leave.'||target_decision")});
  it("invalidates proposals and opens an exact coverage action",()=>{expect(sql).toContain("set status='stale'");expect(sql).toContain("'leave-coverage:'||absence.id");expect(sql).toContain("controlled successor version")});
});
