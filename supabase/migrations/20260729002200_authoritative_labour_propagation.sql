begin;

-- Template recurrence is an explicit persisted origin used by migration 017.
-- Keep the source vocabulary constrained while admitting that established path.
alter table public.shifts drop constraint if exists shifts_source_check;
alter table public.shifts add constraint shifts_source_check check(source in('manager','template','recurring_template','deterministic_proposal','ai_proposal'));

-- Labour results are financial evidence. They are append-only and are only
-- produced from a published roster plus manager-approved time records.
create or replace function public.prevent_approved_labour_result_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'immutable_approved_labour_result';
end $$;
drop trigger if exists approved_labour_results_immutable on public.approved_labour_results;
create trigger approved_labour_results_immutable before update or delete on public.approved_labour_results
for each row execute function public.prevent_approved_labour_result_mutation();

-- No refresh path may put provisional clock data into an authoritative service
-- result. Once approval evidence exists, it is the only labour source accepted.
create or replace function public.enforce_authoritative_service_labour()
returns trigger language plpgsql security definer set search_path='' as $$
declare labour public.approved_labour_results;
begin
  select * into labour from public.approved_labour_results where organisation_id=new.organisation_id and venue_id=new.venue_id and trading_date=new.service_date order by calculated_at desc,id desc limit 1;
  if labour.id is null then
    new.live_snapshot=(new.live_snapshot-'worked_minutes'-'actual_labor_minor'-'actual_labor_basis_points')||jsonb_build_object('labour_evidence_state','awaiting_manager_approval');
    if new.outcome_snapshot ? 'actual_labor_minor' then new.outcome_snapshot=new.outcome_snapshot-'actual_labor_minor'||jsonb_build_object('labour_evidence_state','awaiting_manager_approval'); end if;
  else
    new.staffing_snapshot=new.staffing_snapshot||jsonb_build_object('planned_minutes',labour.planned_minutes,'planned_labor_minor',labour.planned_cost_minor,'planned_labor_basis_points',coalesce((labour.evidence->>'planned_labour_basis_points')::integer,0),'approved_labour_result_id',labour.id);
    new.live_snapshot=new.live_snapshot||jsonb_build_object('worked_minutes',labour.worked_minutes,'actual_labor_minor',labour.actual_cost_minor,'actual_labor_basis_points',coalesce((labour.evidence->>'actual_labour_basis_points')::integer,0),'approved_labour_result_id',labour.id,'labour_evidence_state','approved');
    if new.outcome_snapshot ? 'actual_labor_minor' then new.outcome_snapshot=new.outcome_snapshot||jsonb_build_object('actual_labor_minor',labour.actual_cost_minor,'worked_minutes',labour.worked_minutes,'approved_labour_result_id',labour.id,'labour_evidence_state','approved'); end if;
  end if;
  return new;
end $$;
drop trigger if exists authoritative_service_labour on public.service_operations;
create trigger authoritative_service_labour before insert or update of staffing_snapshot,live_snapshot,outcome_snapshot on public.service_operations
for each row execute function public.enforce_authoritative_service_labour();

create or replace function public.calculate_approved_labour_result(
  target_organisation_id uuid,target_venue_id uuid,target_trading_date date
) returns public.approved_labour_results language plpgsql security definer set search_path='' as $$
declare
  venue_row public.venues;
  published_roster public.roster_versions;
  close_row public.closing_sessions;
  op public.service_operations;
  planned_minutes integer:=0; worked_minutes integer:=0;
  planned_cost bigint:=0; actual_cost bigint:=0;
  forecast_revenue bigint:=0; actual_revenue bigint:=0;
  planned_basis_points integer:=0; actual_basis_points integer:=0;
  evidence jsonb; digest_value text; result public.approved_labour_results;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'time.approve') then raise exception 'forbidden'; end if;
  select * into venue_row from public.venues where organisation_id=target_organisation_id and id=target_venue_id;
  if venue_row.id is null then raise exception 'venue_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text||target_trading_date::text,0));

  select * into published_roster from public.roster_versions
    where organisation_id=target_organisation_id and venue_id=target_venue_id and status='published'
      and window_start::date<=target_trading_date and window_end::date>=target_trading_date
    order by version desc limit 1;
  if published_roster.id is null then raise exception 'published_roster_required'; end if;
  if exists(select 1 from public.time_records where organisation_id=target_organisation_id and venue_id=target_venue_id
      and (clocked_in_at at time zone venue_row.timezone)::date=target_trading_date and status in('submitted','corrected','open'))
  then raise exception 'unapproved_time_records'; end if;

  -- Expand to paid minutes so supplement windows, weekdays and recorded breaks
  -- are applied deterministically in the venue timezone. Money is rounded once.
  with paid as (
    select s.id,s.staff_id,s.hourly_cost_minor,m.minute_at,
      coalesce((select sum(sc.basis_points) from public.staff_cost_supplements sc
        where sc.organisation_id=s.organisation_id and sc.staff_id=s.staff_id
          and sc.effective_from<=target_trading_date and (sc.effective_until is null or sc.effective_until>=target_trading_date)
          and (cardinality(sc.weekday_numbers)=0 or extract(isodow from m.minute_at at time zone venue_row.timezone)::integer=any(sc.weekday_numbers))
          and (sc.applies_from is null or sc.applies_until is null or
            case when sc.applies_until>sc.applies_from then (m.minute_at at time zone venue_row.timezone)::time>=sc.applies_from and (m.minute_at at time zone venue_row.timezone)::time<sc.applies_until
            else (m.minute_at at time zone venue_row.timezone)::time>=sc.applies_from or (m.minute_at at time zone venue_row.timezone)::time<sc.applies_until end)),0) supplement_bps
    from public.shifts s
    cross join lateral generate_series(date_trunc('minute',s.starts_at),date_trunc('minute',s.ends_at)-interval '1 minute',interval '1 minute') m(minute_at)
    where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.status='published'
      and (s.starts_at at time zone venue_row.timezone)::date=target_trading_date
      and not exists(select 1 from public.shift_break_plans b where b.organisation_id=s.organisation_id and b.shift_id=s.id
        and b.status not in('cancelled','missed') and m.minute_at>=b.starts_at and m.minute_at<b.ends_at)
      and (exists(select 1 from public.shift_break_plans b where b.organisation_id=s.organisation_id and b.shift_id=s.id and b.status not in('cancelled','missed'))
        or m.minute_at<date_trunc('minute',s.ends_at)-make_interval(mins=>s.break_minutes))
  ), totals as (
    select count(*)::integer minutes,coalesce((sum(hourly_cost_minor::numeric*(10000+supplement_bps))/600000)::numeric(30,0),0)::bigint cost from paid
  ) select minutes,cost into planned_minutes,planned_cost from totals;

  with paid as (
    select t.id,t.staff_id,coalesce(s.effective_hourly_cost_minor,sh.hourly_cost_minor,0) hourly_cost_minor,m.minute_at,
      coalesce((select sum(sc.basis_points) from public.staff_cost_supplements sc
        where sc.organisation_id=t.organisation_id and sc.staff_id=t.staff_id
          and sc.effective_from<=target_trading_date and (sc.effective_until is null or sc.effective_until>=target_trading_date)
          and (cardinality(sc.weekday_numbers)=0 or extract(isodow from m.minute_at at time zone venue_row.timezone)::integer=any(sc.weekday_numbers))
          and (sc.applies_from is null or sc.applies_until is null or
            case when sc.applies_until>sc.applies_from then (m.minute_at at time zone venue_row.timezone)::time>=sc.applies_from and (m.minute_at at time zone venue_row.timezone)::time<sc.applies_until
            else (m.minute_at at time zone venue_row.timezone)::time>=sc.applies_from or (m.minute_at at time zone venue_row.timezone)::time<sc.applies_until end)),0) supplement_bps
    from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id
    left join public.shifts sh on sh.organisation_id=t.organisation_id and sh.id=t.shift_id
    cross join lateral generate_series(date_trunc('minute',t.clocked_in_at),date_trunc('minute',t.clocked_out_at)-interval '1 minute',interval '1 minute') m(minute_at)
    where t.organisation_id=target_organisation_id and t.venue_id=target_venue_id and t.status='approved'
      and (t.clocked_in_at at time zone venue_row.timezone)::date=target_trading_date
      and not exists(select 1 from public.time_breaks b where b.organisation_id=t.organisation_id and b.time_record_id=t.id
        and b.ended_at is not null and m.minute_at>=date_trunc('minute',b.started_at) and m.minute_at<date_trunc('minute',b.ended_at))
      and (exists(select 1 from public.time_breaks b where b.organisation_id=t.organisation_id and b.time_record_id=t.id and b.ended_at is not null)
        or m.minute_at<date_trunc('minute',t.clocked_out_at)-make_interval(mins=>t.break_minutes))
  ), totals as (
    select count(*)::integer minutes,coalesce((sum(hourly_cost_minor::numeric*(10000+supplement_bps))/600000)::numeric(30,0),0)::bigint cost from paid
  ) select minutes,cost into worked_minutes,actual_cost from totals;

  select coalesce(sum(expected_revenue_minor),0) into forecast_revenue from public.demand_forecast_intervals i
    where i.organisation_id=target_organisation_id and i.forecast_id=(select f.id from public.demand_forecasts f where f.organisation_id=target_organisation_id and f.venue_id=target_venue_id and f.trading_date=target_trading_date and f.status='approved' order by f.created_at desc limit 1);
  select coalesce(sum(gross_minor),0) into actual_revenue from public.normalized_sales where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date;
  planned_basis_points=case when forecast_revenue>0 then ((planned_cost*10000+forecast_revenue/2)/forecast_revenue)::integer else 0 end;
  actual_basis_points=case when actual_revenue>0 then ((actual_cost*10000+actual_revenue/2)/actual_revenue)::integer else 0 end;

  evidence=jsonb_build_object('schema_version','nightprofit-labour-v2','roster_version_id',published_roster.id,'roster_content_hash',published_roster.content_hash,
    'planned_revenue_minor',forecast_revenue,'actual_revenue_minor',actual_revenue,'planned_labour_basis_points',planned_basis_points,'actual_labour_basis_points',actual_basis_points,
    'approved_time_records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'shift_id',shift_id,'clocked_in_at',clocked_in_at,'clocked_out_at',clocked_out_at,'approved_at',approved_at) order by id)
      from public.time_records where organisation_id=target_organisation_id and venue_id=target_venue_id and status='approved' and (clocked_in_at at time zone venue_row.timezone)::date=target_trading_date),'[]'::jsonb));
  digest_value=encode(digest(convert_to(jsonb_build_object('planned_minutes',planned_minutes,'worked_minutes',worked_minutes,'planned_cost_minor',planned_cost,'actual_cost_minor',actual_cost,'evidence',evidence)::text,'UTF8'),'sha256'),'hex');
  insert into public.approved_labour_results(organisation_id,venue_id,trading_date,planned_minutes,worked_minutes,planned_cost_minor,actual_cost_minor,calculation_version,evidence,content_hash)
    values(target_organisation_id,target_venue_id,target_trading_date,planned_minutes,worked_minutes,planned_cost,actual_cost,'nightprofit-labour-v2',evidence,digest_value)
    on conflict(organisation_id,venue_id,trading_date,content_hash) do nothing returning * into result;
  if result.id is null then select * into result from public.approved_labour_results where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and content_hash=digest_value; end if;

  select * into op from public.service_operations where organisation_id=target_organisation_id and venue_id=target_venue_id and service_date=target_trading_date and status not in('locked','superseded') order by version desc limit 1 for update;
  if op.id is not null then update public.service_operations set
    staffing_snapshot=staffing_snapshot||jsonb_build_object('planned_minutes',planned_minutes,'planned_labor_minor',planned_cost,'planned_labor_basis_points',planned_basis_points,'approved_labour_result_id',result.id),
    live_snapshot=live_snapshot||jsonb_build_object('worked_minutes',worked_minutes,'actual_labor_minor',actual_cost,'actual_labor_basis_points',actual_basis_points,'approved_labour_result_id',result.id,'source_updated_at',now()),updated_at=now() where id=op.id; end if;
  select * into close_row from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and status in('draft','reopened') order by version desc limit 1 for update;
  if close_row.id is not null then insert into public.closing_lines(organisation_id,closing_session_id,line_type,source_id,expected_minor,actual_minor,metadata,idempotency_key)
    values(target_organisation_id,close_row.id,'labour',result.id,planned_cost,actual_cost,jsonb_build_object('approved_labour_result_id',result.id,'content_hash',digest_value,'planned_minutes',planned_minutes,'worked_minutes',worked_minutes,'planned_basis_points',planned_basis_points,'actual_basis_points',actual_basis_points),'authoritative-labour')
    on conflict(organisation_id,closing_session_id,idempotency_key) where idempotency_key is not null do update set source_id=excluded.source_id,expected_minor=excluded.expected_minor,actual_minor=excluded.actual_minor,metadata=excluded.metadata,updated_at=now(); end if;
  perform public.append_operational_event(target_organisation_id,target_venue_id,'approved_labour_result',result.id,'labour.approved_and_propagated',jsonb_build_object('content_hash',digest_value,'planned_cost_minor',planned_cost,'actual_cost_minor',actual_cost),gen_random_uuid());
  return result;
end $$;

-- Approval is the single boundary that derives and propagates authoritative labour.
create or replace function public.approve_time_record(target_organisation_id uuid,target_time_record_id uuid,target_correction_reason text default null)
returns public.time_records language plpgsql security definer set search_path='' as $$
declare record public.time_records; venue_timezone text;
begin
  select * into record from public.time_records where organisation_id=target_organisation_id and id=target_time_record_id for update;
  if record.id is null or not public.has_capability(target_organisation_id,record.venue_id,'time.approve') then raise exception 'forbidden'; end if;
  if record.status not in('submitted','corrected') or record.clocked_out_at is null then raise exception 'invalid_time_record_state'; end if;
  update public.time_records set status='approved',approved_by=auth.uid(),approved_at=now(),correction_reason=coalesce(target_correction_reason,correction_reason),updated_at=now() where id=record.id returning * into record;
  select timezone into venue_timezone from public.venues where organisation_id=record.organisation_id and id=record.venue_id;
  perform public.append_operational_event(record.organisation_id,record.venue_id,'time_record',record.id,'time_approved',jsonb_build_object('had_correction',target_correction_reason is not null),gen_random_uuid());
  perform public.calculate_approved_labour_result(record.organisation_id,record.venue_id,(record.clocked_in_at at time zone venue_timezone)::date);
  return record;
end $$;

revoke all on function public.calculate_approved_labour_result(uuid,uuid,date) from public,anon;
grant execute on function public.calculate_approved_labour_result(uuid,uuid,date) to authenticated;
grant execute on function public.approve_time_record(uuid,uuid,text) to authenticated;

commit;
