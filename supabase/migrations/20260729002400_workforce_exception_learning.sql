begin;

-- A single evidence-backed manager queue for workforce exceptions. The queue is
-- derived from persisted operational facts at read time; no opaque score or AI
-- output can create or hide an exception.
create or replace function public.get_workforce_exception_queue(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_window_start timestamptz,
  target_window_end timestamptz
) returns table(
  action_key text,
  action_type text,
  severity text,
  rank_score bigint,
  due_at timestamptz,
  title text,
  rationale text,
  evidence_refs jsonb,
  shift_id uuid,
  staff_id uuid,
  related_id uuid
) language plpgsql stable security definer set search_path='' as $$
begin
  if target_window_end<=target_window_start then raise exception 'invalid_window'; end if;
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;

  return query
  with coverage as (
    select i.id,i.starts_at,i.ends_at,i.required_staff,
      count(distinct s.id) filter(where s.staff_id is not null)::integer planned_staff
    from public.demand_forecast_intervals i
    join public.demand_forecasts f on f.organisation_id=i.organisation_id and f.id=i.forecast_id and f.status='approved'
    left join public.shifts s on s.organisation_id=i.organisation_id and s.venue_id=i.venue_id
      and s.status not in('cancelled','rejected') and s.staff_id is not null
      and s.starts_at<i.ends_at and s.ends_at>i.starts_at
    where i.organisation_id=target_organisation_id and i.venue_id=target_venue_id
      and i.starts_at<target_window_end and i.ends_at>target_window_start
    group by i.id,i.starts_at,i.ends_at,i.required_staff
  ), queue as (
    select
      'coverage:'||c.id::text action_key,
      'coverage_gap'::text action_type,
      case when c.starts_at<=now()+interval '12 hours' then 'critical' else 'high' end severity,
      (case when c.starts_at<=now()+interval '12 hours' then 950000 else 850000 end
        +(greatest(c.required_staff-c.planned_staff,0)*1000))::bigint rank_score,
      c.starts_at due_at,
      'Close roster coverage gap'::text title,
      greatest(c.required_staff-c.planned_staff,0)||' required position(s) are not covered in this demand interval.' rationale,
      jsonb_build_array(jsonb_build_object('source','approved_demand_and_roster','interval_id',c.id,'required_staff',c.required_staff,'planned_staff',c.planned_staff,'starts_at',c.starts_at,'ends_at',c.ends_at)) evidence_refs,
      null::uuid shift_id,null::uuid staff_id,c.id related_id
    from coverage c where c.planned_staff<c.required_staff

    union all

    select
      'sickness:'||a.id::text||':'||s.id::text,
      'sickness_replacement',
      case when s.starts_at<=now()+interval '12 hours' then 'critical' else 'high' end,
      (case when s.starts_at<=now()+interval '12 hours' then 970000 else 870000 end)::bigint,
      s.starts_at,
      'Replace sickness-affected shift',
      'A recorded sickness overlaps a staffed shift and requires a controlled replacement or open-shift path.',
      jsonb_build_array(jsonb_build_object('source','recorded_sickness','absence_id',a.id,'shift_id',s.id,'staff_id',a.staff_id,'role_id',s.role_id,'starts_at',s.starts_at,'ends_at',s.ends_at)),
      s.id,a.staff_id,a.id
    from public.staff_absences a
    join public.shifts s on s.organisation_id=a.organisation_id and s.venue_id=a.venue_id and s.staff_id=a.staff_id
      and s.status not in('cancelled','rejected','completed') and s.starts_at<a.ends_at and s.ends_at>a.starts_at
    where a.organisation_id=target_organisation_id and a.venue_id=target_venue_id
      and a.absence_type='sickness' and a.status='recorded'
      and s.starts_at<target_window_end and s.ends_at>target_window_start

    union all

    select
      a.action_key,
      'leave_coverage',
      a.severity,
      greatest(a.rank_score,780000)::bigint,
      a.due_at,
      a.title,
      a.rationale,
      a.evidence_refs,
      null::uuid,
      sa.staff_id,
      sa.id
    from public.operating_actions a
    join public.staff_absences sa on sa.organisation_id=a.organisation_id and a.action_key='leave-coverage:'||sa.id::text
    where a.organisation_id=target_organisation_id and a.venue_id=target_venue_id
      and a.action_type='leave_decision' and a.status in('open','approved','in_progress') and sa.status='approved'
      and sa.starts_at<target_window_end and sa.ends_at>target_window_start
      and exists(select 1 from public.shifts s where s.organisation_id=sa.organisation_id and s.venue_id=sa.venue_id and s.staff_id=sa.staff_id
        and s.status not in('cancelled','rejected','completed') and s.starts_at<sa.ends_at and s.ends_at>sa.starts_at
        and s.starts_at<target_window_end and s.ends_at>target_window_start)

    union all

    select
      'swap:'||sw.id::text,
      'shift_swap',
      case when sw.state='candidate_accepted' then 'high' else 'medium' end,
      (case when sw.state='candidate_accepted' then 820000 else 640000 end)::bigint,
      s.starts_at,
      'Review controlled shift swap',
      case when sw.state='candidate_accepted'
        then 'The proposed colleague consented; manager approval must revalidate hard workforce rules.'
        else 'A published shift has an employee-initiated swap request waiting for candidate consent or manager review.' end,
      jsonb_build_array(jsonb_build_object('source','swap_request','swap_id',sw.id,'state',sw.state,'shift_id',sw.shift_id,'requester_staff_id',sw.requester_staff_id,'candidate_staff_id',sw.candidate_staff_id,'cost_effect_minor',sw.cost_effect_minor)),
      sw.shift_id,sw.requester_staff_id,sw.id
    from public.swap_requests sw
    join public.shifts s on s.organisation_id=sw.organisation_id and s.id=sw.shift_id
    where sw.organisation_id=target_organisation_id and sw.venue_id=target_venue_id
      and sw.state in('requested','candidate_accepted')
      and s.starts_at<target_window_end and s.ends_at>target_window_start

    union all

    select
      'time-correction:'||tc.id::text,
      'time_correction',
      'medium',
      610000::bigint,
      tr.clocked_out_at,
      'Review time correction',
      'A correction request is waiting for a reasoned manager decision while the original clock evidence remains append-only.',
      jsonb_build_array(jsonb_build_object('source','time_correction','correction_id',tc.id,'time_record_id',tc.time_record_id,'reason',tc.reason,'original_values',tc.original_values,'proposed_values',tc.proposed_values)),
      tr.shift_id,tr.staff_id,tc.id
    from public.time_corrections tc
    join public.time_records tr on tr.organisation_id=tc.organisation_id and tr.id=tc.time_record_id
    where tc.organisation_id=target_organisation_id and tc.venue_id=target_venue_id and tc.status='requested'
      and tr.clocked_in_at<target_window_end and coalesce(tr.clocked_out_at,tr.clocked_in_at)>target_window_start

    union all

    select
      'submitted-hours:'||tr.id::text,
      'submitted_hours',
      'medium',
      590000::bigint,
      tr.clocked_out_at,
      'Approve submitted hours',
      'Completed clock evidence is submitted but has not crossed the manager approval boundary for authoritative labour.',
      jsonb_build_array(jsonb_build_object('source','submitted_time_record','time_record_id',tr.id,'staff_id',tr.staff_id,'shift_id',tr.shift_id,'clocked_in_at',tr.clocked_in_at,'clocked_out_at',tr.clocked_out_at,'break_minutes',tr.break_minutes)),
      tr.shift_id,tr.staff_id,tr.id
    from public.time_records tr
    where tr.organisation_id=target_organisation_id and tr.venue_id=target_venue_id
      and tr.status='submitted' and tr.clocked_out_at is not null
      and tr.clocked_in_at<target_window_end and tr.clocked_out_at>target_window_start
      and not exists(select 1 from public.time_corrections tc where tc.organisation_id=tr.organisation_id and tc.time_record_id=tr.id and tc.status='requested')
  )
  select q.action_key,q.action_type,q.severity,q.rank_score,q.due_at,q.title,q.rationale,q.evidence_refs,q.shift_id,q.staff_id,q.related_id
  from queue q
  order by q.rank_score desc,q.due_at nulls last,q.action_key;
end $$;

revoke all on function public.get_workforce_exception_queue(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_workforce_exception_queue(uuid,uuid,timestamptz,timestamptz) to authenticated;

-- Workforce learning is immutable financial/operational evidence. Results are
-- captured only when the service is locked, its close is locked and manager-
-- approved labour evidence exists. Comparable services use the same venue,
-- weekday and a bounded planned-revenue band; insufficient evidence is explicit.
create table public.workforce_learning_results(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  service_operation_id uuid not null,
  service_date date not null,
  current_labour_result_id uuid not null,
  comparable_service_ids uuid[] not null default '{}',
  comparison_basis jsonb not null,
  lessons jsonb not null,
  evidence_refs jsonb not null,
  calculation_version text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique(organisation_id,id),
  unique(organisation_id,content_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict
);
create index workforce_learning_service_idx on public.workforce_learning_results(organisation_id,venue_id,service_date desc,created_at desc);
alter table public.workforce_learning_results enable row level security;
create policy workforce_learning_manager_read on public.workforce_learning_results for select
  using(public.has_capability(organisation_id,venue_id,'planning.manage') or public.has_capability(organisation_id,venue_id,'time.approve'));
create trigger workforce_learning_append_only before update or delete on public.workforce_learning_results
  for each row execute function public.prevent_append_only_mutation();
grant select on public.workforce_learning_results to authenticated;
grant all on public.workforce_learning_results to service_role;

create or replace function public.capture_workforce_learning(
  target_organisation_id uuid,target_venue_id uuid,target_trading_date date
) returns public.workforce_learning_results language plpgsql security definer set search_path='' as $$
declare
  op public.service_operations;
  labour public.approved_labour_results;
  close_row public.closing_sessions;
  result public.workforce_learning_results;
  planned_revenue bigint:=0; actual_revenue bigint:=0; actual_basis_points integer:=0;
  comparable_count integer:=0; comparable_basis_points integer:=0; comparable_worked_minutes integer:=0; comparable_actual_revenue bigint:=0;
  comparable_ids uuid[]:='{}'; comparable_evidence jsonb:='[]'::jsonb;
  comparison jsonb; lessons jsonb; evidence jsonb; digest_value text; reconciliation_hash text; inserted boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended('workforce-learning:'||target_organisation_id::text||target_venue_id::text||target_trading_date::text,0));
  select * into op from public.service_operations where organisation_id=target_organisation_id and venue_id=target_venue_id and service_date=target_trading_date and status='locked' order by version desc limit 1;
  select * into labour from public.approved_labour_results where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date order by calculated_at desc,id desc limit 1;
  select * into close_row from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and status='locked' order by version desc limit 1;
  if op.id is null or labour.id is null or close_row.id is null then return result; end if;

  planned_revenue=coalesce((labour.evidence->>'planned_revenue_minor')::bigint,0);
  actual_revenue=coalesce((labour.evidence->>'actual_revenue_minor')::bigint,0);
  actual_basis_points=coalesce((labour.evidence->>'actual_labour_basis_points')::integer,0);

  with prior_services as (
    select distinct on(prior.service_date) prior.*
    from public.service_operations prior
    where prior.organisation_id=target_organisation_id and prior.venue_id=target_venue_id
      and prior.status='locked' and prior.service_date<target_trading_date
      and extract(isodow from prior.service_date)=extract(isodow from target_trading_date)
      and exists(select 1 from public.closing_sessions pc where pc.organisation_id=prior.organisation_id and pc.venue_id=prior.venue_id and pc.trading_date=prior.service_date and pc.status='locked')
    order by prior.service_date,prior.version desc
  ), comparable as (
    select prior.id service_operation_id,prior.service_date,prior_labour.id labour_result_id,prior_labour.content_hash,
      prior_labour.worked_minutes,prior_labour.actual_cost_minor,
      coalesce((prior_labour.evidence->>'planned_revenue_minor')::bigint,0) planned_revenue_minor,
      coalesce((prior_labour.evidence->>'actual_revenue_minor')::bigint,0) actual_revenue_minor,
      coalesce((prior_labour.evidence->>'actual_labour_basis_points')::integer,0) actual_labour_basis_points
    from prior_services prior
    join lateral(
      select al.* from public.approved_labour_results al
      where al.organisation_id=prior.organisation_id and al.venue_id=prior.venue_id and al.trading_date=prior.service_date
      order by al.calculated_at desc,al.id desc limit 1
    ) prior_labour on true
    where planned_revenue=0 or abs(coalesce((prior_labour.evidence->>'planned_revenue_minor')::bigint,0)-planned_revenue)<=greatest(10000::bigint,planned_revenue/4)
    order by prior.service_date desc
    limit 8
  )
  select count(*)::integer,
    coalesce(round(avg(actual_labour_basis_points))::integer,0),
    coalesce(round(avg(worked_minutes))::integer,0),
    coalesce(round(avg(actual_revenue_minor))::bigint,0),
    coalesce(array_agg(service_operation_id order by service_date desc),'{}'::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object('service_operation_id',service_operation_id,'service_date',service_date,'approved_labour_result_id',labour_result_id,'labour_content_hash',content_hash,'planned_revenue_minor',planned_revenue_minor,'actual_revenue_minor',actual_revenue_minor,'worked_minutes',worked_minutes,'actual_cost_minor',actual_cost_minor,'actual_labour_basis_points',actual_labour_basis_points) order by service_date desc),'[]'::jsonb)
  into comparable_count,comparable_basis_points,comparable_worked_minutes,comparable_actual_revenue,comparable_ids,comparable_evidence
  from comparable;

  select rs.result_hash into reconciliation_hash from public.reconciliation_summaries rs
    join public.reconciliation_runs rr on rr.id=rs.reconciliation_id and rr.organisation_id=target_organisation_id
    where rr.venue_id=target_venue_id and rr.trading_date=target_trading_date order by rr.version desc limit 1;

  comparison=jsonb_build_object(
    'method','same_venue_same_weekday_revenue_band_v1',
    'service_operation_id',op.id,
    'service_date',target_trading_date,
    'planned_revenue_minor',planned_revenue,
    'actual_revenue_minor',actual_revenue,
    'actual_labour_basis_points',actual_basis_points,
    'worked_minutes',labour.worked_minutes,
    'comparable_count',comparable_count,
    'comparable_actual_labour_basis_points',comparable_basis_points,
    'comparable_worked_minutes',comparable_worked_minutes,
    'comparable_actual_revenue_minor',comparable_actual_revenue,
    'revenue_band_basis_points',2500
  );

  if comparable_count<2 then
    lessons=jsonb_build_array(jsonb_build_object('code','insufficient_comparables','state','insufficient_evidence','comparable_count',comparable_count,'minimum_required',2));
  else
    lessons=jsonb_build_array(
      jsonb_build_object('code','labour_ratio_vs_comparable','state',case when actual_basis_points>comparable_basis_points+100 then 'above_comparable' when actual_basis_points<comparable_basis_points-100 then 'below_comparable' else 'within_comparable_band' end,'current_basis_points',actual_basis_points,'comparable_basis_points',comparable_basis_points,'delta_basis_points',actual_basis_points-comparable_basis_points),
      jsonb_build_object('code','worked_minutes_vs_comparable','state',case when labour.worked_minutes>comparable_worked_minutes+60 then 'above_comparable' when labour.worked_minutes<comparable_worked_minutes-60 then 'below_comparable' else 'within_comparable_band' end,'current_minutes',labour.worked_minutes,'comparable_minutes',comparable_worked_minutes,'delta_minutes',labour.worked_minutes-comparable_worked_minutes),
      jsonb_build_object('code','revenue_vs_comparable','state',case when actual_revenue>comparable_actual_revenue then 'above_comparable' when actual_revenue<comparable_actual_revenue then 'below_comparable' else 'equal_comparable' end,'current_actual_revenue_minor',actual_revenue,'comparable_actual_revenue_minor',comparable_actual_revenue,'delta_minor',actual_revenue-comparable_actual_revenue)
    );
  end if;

  evidence=jsonb_build_object(
    'approved_labour_result_id',labour.id,
    'approved_labour_content_hash',labour.content_hash,
    'roster_version_id',labour.evidence->>'roster_version_id',
    'roster_content_hash',labour.evidence->>'roster_content_hash',
    'close_id',close_row.id,
    'reconciliation_result_hash',reconciliation_hash,
    'comparables',comparable_evidence
  );
  digest_value=encode(extensions.digest(convert_to(jsonb_build_object('comparison',comparison,'lessons',lessons,'evidence',evidence,'calculation_version','workforce-learning-v1')::text,'UTF8'),'sha256'),'hex');

  insert into public.workforce_learning_results(organisation_id,venue_id,service_operation_id,service_date,current_labour_result_id,comparable_service_ids,comparison_basis,lessons,evidence_refs,calculation_version,content_hash)
  values(target_organisation_id,target_venue_id,op.id,target_trading_date,labour.id,comparable_ids,comparison,lessons,evidence,'workforce-learning-v1',digest_value)
  on conflict(organisation_id,content_hash) do nothing returning * into result;
  inserted=result.id is not null;
  if result.id is null then select * into result from public.workforce_learning_results where organisation_id=target_organisation_id and content_hash=digest_value; end if;
  if inserted then
    perform public.append_operational_event(target_organisation_id,target_venue_id,'workforce_learning_result',result.id,'workforce.learning_captured',jsonb_build_object('content_hash',digest_value,'service_operation_id',op.id,'comparable_count',comparable_count),gen_random_uuid());
  end if;
  return result;
end $$;

create or replace function public.capture_workforce_learning_from_service()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='locked' then
    if tg_op='INSERT' then
      perform public.capture_workforce_learning(new.organisation_id,new.venue_id,new.service_date);
    elsif old.status is distinct from new.status or old.close_id is distinct from new.close_id then
      perform public.capture_workforce_learning(new.organisation_id,new.venue_id,new.service_date);
    end if;
  end if;
  return new;
end $$;
create trigger service_operation_workforce_learning after insert or update of status,close_id on public.service_operations
for each row execute function public.capture_workforce_learning_from_service();

create or replace function public.capture_workforce_learning_from_labour()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.capture_workforce_learning(new.organisation_id,new.venue_id,new.trading_date);
  return new;
end $$;
create trigger approved_labour_workforce_learning after insert on public.approved_labour_results
for each row execute function public.capture_workforce_learning_from_labour();

revoke all on function public.capture_workforce_learning(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.capture_workforce_learning_from_service() from public,anon,authenticated;
revoke all on function public.capture_workforce_learning_from_labour() from public,anon,authenticated;

-- Backfill only already-locked services with the required immutable evidence.
do $$
declare row record;
begin
  for row in
    select distinct on(op.organisation_id,op.venue_id,op.service_date) op.organisation_id,op.venue_id,op.service_date
    from public.service_operations op
    join public.approved_labour_results al on al.organisation_id=op.organisation_id and al.venue_id=op.venue_id and al.trading_date=op.service_date
    join public.closing_sessions c on c.organisation_id=op.organisation_id and c.venue_id=op.venue_id and c.trading_date=op.service_date and c.status='locked'
    where op.status='locked'
    order by op.organisation_id,op.venue_id,op.service_date,op.version desc
  loop
    perform public.capture_workforce_learning(row.organisation_id,row.venue_id,row.service_date);
  end loop;
end $$;

commit;
