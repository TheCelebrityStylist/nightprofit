import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20260729002100_append_only_timekeeping.sql","utf8");
describe("append-only timekeeping",()=>{
  it("stores immutable source events behind employee and manager reads",()=>{expect(sql).toContain("time_clock_events_immutable");expect(sql).toContain("immutable_time_clock_event");expect(sql).toContain("time_clock_events_self_read");expect(sql).toContain("time_clock_events_manager_read")});
  it("makes every employee transition idempotent",()=>{for(const fn of ["clock_in_v2","start_time_break_v2","end_time_break_v2","clock_out_v2"])expect(sql).toContain(`function public.${fn}`);expect(sql).toContain("unique(organisation_id,idempotency_key)");expect(sql.match(/prior\.id is not null/g)?.length).toBeGreaterThanOrEqual(4)});
  it("rejects invalid concurrent state transitions",()=>{for(const code of ["already_clocked_in","outside_clock_window","no_open_break","open_break","invalid_time_record_state"])expect(sql).toContain(code);expect(sql).toContain("pg_advisory_xact_lock")});
  it("preserves correction evidence and requires a reasoned manager decision",()=>{expect(sql).toContain("public.time_corrections");expect(sql).toContain("correction.proposed_values");expect(sql).not.toContain("original_values=");expect(sql).toContain("decision_reason_required");expect(sql).toContain("'time_correction.'||target_decision")});
  it("records missed events as explicit manager-authored evidence",()=>{expect(sql).toContain("record_missed_time_event");expect(sql).toContain("'missed_event_recorded'");expect(sql).toContain("'recorded_by_manager',true");expect(sql).toContain("'time.missed_event_recorded'")});
});
