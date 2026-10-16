import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002000_governed_open_shifts.sql","utf8");
describe("governed open shifts",()=>{
  it("shows offers only through employee-scoped deterministic eligibility",()=>{for(const fragment of ["candidate.auth_user_id=auth.uid()","staff_role_qualifications","staff_availability","staff_absences","interval '11 hours'"])expect(sql).toContain(fragment)});
  it("revalidates every hard rule during the locked claim",()=>{for(const code of ["staff_unqualified","staff_unavailable","absence_conflict","overlap_or_rest_conflict","maximum_hours_conflict"])expect(sql).toContain(code);expect(sql).toContain("for update")});
  it("makes retry safe and one acceptance authoritative",()=>{expect(sql).toContain("existing_claim.status='selected'");expect(sql).toContain("offer.state not in('offered','claiming')");expect(sql).toContain("state='assigned'")});
  it("creates an immutable successor publication",()=>{expect(sql).toContain("update public.roster_versions set status='superseded'");expect(sql).toContain("'open_shift_claim'");expect(sql).toContain("successor_roster_version_id");expect(sql).toContain("roster_acknowledgements")});
});
