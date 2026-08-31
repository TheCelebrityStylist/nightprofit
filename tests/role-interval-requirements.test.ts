import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002600_role_interval_staffing_requirements.sql","utf8");
const route=readFileSync("app/api/planning/route.ts","utf8");

describe("role and interval staffing requirements",()=>{
  it("versions persisted requirements from demand evidence",()=>{for(const rule of ["staffing_requirement_versions","staffing_requirement_intervals","input_evidence","calculation_version","status='superseded'","staffing.requirements_refreshed"])expect(sql).toContain(rule)});
  it("uses integer ceiling logic for every active venue role",()=>{expect(sql).toContain("i.expected_guests+r.guests_per_staff-1");expect(sql).toContain("greatest(r.minimum_staff");expect(sql).toContain("r.active")});
  it("is tenant-scoped, capability protected and serialised",()=>{for(const rule of ["planning.manage","target_organisation_id","target_venue_id","pg_advisory_xact_lock","revoke all on function"])expect(sql).toContain(rule)});
  it("binds each three-option generation to persisted requirement evidence",()=>{expect(route).toContain("refresh_staffing_requirements");expect(route).toContain("staffing_requirement_versions:requirementEvidence")});
  it("excludes superseded demand inputs through an invoker-rights view",()=>{expect(sql).toContain("current_demand_forecast_intervals with(security_invoker=true,security_barrier=true)");expect(sql).toContain("newer.created_at>f.created_at");expect(route).toContain('from("current_demand_forecast_intervals"')});
});
