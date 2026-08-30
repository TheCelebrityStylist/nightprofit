begin;

create table public.roster_change_sets(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  operation text not null check(operation in ('cancel','lock','unlock','assign','role')),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  current_revisions jsonb not null,
  state text not null default 'applied' check(state in ('applied','undone')),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  replayed_at timestamptz,
  unique(organisation_id,idempotency_key),
  unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

alter table public.roster_change_sets enable row level security;
create policy roster_change_sets_manager on public.roster_change_sets for select
  using(public.has_capability(organisation_id,venue_id,'planning.manage'));
grant select on public.roster_change_sets to authenticated;
grant all on public.roster_change_sets to service_role;

create or replace function public.mutate_roster_shifts(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_shift_ids uuid[],
  target_expected_revisions jsonb,
  target_operation text,
  target_staff_id uuid default null,
  target_role_id uuid default null,
  target_idempotency_key uuid default gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  existing public.roster_change_sets;
  change_set public.roster_change_sets;
  before_rows jsonb;
  after_rows jsonb;
  revisions jsonb;
  shift_count integer;
  role_department uuid;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_operation not in ('cancel','lock','unlock','assign','role') or coalesce(array_length(target_shift_ids,1),0)=0 or array_length(target_shift_ids,1)>100 then raise exception 'invalid_bulk_operation'; end if;
  select * into existing from public.roster_change_sets where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if existing.id is not null then return jsonb_build_object('changed',jsonb_array_length(existing.after_snapshot),'change_set_id',existing.id,'replayed',true); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text,0));
  perform 1 from public.shifts s where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.id=any(target_shift_ids) for update;
  select count(*),coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into shift_count,before_rows
  from public.shifts s where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.id=any(target_shift_ids);
  if shift_count<>array_length(target_shift_ids,1) then raise exception 'shift_not_found'; end if;
  if exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.id=any(target_shift_ids)
    and (coalesce((target_expected_revisions->>s.id::text)::integer,-1)<>s.revision or (s.locked and target_operation not in ('unlock','lock')))) then raise exception 'concurrent_shift_edit'; end if;
  if target_operation='assign' then
    if target_staff_id is null or not exists(select 1 from public.staff_venue_assignments a where a.organisation_id=target_organisation_id and a.venue_id=target_venue_id and a.staff_id=target_staff_id) then raise exception 'invalid_staff_assignment'; end if;
    if exists(select 1 from public.shifts selected join public.shifts other on other.organisation_id=selected.organisation_id and other.staff_id=target_staff_id and other.id<>selected.id and other.id<>all(target_shift_ids) and other.status not in ('cancelled','rejected') and other.starts_at<selected.ends_at and other.ends_at>selected.starts_at where selected.organisation_id=target_organisation_id and selected.venue_id=target_venue_id and selected.id=any(target_shift_ids)) then raise exception 'shift_overlap'; end if;
  end if;
  if target_operation='role' then
    select department_id into role_department from public.operational_roles where organisation_id=target_organisation_id and id=target_role_id and active=true;
    if role_department is null then raise exception 'invalid_role'; end if;
  end if;
  update public.shifts set
    status=case when target_operation='cancel' then 'cancelled' else status end,
    locked=case when target_operation='lock' then true when target_operation='unlock' then false else locked end,
    staff_id=case when target_operation='assign' then target_staff_id else staff_id end,
    role_id=case when target_operation='role' then target_role_id else role_id end,
    department_id=case when target_operation='role' then role_department else department_id end,
    revision=revision+1,updated_at=now()
  where organisation_id=target_organisation_id and venue_id=target_venue_id and id=any(target_shift_ids);
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb),coalesce(jsonb_object_agg(s.id::text,s.revision),'{}'::jsonb) into after_rows,revisions
  from public.shifts s where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.id=any(target_shift_ids);
  insert into public.roster_change_sets(organisation_id,venue_id,operation,before_snapshot,after_snapshot,current_revisions,idempotency_key,created_by)
  values(target_organisation_id,target_venue_id,target_operation,before_rows,after_rows,revisions,target_idempotency_key,auth.uid()) returning * into change_set;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(target_organisation_id,target_venue_id,'roster_change_set',change_set.id,'roster.bulk_changed',auth.uid(),jsonb_build_object('operation',target_operation,'shift_count',shift_count));
  return jsonb_build_object('changed',shift_count,'change_set_id',change_set.id,'replayed',false);
end $$;

create or replace function public.replay_roster_change(target_organisation_id uuid,target_change_set_id uuid,target_direction text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare change_set public.roster_change_sets; item jsonb; expected_state text; source_snapshot jsonb; revisions jsonb;
begin
  select * into change_set from public.roster_change_sets where organisation_id=target_organisation_id and id=target_change_set_id for update;
  if change_set.id is null or not public.has_capability(target_organisation_id,change_set.venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  expected_state=case when target_direction='undo' then 'applied' when target_direction='redo' then 'undone' else null end;
  if expected_state is null or change_set.state<>expected_state then raise exception 'invalid_history_transition'; end if;
  if exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.id in(select (value->>'id')::uuid from jsonb_array_elements(change_set.before_snapshot)) and coalesce((change_set.current_revisions->>s.id::text)::integer,-1)<>s.revision) then raise exception 'concurrent_shift_edit'; end if;
  source_snapshot=case when target_direction='undo' then change_set.before_snapshot else change_set.after_snapshot end;
  for item in select value from jsonb_array_elements(source_snapshot) loop
    update public.shifts set department_id=(item->>'department_id')::uuid,role_id=(item->>'role_id')::uuid,staff_id=nullif(item->>'staff_id','')::uuid,starts_at=(item->>'starts_at')::timestamptz,ends_at=(item->>'ends_at')::timestamptz,break_minutes=(item->>'break_minutes')::integer,hourly_cost_minor=(item->>'hourly_cost_minor')::bigint,status=item->>'status',locked=(item->>'locked')::boolean,revision=revision+1,updated_at=now()
    where organisation_id=target_organisation_id and venue_id=change_set.venue_id and id=(item->>'id')::uuid;
  end loop;
  select coalesce(jsonb_object_agg(s.id::text,s.revision),'{}'::jsonb) into revisions from public.shifts s where s.organisation_id=target_organisation_id and s.id in(select (value->>'id')::uuid from jsonb_array_elements(change_set.before_snapshot));
  update public.roster_change_sets set state=case when target_direction='undo' then 'undone' else 'applied' end,current_revisions=revisions,replayed_at=now() where id=change_set.id returning * into change_set;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,change_set.venue_id,'roster_change_set',change_set.id,'roster.'||target_direction,auth.uid(),jsonb_build_object('operation',change_set.operation));
  return jsonb_build_object('change_set_id',change_set.id,'state',change_set.state,'current_revisions',change_set.current_revisions);
end $$;

revoke all on function public.mutate_roster_shifts(uuid,uuid,uuid[],jsonb,text,uuid,uuid,uuid) from public,anon;
revoke all on function public.replay_roster_change(uuid,uuid,text) from public,anon;
grant execute on function public.mutate_roster_shifts(uuid,uuid,uuid[],jsonb,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.replay_roster_change(uuid,uuid,text) to authenticated;

commit;
