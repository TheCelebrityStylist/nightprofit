begin;

create or replace function public.get_workforce_exception_inbox(
  target_organisation_id uuid,target_venue_id uuid,target_reference_at timestamptz default now()
) returns table(action_key text,exception_type text,severity text,rank_score bigint,relevant_at timestamptz,shift_id uuid,staff_id uuid,source_id uuid,evidence jsonb,why_it_matters text,recommended_action text,resolution_condition text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.venues where organisation_id=target_organisation_id and id=target_venue_id) then raise exception 'venue_scope_mismatch'; end if;
  return query
  with current_requirements as (
    select distinct on(v.trading_date) v.id from public.staffing_requirement_versions v where v.organisation_id=target_organisation_id and v.venue_id=target_venue_id and v.status='current' order by v.trading_date,v.version desc
  ), queue as (
    select 'sickness:'||a.id||':'||s.id action_key,'sickness_coverage' exception_type,'critical' severity,
      (400000+greatest(0,100000-least(100000,(extract(epoch from(s.starts_at-target_reference_at))/3600)::bigint*1000)))::bigint rank_score,
      s.starts_at relevant_at,s.id shift_id,a.staff_id,a.id source_id,
      jsonb_build_object('absence_id',a.id,'shift_revision',s.revision,'published',true,'ends_at',s.ends_at) evidence,
      'A recorded sickness affects a published shift.' why_it_matters,'Choose an eligible replacement or create a governed open-shift offer.' recommended_action,
      'The affected published shift is covered by a successor roster or the absence no longer overlaps.' resolution_condition
    from public.staff_absences a join public.shifts s on s.organisation_id=a.organisation_id and s.venue_id=a.venue_id and s.staff_id=a.staff_id and s.status='published' and s.starts_at<a.ends_at and s.ends_at>a.starts_at
    where a.organisation_id=target_organisation_id and a.venue_id=target_venue_id and a.absence_type='sickness' and a.status='recorded' and s.ends_at>target_reference_at
    union all
    select 'leave:'||a.id||':'||s.id,'approved_leave_coverage','high',
      (330000+greatest(0,80000-least(80000,(extract(epoch from(s.starts_at-target_reference_at))/3600)::bigint*800)))::bigint,
      s.starts_at,s.id,a.staff_id,a.id,jsonb_build_object('absence_id',a.id,'shift_revision',s.revision,'shift_status',s.status),
      'Approved leave still overlaps a planned or published shift.','Resolve the affected shift and publish a successor when necessary.','No active shift assigned to this employee overlaps the approved leave.'
    from public.staff_absences a join public.shifts s on s.organisation_id=a.organisation_id and s.venue_id=a.venue_id and s.staff_id=a.staff_id and s.status in('draft','published') and s.starts_at<a.ends_at and s.ends_at>a.starts_at
    where a.organisation_id=target_organisation_id and a.venue_id=target_venue_id and a.absence_type='leave' and a.status='approved' and s.ends_at>target_reference_at
    union all
    select 'coverage:'||i.id,'coverage_gap',case when i.starts_at<=target_reference_at then 'critical' else 'high' end,
      ((case when i.starts_at<=target_reference_at then 400000 else 300000 end)+least(90000,greatest(0,i.required_staff-coalesce(p.planned,0))*15000)+greatest(0,60000-least(60000,(extract(epoch from(i.starts_at-target_reference_at))/3600)::bigint*500)))::bigint,
      i.starts_at,null::uuid,null::uuid,i.id,jsonb_build_object('requirement_interval_id',i.id,'role_id',i.role_id,'required_staff',i.required_staff,'planned_staff',coalesce(p.planned,0),'gap',greatest(0,i.required_staff-coalesce(p.planned,0))),
      'Persisted staffing demand exceeds the assigned roster for this interval.','Open the exact interval and assign qualified available coverage.','Assigned eligible staffing meets or exceeds the current requirement.'
    from public.staffing_requirement_intervals i join current_requirements c on c.id=i.requirement_version_id
    left join lateral(select count(*)::integer planned from public.shifts s where s.organisation_id=i.organisation_id and s.venue_id=i.venue_id and s.role_id=i.role_id and s.staff_id is not null and s.status in('draft','published') and s.starts_at<i.ends_at and s.ends_at>i.starts_at) p on true
    where i.organisation_id=target_organisation_id and i.venue_id=target_venue_id and i.ends_at>target_reference_at and coalesce(p.planned,0)<i.required_staff
    union all
    select 'swap:'||w.id,'swap_decision',case when w.state='candidate_accepted' then 'high' else 'medium' end,
      (case when w.state='candidate_accepted' then 340000 else 220000 end)::bigint,s.starts_at,w.shift_id,w.requester_staff_id,w.id,jsonb_build_object('swap_id',w.id,'state',w.state,'candidate_staff_id',w.candidate_staff_id,'shift_revision',s.revision),
      case when w.state='candidate_accepted' then 'Both employees consented; manager validation is now required.' else 'An employee swap is waiting for candidate consent.' end,
      case when w.state='candidate_accepted' then 'Review cost and constraints, then approve or reject.' else 'Wait for or review candidate consent.' end,'The swap is approved, rejected or cancelled.'
    from public.swap_requests w join public.shifts s on s.organisation_id=w.organisation_id and s.id=w.shift_id where w.organisation_id=target_organisation_id and w.venue_id=target_venue_id and w.state in('requested','candidate_accepted') and s.ends_at>target_reference_at
    union all
    select 'time-correction:'||c.id,'time_correction','high',320000,c.created_at,t.shift_id,t.staff_id,c.id,jsonb_build_object('time_correction_id',c.id,'time_record_id',c.time_record_id,'reason',c.reason),
      'An employee correction request is awaiting a reasoned manager decision.','Compare the proposed values with immutable clock evidence, then approve or reject.','The correction status is approved or rejected.'
    from public.time_corrections c join public.time_records t on t.organisation_id=c.organisation_id and t.id=c.time_record_id where c.organisation_id=target_organisation_id and c.venue_id=target_venue_id and c.status='requested'
    union all
    select 'hours:'||t.id,'submitted_hours','medium',250000,t.clocked_out_at,t.shift_id,t.staff_id,t.id,jsonb_build_object('time_record_id',t.id,'clocked_in_at',t.clocked_in_at,'clocked_out_at',t.clocked_out_at,'break_minutes',t.break_minutes),
      'Submitted worked time is not yet authoritative and cannot reach close.','Review planned versus worked time and approve it.','The time record is approved, or a correction request supersedes this review item.'
    from public.time_records t where t.organisation_id=target_organisation_id and t.venue_id=target_venue_id and t.status='submitted' and t.clocked_out_at is not null and not exists(select 1 from public.time_corrections c where c.organisation_id=t.organisation_id and c.time_record_id=t.id and c.status='requested')
    union all
    select 'open-shift:'||o.id,'open_shift',case when o.closes_at<=target_reference_at or s.starts_at-target_reference_at<interval '12 hours' then 'critical' else 'high' end,
      (case when o.closes_at<=target_reference_at then 430000 when s.starts_at-target_reference_at<interval '12 hours' then 390000 else 300000 end)::bigint,s.starts_at,o.shift_id,null::uuid,o.id,jsonb_build_object('offer_id',o.id,'state',o.state,'closes_at',o.closes_at,'shift_revision',s.revision),
      case when o.closes_at<=target_reference_at then 'An unresolved open-shift offer has expired.' else 'A published shift is still waiting for an eligible claimant.' end,
      'Review eligible coverage, extend through a governed offer, or assign a qualified replacement.','The offer is assigned, confirmed, withdrawn or cancelled and the shift is covered.'
    from public.open_shift_offers o join public.shifts s on s.organisation_id=o.organisation_id and s.id=o.shift_id where o.organisation_id=target_organisation_id and o.venue_id=target_venue_id and o.state in('offered','claiming') and s.ends_at>target_reference_at
    union all
    select 'stale-proposal:'||p.id,'stale_proposal','medium',210000,p.created_at,null::uuid,null::uuid,p.id,jsonb_build_object('proposal_id',p.id,'objective',p.objective,'input_hash',p.input_hash),
      'Authoritative planning evidence changed after this proposal was generated.','Regenerate alternatives from current demand, availability and workforce evidence.','A current proposal replaces this stale proposal.'
    from public.roster_proposals p where p.organisation_id=target_organisation_id and p.venue_id=target_venue_id and p.status='stale' and p.created_at>target_reference_at-interval '30 days'
      and not exists(select 1 from public.roster_proposals newer where newer.organisation_id=p.organisation_id and newer.venue_id=p.venue_id and newer.status='current' and newer.window_start=p.window_start and newer.window_end=p.window_end and newer.created_at>p.created_at)
  ) select q.* from queue q order by q.rank_score desc,q.relevant_at asc,q.action_key asc;
end $$;

create table public.workforce_learning_results(
  id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id) on delete restrict,venue_id uuid not null,
  service_operation_id uuid not null,service_date date not null,evidence_state text not null check(evidence_state in('insufficient_comparables','ready')),
  comparable_count integer not null check(comparable_count>=0),comparison_method jsonb not null,result jsonb not null,evidence_refs jsonb not null,
  calculation_version text not null,content_hash text not null,created_at timestamptz not null default now(),unique(organisation_id,service_operation_id),unique(organisation_id,content_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict
);
alter table public.workforce_learning_results enable row level security;
create policy workforce_learning_read on public.workforce_learning_results for select using(public.has_venue_access(organisation_id,venue_id));
create policy workforce_learning_insert on public.workforce_learning_results for insert with check(public.has_capability(organisation_id,venue_id,'actions.manage'));
create trigger workforce_learning_immutable before update or delete on public.workforce_learning_results for each row execute function public.prevent_append_only_mutation();

create or replace function public.calculate_workforce_learning(target_organisation_id uuid,target_service_operation_id uuid)
returns public.workforce_learning_results language plpgsql security definer set search_path='' as $$
declare op public.service_operations; close_row public.closing_sessions; labour public.approved_labour_results; roster public.roster_versions; result_row public.workforce_learning_results;
  comparable_count integer:=0; comparable jsonb:='[]'; state text; result jsonb; method jsonb; refs jsonb; digest_value text;
begin
  select * into op from public.service_operations where organisation_id=target_organisation_id and id=target_service_operation_id;
  if op.id is null or not public.has_capability(target_organisation_id,op.venue_id,'actions.manage') then raise exception 'forbidden'; end if;
  if op.status<>'locked' or op.locked_at is null then raise exception 'locked_service_required'; end if;
  select * into close_row from public.closing_sessions where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date=op.service_date and status='locked' order by version desc limit 1;
  if close_row.id is null then raise exception 'locked_close_required'; end if;
  select * into labour from public.approved_labour_results where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date=op.service_date order by calculated_at desc,id desc limit 1;
  if labour.id is null then raise exception 'approved_labour_required'; end if;
  select * into roster from public.roster_versions where organisation_id=target_organisation_id and id=op.roster_version_id and published_at is not null and status in('published','superseded');
  if roster.id is null then raise exception 'published_roster_required'; end if;
  with candidates as (
    select distinct on(other.service_date) other.id,other.service_date,prior.id labour_id,prior.planned_minutes,prior.worked_minutes,prior.planned_cost_minor,prior.actual_cost_minor,(prior.evidence->>'actual_revenue_minor')::bigint actual_revenue_minor,prior.content_hash
    from public.service_operations other join public.closing_sessions c on c.organisation_id=other.organisation_id and c.venue_id=other.venue_id and c.trading_date=other.service_date and c.status='locked'
    join public.approved_labour_results prior on prior.organisation_id=other.organisation_id and prior.venue_id=other.venue_id and prior.trading_date=other.service_date
    where other.organisation_id=target_organisation_id and other.venue_id=op.venue_id and other.id<>op.id and other.status='locked' and extract(isodow from other.service_date)=extract(isodow from op.service_date)
      and (labour.evidence->>'actual_revenue_minor')::bigint>0 and (prior.evidence->>'actual_revenue_minor')::bigint between ((labour.evidence->>'actual_revenue_minor')::bigint*7000)/10000 and ((labour.evidence->>'actual_revenue_minor')::bigint*13000)/10000
    order by other.service_date,prior.calculated_at desc,other.version desc
  ), recent as(select * from candidates order by service_date desc limit 8)
  select count(*)::integer,coalesce(jsonb_agg(to_jsonb(recent) order by service_date),'[]'::jsonb) into comparable_count,comparable from recent;
  state=case when comparable_count>=3 then 'ready' else 'insufficient_comparables' end;
  method=jsonb_build_object('same_venue',true,'same_iso_weekday',true,'actual_revenue_band_basis_points',jsonb_build_array(7000,13000),'minimum_comparables',3,'maximum_comparables',8,'deduplicate_by_service_date',true);
  result=case when state='ready' then jsonb_build_object('planned_minutes',labour.planned_minutes,'worked_minutes',labour.worked_minutes,'minute_variance',labour.worked_minutes-labour.planned_minutes,'planned_cost_minor',labour.planned_cost_minor,'actual_cost_minor',labour.actual_cost_minor,'cost_variance_minor',labour.actual_cost_minor-labour.planned_cost_minor,
    'comparable_average_worked_minutes',(select round(avg((item->>'worked_minutes')::numeric))::bigint from jsonb_array_elements(comparable) item),'comparable_average_actual_cost_minor',(select round(avg((item->>'actual_cost_minor')::numeric))::bigint from jsonb_array_elements(comparable) item),
    'statement_code','descriptive_comparison_only') else jsonb_build_object('statement_code','not_enough_comparable_closed_services','required_comparables',3,'available_comparables',comparable_count) end;
  refs=jsonb_build_object('service_operation_id',op.id,'close_id',close_row.id,'roster_version_id',roster.id,'roster_content_hash',roster.content_hash,'approved_labour_result_id',labour.id,'labour_content_hash',labour.content_hash,'comparables',comparable);
  digest_value=encode(extensions.digest((jsonb_build_object('state',state,'method',method,'result',result,'refs',refs))::text,'sha256'),'hex');
  insert into public.workforce_learning_results(organisation_id,venue_id,service_operation_id,service_date,evidence_state,comparable_count,comparison_method,result,evidence_refs,calculation_version,content_hash)
    values(target_organisation_id,op.venue_id,op.id,op.service_date,state,comparable_count,method,result,refs,'workforce-learning-v1',digest_value) on conflict(organisation_id,service_operation_id) do nothing returning * into result_row;
  if result_row.id is null then select * into result_row from public.workforce_learning_results where organisation_id=target_organisation_id and service_operation_id=op.id; end if;
  return result_row;
end $$;

revoke all on function public.get_workforce_exception_inbox(uuid,uuid,timestamptz) from public,anon;
revoke all on function public.calculate_workforce_learning(uuid,uuid) from public,anon;
grant execute on function public.get_workforce_exception_inbox(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.calculate_workforce_learning(uuid,uuid) to authenticated;
grant select on public.workforce_learning_results to authenticated;
grant all on public.workforce_learning_results to service_role;

commit;
