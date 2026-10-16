begin;

alter table public.closing_sessions
  add column reconciliation_id uuid,
  add column reconciliation_input_hash text,
  add column reconciliation_result_hash text,
  add column prepared_at timestamptz,
  add constraint closing_sessions_reconciliation_fk foreign key(organisation_id,reconciliation_id) references public.reconciliation_runs(organisation_id,id);

alter table public.closing_lines
  add column idempotency_key text;
create unique index closing_lines_idempotency_unique
  on public.closing_lines(organisation_id,closing_session_id,idempotency_key)
  where idempotency_key is not null;

create or replace function public.create_close_draft(
  target_organisation_id uuid,target_venue_id uuid,target_trading_date date
) returns public.closing_sessions
language plpgsql security definer set search_path=public as $$
declare result public.closing_sessions; next_version integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'close.create') then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.venues where organisation_id=target_organisation_id and id=target_venue_id) then raise exception 'venue_scope_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||target_venue_id::text||':'||target_trading_date::text||':close-draft',0));
  select * into result from public.closing_sessions
    where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date
      and status in ('draft','reopened')
    order by version desc limit 1;
  if found then return result; end if;
  if exists(select 1 from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date) then
    raise exception 'close_already_finalized';
  end if;
  select coalesce(max(version),0)+1 into next_version from public.closing_sessions
    where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date;
  insert into public.closing_sessions(organisation_id,venue_id,trading_date,status,version,created_by)
  values(target_organisation_id,target_venue_id,target_trading_date,'draft',next_version,auth.uid())
  returning * into result;
  return result;
end $$;

create or replace function public.add_close_line(
  target_organisation_id uuid,target_close_id uuid,target_line_type text,
  target_expected_minor bigint,target_actual_minor bigint,target_metadata jsonb,target_idempotency_key text
) returns public.closing_lines
language plpgsql security definer set search_path=public as $$
declare target_close public.closing_sessions; result public.closing_lines;
begin
  if length(trim(coalesce(target_idempotency_key,'')))<8 then raise exception 'idempotency_key_required'; end if;
  if target_line_type not in ('pos_sales','pos_tender','terminal','cash','online_tickets','booking_deposit','house_account','refund','complimentary','tips','payout','safe_drop','opening_float','manual_correction') then
    raise exception 'invalid_line_type';
  end if;
  select * into target_close from public.closing_sessions
    where organisation_id=target_organisation_id and id=target_close_id for update;
  if not found then raise exception 'close_not_found'; end if;
  if target_close.status not in ('draft','reopened') then raise exception 'close_is_immutable'; end if;
  if not public.has_capability(target_organisation_id,target_close.venue_id,'close.create') then raise exception 'forbidden'; end if;
  select * into result from public.closing_lines
    where organisation_id=target_organisation_id and closing_session_id=target_close_id
      and idempotency_key=target_idempotency_key;
  if found then return result; end if;
  insert into public.closing_lines(
    organisation_id,closing_session_id,line_type,expected_minor,actual_minor,metadata,idempotency_key
  ) values (
    target_organisation_id,target_close_id,target_line_type,target_expected_minor,target_actual_minor,
    coalesce(target_metadata,'{}'::jsonb),target_idempotency_key
  ) returning * into result;
  return result;
end $$;

create or replace function public.prepare_reconciliation_close(
  target_organisation_id uuid,target_venue_id uuid,target_trading_date date,target_reconciliation_id uuid
) returns public.closing_sessions
language plpgsql security definer set search_path=public as $$
declare run public.reconciliation_runs; summary public.reconciliation_summaries; result public.closing_sessions; next_version integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'close.create') then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||target_venue_id::text||':'||target_trading_date::text||':close',0));
  select * into run from public.reconciliation_runs where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and id=target_reconciliation_id for update;
  if not found or run.status not in ('calculated','approved') or run.stale_at is not null then raise exception 'reconciliation_not_current'; end if;
  if exists(select 1 from public.reconciliation_readiness_checks where organisation_id=target_organisation_id and reconciliation_id=run.id and classification='blocking') then raise exception 'blocking_readiness_checks'; end if;
  if exists(select 1 from public.reconciliation_exceptions where organisation_id=target_organisation_id and reconciliation_id=run.id and severity in ('material','critical') and status not in ('resolved','dismissed')) then raise exception 'material_exceptions_unresolved'; end if;
  select * into summary from public.reconciliation_summaries where organisation_id=target_organisation_id and reconciliation_id=run.id;
  if not found then raise exception 'reconciliation_summary_missing'; end if;
  select * into result from public.closing_sessions where organisation_id=target_organisation_id and reconciliation_id=run.id and status in ('draft','reopened') order by version desc limit 1;
  if found then return result; end if;
  select * into result from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and status in ('draft','reopened') order by version desc limit 1 for update;
  if found then
    if exists(
      select 1 from public.closing_lines
      where organisation_id=target_organisation_id
        and closing_session_id=result.id
        and metadata->>'prepared_by'='reconciliation'
        and coalesce(metadata->>'preparation_status','active')='active'
    ) then
      raise exception 'existing_reconciliation_preparation_requires_explicit_repair';
    end if;
    update public.closing_sessions set reconciliation_id=run.id,reconciliation_input_hash=run.input_hash,reconciliation_result_hash=summary.result_hash,prepared_at=now()
      where id=result.id returning * into result;
  else
    select coalesce(max(version),0)+1 into next_version from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date;
    insert into public.closing_sessions(organisation_id,venue_id,trading_date,status,version,created_by,reconciliation_id,reconciliation_input_hash,reconciliation_result_hash,prepared_at)
    values(target_organisation_id,target_venue_id,target_trading_date,'draft',next_version,auth.uid(),run.id,run.input_hash,summary.result_hash,now()) returning * into result;
  end if;
  insert into public.closing_lines(organisation_id,closing_session_id,line_type,source_id,expected_minor,actual_minor,metadata)
  values(target_organisation_id,result.id,'pos_sales',run.id,summary.expected_gross_revenue_minor,summary.recorded_gross_revenue_minor,
    jsonb_build_object('prepared_by','reconciliation','reconciliation_id',run.id,'input_hash',run.input_hash,'result_hash',summary.result_hash,
      'beverage_cost_variance_minor',summary.beverage_cost_variance_minor,'margin_impact_minor',summary.margin_impact_minor));
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(target_organisation_id,target_venue_id,'closing_session',result.id,'close.prepared',auth.uid(),jsonb_build_object('reconciliation_id',run.id,'input_hash',run.input_hash,'result_hash',summary.result_hash));
  return result;
end $$;

create or replace function public.repair_reconciliation_close_preparation(
  target_organisation_id uuid,target_close_id uuid,target_reconciliation_id uuid,target_reason text
) returns public.closing_sessions
language plpgsql security definer set search_path=public as $$
declare target_close public.closing_sessions; run public.reconciliation_runs; summary public.reconciliation_summaries;
begin
  if length(trim(coalesce(target_reason,'')))<10 then raise exception 'repair_reason_required'; end if;
  select * into target_close from public.closing_sessions
    where organisation_id=target_organisation_id and id=target_close_id and status in ('draft','reopened')
    for update;
  if not found then raise exception 'editable_close_not_found'; end if;
  if not public.has_capability(target_organisation_id,target_close.venue_id,'close.create') then raise exception 'forbidden'; end if;
  select * into run from public.reconciliation_runs
    where organisation_id=target_organisation_id and venue_id=target_close.venue_id
      and trading_date=target_close.trading_date and id=target_reconciliation_id
      and status in ('calculated','approved') and stale_at is null;
  if not found then raise exception 'reconciliation_not_current'; end if;
  select * into summary from public.reconciliation_summaries
    where organisation_id=target_organisation_id and reconciliation_id=run.id;
  if not found then raise exception 'reconciliation_summary_missing'; end if;

  update public.closing_lines
    set metadata=metadata||jsonb_build_object(
      'preparation_status','superseded',
      'superseded_at',now(),
      'superseded_by',auth.uid(),
      'superseded_reason',target_reason
    )
    where organisation_id=target_organisation_id
      and closing_session_id=target_close.id
      and metadata->>'prepared_by'='reconciliation'
      and coalesce(metadata->>'preparation_status','active')='active';

  update public.closing_sessions
    set reconciliation_id=run.id,reconciliation_input_hash=run.input_hash,
      reconciliation_result_hash=summary.result_hash,prepared_at=now()
    where id=target_close.id returning * into target_close;

  insert into public.closing_lines(organisation_id,closing_session_id,line_type,source_id,expected_minor,actual_minor,metadata)
  values(target_organisation_id,target_close.id,'pos_sales',run.id,summary.expected_gross_revenue_minor,summary.recorded_gross_revenue_minor,
    jsonb_build_object('prepared_by','reconciliation','preparation_status','active','reconciliation_id',run.id,
      'input_hash',run.input_hash,'result_hash',summary.result_hash,'repair_reason',target_reason,
      'beverage_cost_variance_minor',summary.beverage_cost_variance_minor,'margin_impact_minor',summary.margin_impact_minor));

  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(target_organisation_id,target_close.venue_id,'closing_session',target_close.id,'close.preparation_repaired',auth.uid(),
    jsonb_build_object('reconciliation_id',run.id,'reason',target_reason));
  return target_close;
end $$;

create or replace function public.transition_close(
  target_close_id uuid,target_status public.close_status,reason text default null
) returns public.closing_sessions
language plpgsql security definer set search_path=public as $$
declare current_close public.closing_sessions; successor_close public.closing_sessions; run public.reconciliation_runs; summary public.reconciliation_summaries;
  expected_sum bigint; actual_sum bigint; snapshot_data jsonb;
begin
  select * into current_close from public.closing_sessions where id=target_close_id for update;
  if not found then raise exception 'close_not_found'; end if;
  if not public.has_capability(current_close.organisation_id,current_close.venue_id,
    case when target_status in ('approved','locked') then 'close.approve' when target_status='reopened' then 'close.reopen' else 'close.submit' end) then raise exception 'forbidden'; end if;
  if target_status not in ('submitted','approved','locked','reopened') then raise exception 'invalid_target_status'; end if;
  if target_status='submitted' and current_close.status not in ('draft','reopened') then raise exception 'invalid_transition'; end if;
  if target_status='approved' and current_close.status<>'submitted' then raise exception 'invalid_transition'; end if;
  if target_status='locked' and current_close.status<>'approved' then raise exception 'invalid_transition'; end if;
  if target_status='reopened' and current_close.status not in ('approved','locked') then raise exception 'invalid_transition'; end if;
  if target_status='reopened' and length(trim(coalesce(reason,'')))<10 then raise exception 'reopen_reason_required'; end if;
  if target_status in ('submitted','approved','locked') then
    if current_close.reconciliation_id is null then raise exception 'reconciliation_required'; end if;
    select * into run from public.reconciliation_runs where organisation_id=current_close.organisation_id and id=current_close.reconciliation_id for update;
    select * into summary from public.reconciliation_summaries where organisation_id=current_close.organisation_id and reconciliation_id=current_close.reconciliation_id;
    if run.status not in ('calculated','approved') or run.stale_at is not null or run.input_hash<>current_close.reconciliation_input_hash or summary.result_hash<>current_close.reconciliation_result_hash then raise exception 'stale_reconciliation'; end if;
    if exists(select 1 from public.reconciliation_readiness_checks where organisation_id=current_close.organisation_id and reconciliation_id=run.id and classification='blocking') then raise exception 'blocking_readiness_checks'; end if;
    if exists(select 1 from public.reconciliation_exceptions where organisation_id=current_close.organisation_id and reconciliation_id=run.id and severity in ('material','critical') and status not in ('resolved','dismissed')) then raise exception 'material_exceptions_unresolved'; end if;
  end if;
  select coalesce(sum(expected_minor),0),coalesce(sum(actual_minor),0) into expected_sum,actual_sum
    from public.closing_lines
    where organisation_id=current_close.organisation_id
      and closing_session_id=target_close_id
      and coalesce(metadata->>'preparation_status','active')<>'superseded';
  if target_status='reopened' then
    insert into public.closing_sessions(organisation_id,venue_id,trading_date,event_id,status,version,created_by,reopened_reason)
    values(current_close.organisation_id,current_close.venue_id,current_close.trading_date,current_close.event_id,'reopened',current_close.version+1,auth.uid(),reason)
    returning * into successor_close;
    insert into public.closing_lines(organisation_id,closing_session_id,line_type,source_id,expected_minor,actual_minor,quantity,metadata)
    select organisation_id,successor_close.id,line_type,source_id,expected_minor,actual_minor,quantity,metadata||jsonb_build_object('copied_from_close_id',current_close.id)
      from public.closing_lines where organisation_id=current_close.organisation_id and closing_session_id=current_close.id;
    insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
    values(current_close.organisation_id,current_close.venue_id,'closing_session',successor_close.id,'close.reopened',auth.uid(),jsonb_build_object('previous_close_id',current_close.id,'reason',reason));
    return successor_close;
  end if;
  update public.closing_sessions set status=target_status,expected_total_minor=expected_sum,accounted_total_minor=actual_sum,
    submitted_by=case when target_status='submitted' then auth.uid() else submitted_by end,submitted_at=case when target_status='submitted' then now() else submitted_at end,
    approved_by=case when target_status='approved' then auth.uid() else approved_by end,approved_at=case when target_status='approved' then now() else approved_at end,
    locked_at=case when target_status='locked' then now() else locked_at end where id=target_close_id returning * into current_close;
  if target_status='approved' then
    snapshot_data=jsonb_build_object('schema_version','2','closing_session',to_jsonb(current_close),
      'lines',coalesce((select jsonb_agg(to_jsonb(line) order by line.created_at,line.id) from public.closing_lines line where line.organisation_id=current_close.organisation_id and line.closing_session_id=current_close.id),'[]'::jsonb),
      'reconciliation_run',to_jsonb(run),'reconciliation_summary',to_jsonb(summary),
      'product_results',coalesce((select jsonb_agg(to_jsonb(r) order by r.location_id,r.product_id) from public.reconciliation_product_results r where r.organisation_id=current_close.organisation_id and r.reconciliation_id=run.id),'[]'::jsonb),
      'readiness_checks',coalesce((select jsonb_agg(to_jsonb(c) order by c.classification,c.issue_code,c.id) from public.reconciliation_readiness_checks c where c.organisation_id=current_close.organisation_id and c.reconciliation_id=run.id),'[]'::jsonb),
      'exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.financial_impact_minor desc nulls last,e.id) from public.reconciliation_exceptions e where e.organisation_id=current_close.organisation_id and e.reconciliation_id=run.id),'[]'::jsonb),
      'exception_decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.reconciliation_exception_decisions d join public.reconciliation_exceptions e on e.organisation_id=d.organisation_id and e.id=d.exception_id where d.organisation_id=current_close.organisation_id and e.reconciliation_id=run.id),'[]'::jsonb));
    insert into public.close_snapshots(organisation_id,closing_session_id,snapshot,content_hash,created_by)
    values(current_close.organisation_id,current_close.id,snapshot_data,encode(extensions.digest(convert_to(snapshot_data::text,'UTF8'),'sha256'),'hex'),auth.uid())
    on conflict(closing_session_id) do nothing;
    update public.reconciliation_runs set status='approved',approved_close_id=current_close.id where id=run.id;
  end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(current_close.organisation_id,current_close.venue_id,'closing_session',current_close.id,'close.'||target_status::text,auth.uid(),jsonb_build_object('reconciliation_id',current_close.reconciliation_id,'version',current_close.version));
  return current_close;
end $$;

revoke all privileges on public.closing_sessions,public.closing_lines from anon,authenticated;
grant select on public.closing_sessions,public.closing_lines to authenticated;
revoke all on function public.create_close_draft(uuid,uuid,date) from public;
revoke all on function public.add_close_line(uuid,uuid,text,bigint,bigint,jsonb,text) from public;
revoke all on function public.prepare_reconciliation_close(uuid,uuid,date,uuid) from public;
revoke all on function public.repair_reconciliation_close_preparation(uuid,uuid,uuid,text) from public;
revoke all on function public.transition_close(uuid,public.close_status,text) from public;
grant execute on function public.create_close_draft(uuid,uuid,date) to authenticated;
grant execute on function public.add_close_line(uuid,uuid,text,bigint,bigint,jsonb,text) to authenticated;
grant execute on function public.prepare_reconciliation_close(uuid,uuid,date,uuid) to authenticated;
grant execute on function public.repair_reconciliation_close_preparation(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.transition_close(uuid,public.close_status,text) to authenticated;

commit;
