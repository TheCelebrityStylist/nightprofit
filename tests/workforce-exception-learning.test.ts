import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/20260729002400_workforce_exception_learning.sql","utf8");

describe("workforce exception queue and learning",()=>{
  it("exposes one planning-manager-gated ranked queue from persisted workforce facts",()=>{
    expect(sql).toContain("function public.get_workforce_exception_queue");
    expect(sql).toContain("if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'");
    expect(sql).toContain("f.status='approved'");
    expect(sql).toContain("'coverage_gap'");
    expect(sql).toContain("'sickness_replacement'");
    expect(sql).toContain("'leave_coverage'");
    expect(sql).toContain("'shift_swap'");
    expect(sql).toContain("'time_correction'");
    expect(sql).toContain("'submitted_hours'");
    expect(sql).toContain("order by q.rank_score desc,q.due_at nulls last,q.action_key");
  });

  it("keeps exception ranking deterministic, current and evidence visible",()=>{
    expect(sql).toContain("jsonb_build_object('source','approved_demand_and_roster'");
    expect(sql).toContain("jsonb_build_object('source','recorded_sickness'");
    expect(sql).toContain("jsonb_build_object('source','swap_request'");
    expect(sql).toContain("jsonb_build_object('source','time_correction'");
    expect(sql).toContain("jsonb_build_object('source','submitted_time_record'");
    expect(sql).toContain("a.action_key='leave-coverage:'||sa.id::text");
    expect(sql).toContain("and not exists(select 1 from public.time_corrections");
    expect(sql).not.toContain("ai_proposals");
  });

  it("stores workforce learning as immutable evidence",()=>{
    expect(sql).toContain("create table public.workforce_learning_results");
    expect(sql).toContain("workforce_learning_append_only");
    expect(sql).toContain("prevent_append_only_mutation");
    expect(sql).toContain("unique(organisation_id,content_hash)");
    expect(sql).toContain("workforce-learning-v1");
  });

  it("learns only from locked services, locked closes and approved labour",()=>{
    expect(sql).toContain("status='locked' order by version desc limit 1");
    expect(sql).toContain("from public.approved_labour_results");
    expect(sql).toContain("c.status='locked'");
    expect(sql).toContain("if op.id is null or labour.id is null or close_row.id is null then return result");
    expect(sql).toContain("approved_labour_content_hash");
    expect(sql).toContain("roster_content_hash");
    expect(sql).toContain("reconciliation_result_hash");
  });

  it("uses distinct bounded comparable services and reports insufficient evidence rather than guessing",()=>{
    expect(sql).toContain("select distinct on(prior.service_date) prior.*");
    expect(sql).toContain("extract(isodow from prior.service_date)=extract(isodow from target_trading_date)");
    expect(sql).toContain("planned_revenue/4");
    expect(sql).toContain("limit 8");
    expect(sql).toContain("comparable_count<2");
    expect(sql).toContain("insufficient_comparables");
    expect(sql).toContain("insufficient_evidence");
  });

  it("captures learning on both service lock and later authoritative labour evidence",()=>{
    expect(sql).toContain("service_operation_workforce_learning");
    expect(sql).toContain("approved_labour_workforce_learning");
    expect(sql).toContain("perform public.capture_workforce_learning(new.organisation_id,new.venue_id,new.service_date)");
    expect(sql).toContain("perform public.capture_workforce_learning(new.organisation_id,new.venue_id,new.trading_date)");
    expect(sql).toContain("Backfill only already-locked services");
  });

  it("does not expose the internal learning writer to authenticated clients",()=>{
    expect(sql).toContain("revoke all on function public.capture_workforce_learning(uuid,uuid,date) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.get_workforce_exception_queue(uuid,uuid,timestamptz,timestamptz) to authenticated");
  });
});
