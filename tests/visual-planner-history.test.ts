import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729001600_visual_planner_history.sql","utf8");

describe("visual planner history boundary",()=>{
  it("is transactional, tenant scoped and fail closed",()=>{
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("alter table public.roster_change_sets enable row level security");
    expect(sql).toContain("has_capability(organisation_id,venue_id,'planning.manage')");
    expect(sql).toContain("revoke all on function public.mutate_roster_shifts");
  });

  it("makes a bulk change atomic, idempotent and revision guarded",()=>{
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("unique(organisation_id,idempotency_key)");
    expect(sql).toContain("target_expected_revisions->>s.id::text");
    expect(sql).toContain("raise exception 'concurrent_shift_edit'");
    expect(sql).toContain("other.id<>all(target_shift_ids)");
  });

  it("keeps revisions monotonic through undo and redo",()=>{
    expect(sql.match(/revision=revision\+1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("current_revisions");
    expect(sql).toContain("invalid_history_transition");
    expect(sql).toContain("'roster.'||target_direction");
  });
});
