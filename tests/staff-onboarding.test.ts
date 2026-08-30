import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {STAFF_ONBOARDING_TOKEN_BYTES,createStaffOnboardingToken,hashStaffOnboardingToken,onboardingMessage} from "../lib/workforce/onboarding";

const sql=readFileSync("supabase/migrations/20260729001800_employee_onboarding.sql","utf8");

describe("secure employee onboarding",()=>{
  it("uses unguessable single-use token material",()=>{const token=createStaffOnboardingToken();expect(STAFF_ONBOARDING_TOKEN_BYTES).toBe(32);expect(token).toHaveLength(43);expect(hashStaffOnboardingToken(token)).toMatch(/^[a-f0-9]{64}$/);expect(()=>hashStaffOnboardingToken("short")).toThrow()});
  it("prepares honest NL and EN manual messages",()=>{expect(onboardingMessage("nl","Sam","Cliniq","https://example.test/i")).toContain("Hoi Sam");expect(onboardingMessage("en","Sam","Cliniq","https://example.test/i")).toContain("Hi Sam")});
  it("creates the invitation and employee scope atomically",()=>{for(const fragment of ["create_invited_staff","insert into public.staff_profiles","insert into public.staff_venue_assignments","insert into public.staff_role_qualifications","insert into public.staff_onboarding_invitations","'staff.invited'"])expect(sql).toContain(fragment);expect(sql.trim().startsWith("begin;")).toBe(true);expect(sql.trim().endsWith("commit;")).toBe(true)});
  it("claims once, creates employee-only membership and audits completion",()=>{expect(sql).toContain("access_role='employee'");expect(sql).toContain("values(invitation.organisation_id,target_user_id,'employee'");expect(sql).toContain("for update");expect(sql).toContain("invitation.claimed_at is not null");expect(sql).toContain("'staff.onboarding_completed'");expect(sql).toContain("to service_role")});
  it("keeps manager visibility behind capability-scoped RLS",()=>{expect(sql).toContain("enable row level security");expect(sql).toContain("has_capability(organisation_id,venue_id,'members.manage')")});
});
