import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729001500_workforce_decision_loop.sql","utf8");

describe("workforce decision-loop migration",()=>{
  it("enables fail-closed tenant policies on every new table",()=>{
    for(const table of ["workforce_scenarios","shift_break_plans","payroll_export_versions","payroll_export_lines"]){
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("has_capability(organisation_id,venue_id,'planning.manage')");
  });
  it("revalidates hard constraints inside immutable publication",()=>{
    for(const rule of ["open_shift_unresolved","availability_conflict","role_qualification_missing","absence_conflict","minimum_rest_violation","maximum_hours_violation"]){
      expect(sql).toContain(rule);
    }
    expect(sql).toContain("before insert on public.roster_versions");
  });
  it("makes approved payroll exports immutable",()=>{
    expect(sql).toContain("immutable_payroll_export");
    expect(sql).toContain("payroll_versions_immutable before update or delete");
    expect(sql).toContain("payroll_lines_immutable before update or delete");
  });
});
