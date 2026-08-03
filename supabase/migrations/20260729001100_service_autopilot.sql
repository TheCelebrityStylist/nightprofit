begin;

create table public.service_operations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  service_date date not null,
  service_start timestamptz not null,
  service_end timestamptz not null,
  version integer not null check(version>0),
  stage text not null check(stage in ('prepare','open','run','close','learn')),
  status text not null check(status in ('draft','ready_for_review','approved','live','closing','locked','stale','superseded')),
  forecast_id uuid references public.demand_forecasts(id) on delete restrict,
  roster_version_id uuid references public.roster_versions(id) on delete restrict,
  purchase_plan_id uuid,
  reconciliation_id uuid references public.reconciliation_runs(id) on delete restrict,
  close_id uuid references public.closing_sessions(id) on delete restrict,
  demand_snapshot jsonb not null default '{}',
  staffing_snapshot jsonb not null default '{}',
  consumption_snapshot jsonb not null default '{}',
  inventory_snapshot jsonb not null default '{}',
  purchasing_snapshot jsonb not null default '{}',
  live_snapshot jsonb not null default '{}',
  outcome_snapshot jsonb not null default '{}',
  readiness_checks jsonb not null default '[]',
  missing_evidence text[] not null default '{}',
  stale_reasons text[] not null default '{}',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  locked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,id),
  unique(organisation_id,venue_id,service_date,version),
  check(service_end>service_start),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.service_purchase_plans (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  service_operation_id uuid not null,
  version integer not null check(version>0),
  status text not null check(status in ('draft','ready_for_review','approved','ordered','received','superseded')),
  lines jsonb not null default '[]',
  expected_cost_minor bigint not null default 0 check(expected_cost_minor>=0),
  evidence_refs jsonb not null default '[]',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,id),
  unique(service_operation_id,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict
);
alter table public.service_operations add constraint service_operations_purchase_plan_fk
  foreign key(organisation_id,purchase_plan_id) references public.service_purchase_plans(organisation_id,id) deferrable initially deferred;

create table public.service_operation_decisions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, service_operation_id uuid not null, decision_type text not null,
  decision text not null check(decision in ('approved','rejected','accepted','dismissed')),
  reason text not null check(length(trim(reason))>=5), evidence_refs jsonb not null default '[]',
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(organisation_id,id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict
);

alter table public.operating_actions
  add column service_operation_id uuid,
  add column action_key text,
  add column why_it_matters text,
  add column recommended_response text,
  add column required_capability text not null default 'actions.manage',
  add column evidence_completeness_basis_points integer not null default 0 check(evidence_completeness_basis_points between 0 and 10000),
  add column effort_points integer not null default 3 check(effort_points between 1 and 5),
  add column rank_score bigint not null default 0,
  add column measured_outcome_minor bigint,
  add constraint operating_actions_service_operation_fk foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict,
  add constraint operating_actions_action_key_unique unique(organisation_id,action_key);

create index service_operations_current_idx on public.service_operations(organisation_id,venue_id,service_date,version desc);
create index service_actions_rank_idx on public.operating_actions(organisation_id,status,rank_score desc,due_at);

alter table public.service_operations enable row level security;
alter table public.service_purchase_plans enable row level security;
alter table public.service_operation_decisions enable row level security;
create policy service_operations_read on public.service_operations for select using(public.has_venue_access(organisation_id,venue_id));
create policy service_operations_manage on public.service_operations for all using(public.has_capability(organisation_id,venue_id,'actions.manage')) with check(public.has_capability(organisation_id,venue_id,'actions.manage'));
create policy service_purchase_plans_read on public.service_purchase_plans for select using(public.has_venue_access(organisation_id,venue_id));
create policy service_purchase_plans_manage on public.service_purchase_plans for all using(public.has_capability(organisation_id,venue_id,'actions.manage')) with check(public.has_capability(organisation_id,venue_id,'actions.manage'));
create policy service_decisions_read on public.service_operation_decisions for select using(public.has_venue_access(organisation_id,venue_id));
create policy service_decisions_insert on public.service_operation_decisions for insert with check(public.has_capability(organisation_id,venue_id,'actions.manage') and actor_id=auth.uid());

create trigger service_operations_touch before update on public.service_operations for each row execute function public.touch_updated_at();
create trigger service_operation_decisions_append_only before update or delete on public.service_operation_decisions for each row execute function public.prevent_append_only_mutation();

create or replace function public.prepare_service_operation(target_organisation_id uuid,target_venue_id uuid,target_service_date date)
returns public.service_operations language plpgsql security definer set search_path='' as $$
declare op public.service_operations; forecast public.demand_forecasts; roster public.roster_versions;
  recon public.reconciliation_runs; close_row public.closing_sessions; guests integer:=0; revenue bigint:=0;
  required integer:=0; shift_count integer:=0; open_shifts integer:=0; labor bigint:=0; opening_counts integer:=0;
  missing text[]:='{}'; checks jsonb:='[]'; next_version integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'actions.manage') then raise exception 'forbidden'; end if;
  select * into forecast from public.demand_forecasts where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_service_date and status in ('draft','approved') order by (status='approved') desc,created_at desc limit 1;
  if forecast.id is not null then select coalesce(sum(expected_guests),0),coalesce(sum(expected_revenue_minor),0),coalesce(max(required_staff),0) into guests,revenue,required from public.demand_forecast_intervals where organisation_id=target_organisation_id and forecast_id=forecast.id;
  else missing:=array_append(missing,'demand_forecast'); checks:=checks||jsonb_build_array(jsonb_build_object('code','demand_missing','state','blocking','path','/app/planning')); end if;
  select * into roster from public.roster_versions where organisation_id=target_organisation_id and venue_id=target_venue_id and window_start::date<=target_service_date and window_end::date>=target_service_date order by version desc limit 1;
  select count(*),count(*) filter(where staff_id is null),coalesce(sum((hourly_cost_minor*greatest(0,(extract(epoch from (ends_at-starts_at))/60)::integer-break_minutes)+30)/60),0)
    into shift_count,open_shifts,labor from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at::date=target_service_date and status not in ('cancelled','rejected');
  if shift_count=0 then missing:=array_append(missing,'roster'); checks:=checks||jsonb_build_array(jsonb_build_object('code','roster_missing','state','blocking','path','/app/planning')); end if;
  if open_shifts>0 then checks:=checks||jsonb_build_array(jsonb_build_object('code','coverage_gap','state','warning','count',open_shifts,'path','/app/planning')); end if;
  select count(*) into opening_counts from public.stock_counts where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_service_date and count_type='opening' and status='posted';
  if opening_counts=0 then missing:=array_append(missing,'opening_inventory'); checks:=checks||jsonb_build_array(jsonb_build_object('code','opening_count_missing','state','warning','path','/app/inventory')); end if;
  select * into recon from public.reconciliation_runs where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_service_date order by version desc limit 1;
  select * into close_row from public.closing_sessions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_service_date order by version desc limit 1;
  select * into op from public.service_operations where organisation_id=target_organisation_id and venue_id=target_venue_id and service_date=target_service_date and status not in ('locked','superseded') order by version desc limit 1 for update;
  if op.id is null then select coalesce(max(version),0)+1 into next_version from public.service_operations where organisation_id=target_organisation_id and venue_id=target_venue_id and service_date=target_service_date;
    insert into public.service_operations(organisation_id,venue_id,service_date,service_start,service_end,version,stage,status,created_by)
      values(target_organisation_id,target_venue_id,target_service_date,target_service_date::timestamptz,target_service_date::timestamptz+interval '1 day',next_version,'prepare','draft',auth.uid()) returning * into op;
  end if;
  update public.service_operations set forecast_id=forecast.id,roster_version_id=roster.id,reconciliation_id=recon.id,close_id=close_row.id,
    demand_snapshot=jsonb_build_object('expected_guests',guests,'expected_revenue_minor',revenue,'required_staff_peak',required,'forecast_status',forecast.status),
    staffing_snapshot=jsonb_build_object('shift_count',shift_count,'open_shifts',open_shifts,'planned_labor_minor',labor,'roster_status',roster.status),
    inventory_snapshot=jsonb_build_object('opening_counts_posted',opening_counts),readiness_checks=checks,missing_evidence=missing,stale_reasons='{}',
    status=case when cardinality(missing)=0 and open_shifts=0 then 'ready_for_review' else 'draft' end,updated_at=now() where id=op.id returning * into op;
  if open_shifts>0 then insert into public.operating_actions(organisation_id,venue_id,service_operation_id,action_key,action_type,title,rationale,why_it_matters,recommended_response,severity,status,due_at,expected_impact_minor,evidence_refs,evidence_completeness_basis_points,effort_points,rank_score)
    values(target_organisation_id,target_venue_id,op.id,'coverage:'||op.id,'coverage_gap','Close roster coverage gaps',open_shifts||' service shift(s) remain unassigned.','Unfilled positions put service quality and forecast revenue at risk.','Assign qualified available employees or approve an open-shift offer.','high','open',op.service_start-interval '12 hours',null,jsonb_build_array(jsonb_build_object('service_operation_id',op.id,'open_shifts',open_shifts)),7000,2,700000)
    on conflict(organisation_id,action_key) do update set rationale=excluded.rationale,evidence_refs=excluded.evidence_refs,rank_score=excluded.rank_score,updated_at=now(); end if;
  if opening_counts=0 then insert into public.operating_actions(organisation_id,venue_id,service_operation_id,action_key,action_type,title,rationale,why_it_matters,recommended_response,severity,status,due_at,evidence_refs,evidence_completeness_basis_points,effort_points,rank_score)
    values(target_organisation_id,target_venue_id,op.id,'opening-count:'||op.id,'inventory_readiness','Confirm opening inventory','No posted opening count is linked to this service.','Without an opening fact, depletion and unexplained consumption cannot be evidenced.','Complete and post an opening stock count before service.','high','open',op.service_start,jsonb_build_array(jsonb_build_object('service_operation_id',op.id)),9000,2,650000)
    on conflict(organisation_id,action_key) do update set rationale=excluded.rationale,evidence_refs=excluded.evidence_refs,rank_score=excluded.rank_score,updated_at=now(); end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,target_venue_id,'service_operation',op.id,'service_operation.prepared',auth.uid(),jsonb_build_object('service_date',target_service_date,'missing_evidence',missing,'readiness_checks',checks));
  return op;
end $$;

create or replace function public.decide_service_operation(target_organisation_id uuid,target_service_operation_id uuid,target_decision text,target_reason text)
returns public.service_operations language plpgsql security definer set search_path='' as $$
declare op public.service_operations;
begin
  select * into op from public.service_operations where organisation_id=target_organisation_id and id=target_service_operation_id for update;
  if op.id is null or not public.has_capability(target_organisation_id,op.venue_id,'actions.manage') then raise exception 'forbidden'; end if;
  if op.status='locked' then raise exception 'locked_service'; end if;
  if target_decision not in ('approved','rejected') or length(trim(target_reason))<5 then raise exception 'invalid_decision'; end if;
  insert into public.service_operation_decisions(organisation_id,venue_id,service_operation_id,decision_type,decision,reason,actor_id) values(target_organisation_id,op.venue_id,op.id,'operational_plan',target_decision,target_reason,auth.uid());
  update public.service_operations set status=case when target_decision='approved' then 'approved' else 'draft' end,approved_by=case when target_decision='approved' then auth.uid() else null end,approved_at=case when target_decision='approved' then now() else null end where id=op.id returning * into op;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,op.venue_id,'service_operation',op.id,'service_operation.'||target_decision,auth.uid(),jsonb_build_object('reason',target_reason));
  return op;
end $$;

create or replace function public.invalidate_service_operation()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_row record; affected public.service_operations; affected_date date; reason text;
begin
  if tg_op='DELETE' then source_row:=old; else source_row:=new; end if;
  reason:=case tg_table_name
    when 'demand_forecasts' then 'demand_changed' when 'shifts' then 'roster_changed'
    when 'stock_counts' then 'inventory_changed' when 'normalized_sales' then 'pos_sales_changed'
    when 'time_records' then 'worked_hours_changed' when 'reconciliation_runs' then 'reconciliation_changed'
    when 'closing_sessions' then 'close_changed' else 'authoritative_input_changed' end;
  affected_date:=case tg_table_name
    when 'demand_forecasts' then source_row.trading_date when 'shifts' then source_row.starts_at::date
    when 'stock_counts' then source_row.trading_date when 'normalized_sales' then source_row.trading_date
    when 'time_records' then source_row.clocked_in_at::date when 'reconciliation_runs' then source_row.trading_date
    when 'closing_sessions' then source_row.trading_date else null end;
  for affected in select * from public.service_operations where organisation_id=source_row.organisation_id and venue_id=source_row.venue_id and service_date=affected_date and status not in ('locked','superseded')
  loop
    update public.service_operations set status='stale',stale_reasons=array(select distinct unnest(stale_reasons||array[reason])),updated_at=now() where id=affected.id;
    insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,payload)
      values(affected.organisation_id,affected.venue_id,'service_operation',affected.id,'service_operation.invalidated',jsonb_build_object('reason',reason,'source_table',tg_table_name,'source_id',source_row.id));
  end loop;
  return source_row;
end $$;

create trigger demand_invalidates_service after insert or update on public.demand_forecasts for each row execute function public.invalidate_service_operation();
create trigger shifts_invalidate_service after insert or update on public.shifts for each row execute function public.invalidate_service_operation();
create trigger counts_invalidate_service after insert or update on public.stock_counts for each row execute function public.invalidate_service_operation();
create trigger sales_invalidate_service after insert or update on public.normalized_sales for each row execute function public.invalidate_service_operation();
create trigger hours_invalidate_service after insert or update on public.time_records for each row execute function public.invalidate_service_operation();
create trigger reconciliation_invalidates_service after insert or update on public.reconciliation_runs for each row execute function public.invalidate_service_operation();
create trigger close_invalidates_service after insert or update on public.closing_sessions for each row execute function public.invalidate_service_operation();

grant select,insert,update on public.service_operations,public.service_purchase_plans to authenticated;
grant select,insert on public.service_operation_decisions to authenticated;
grant execute on function public.prepare_service_operation(uuid,uuid,date) to authenticated;
grant execute on function public.decide_service_operation(uuid,uuid,text,text) to authenticated;

commit;
