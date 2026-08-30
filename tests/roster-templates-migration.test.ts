import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729001700_roster_templates.sql","utf8");

describe("roster template persistence",()=>{
  it("is tenant scoped, RLS protected and transactional",()=>{
    expect(sql.trim().startsWith("begin;")).toBe(true);expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("alter table public.roster_templates enable row level security");
    expect(sql).toContain("has_capability(organisation_id,venue_id,'planning.manage')");
    expect(sql).toContain("revoke all on function public.apply_roster_template");
  });
  it("stores relative patterns and creates persisted drafts",()=>{
    expect(sql).toContain("offset_seconds");expect(sql).toContain("duration_seconds");
    expect(sql).toContain("'recurring_template'");expect(sql).toContain("insert into public.shifts");
  });
  it("guards retries, recurrence bounds and overlapping assignments",()=>{
    expect(sql).toContain("unique(organisation_id,idempotency_key)");expect(sql).toContain("target_repeat_count not between 1 and 52");
    expect(sql).toContain("raise exception 'template_shift_overlap'");expect(sql).toContain("pg_advisory_xact_lock");
  });
});
