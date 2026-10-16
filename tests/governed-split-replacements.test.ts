import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002500_governed_split_replacements.sql","utf8");

describe("governed split replacements",()=>{
  it("requires manager authority, revision control, row locks and idempotency",()=>{for(const rule of ["planning.manage","target_expected_revision","for update","pg_advisory_xact_lock","idempotency_key"])expect(sql).toContain(rule)});
  it("revalidates every hard workforce constraint",()=>{for(const rule of ["candidate_unqualified","candidate_unavailable","candidate_absent","candidate_overlap_or_rest","candidate_maximum_hours","replacement_segments_must_be_contiguous","replacement_must_preserve_shift_and_breaks"])expect(sql).toContain(rule)});
  it("creates an immutable successor and auditable evidence",()=>{for(const rule of ["status='superseded'","supersedes_id","shift_replacement_actions_immutable","roster_acknowledgements","notification_outbox","shift.replacement_published"])expect(sql).toContain(rule)});
  it("does not expose execution to public or anonymous callers",()=>{expect(sql).toContain("revoke all on function public.replace_published_shift_segments");expect(sql).toContain("from public,anon")});
});
