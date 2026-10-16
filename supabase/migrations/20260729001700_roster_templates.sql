begin;

create table public.roster_templates(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, name text not null check(length(trim(name)) between 2 and 100), shift_pattern jsonb not null,
  active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organisation_id,venue_id,name), unique(organisation_id,id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create table public.roster_template_applications(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, template_id uuid not null, starts_at timestamptz not null, repeat_count integer not null check(repeat_count between 1 and 52),
  idempotency_key uuid not null, created_shift_ids uuid[] not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,template_id) references public.roster_templates(organisation_id,id)
);
alter table public.roster_templates enable row level security;
alter table public.roster_template_applications enable row level security;
create policy roster_templates_manager on public.roster_templates for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy roster_template_applications_manager on public.roster_template_applications for select using(public.has_capability(organisation_id,venue_id,'planning.manage'));
grant select,insert,update on public.roster_templates to authenticated;
grant select on public.roster_template_applications to authenticated;
grant all on public.roster_templates,public.roster_template_applications to service_role;

create or replace function public.save_roster_template(target_organisation_id uuid,target_venue_id uuid,target_name text,target_shift_ids uuid[])
returns public.roster_templates language plpgsql security definer set search_path='' as $$
declare result public.roster_templates; origin timestamptz; pattern jsonb; row_count integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if length(trim(target_name)) not between 2 and 100 or coalesce(array_length(target_shift_ids,1),0)=0 or array_length(target_shift_ids,1)>200 then raise exception 'invalid_template'; end if;
  select count(*),min(starts_at) into row_count,origin from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=any(target_shift_ids) and status not in ('cancelled','rejected');
  if row_count<>array_length(target_shift_ids,1) then raise exception 'shift_not_found'; end if;
  select jsonb_agg(jsonb_build_object('department_id',department_id,'role_id',role_id,'staff_id',staff_id,'offset_seconds',floor(extract(epoch from(starts_at-origin)))::integer,'duration_seconds',floor(extract(epoch from(ends_at-starts_at)))::integer,'break_minutes',break_minutes,'hourly_cost_minor',hourly_cost_minor,'locked',locked) order by starts_at,id) into pattern from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=any(target_shift_ids);
  insert into public.roster_templates(organisation_id,venue_id,name,shift_pattern,created_by) values(target_organisation_id,target_venue_id,trim(target_name),pattern,auth.uid())
  on conflict(organisation_id,venue_id,name) do update set shift_pattern=excluded.shift_pattern,active=true,updated_at=now() returning * into result;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,target_venue_id,'roster_template',result.id,'roster_template.saved',auth.uid(),jsonb_build_object('shift_count',row_count));
  return result;
end $$;

create or replace function public.apply_roster_template(target_organisation_id uuid,target_template_id uuid,target_starts_at timestamptz,target_repeat_count integer,target_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare template public.roster_templates; receipt public.roster_template_applications; item jsonb; repetition integer; created_ids uuid[]:='{}'; created_id uuid; start_time timestamptz; end_time timestamptz; candidate_staff uuid;
begin
  select * into receipt from public.roster_template_applications where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if receipt.id is not null then return jsonb_build_object('created',cardinality(receipt.created_shift_ids),'replayed',true); end if;
  select * into template from public.roster_templates where organisation_id=target_organisation_id and id=target_template_id and active=true;
  if template.id is null or not public.has_capability(target_organisation_id,template.venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_repeat_count not between 1 and 52 then raise exception 'invalid_repeat_count'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||template.venue_id::text,0));
  for repetition in 0..target_repeat_count-1 loop
    for item in select value from jsonb_array_elements(template.shift_pattern) loop
      start_time=target_starts_at+make_interval(secs=>(item->>'offset_seconds')::integer)+make_interval(days=>repetition*7); end_time=start_time+make_interval(secs=>(item->>'duration_seconds')::integer); candidate_staff=nullif(item->>'staff_id','')::uuid;
      if candidate_staff is not null and exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate_staff and s.status not in ('cancelled','rejected') and s.starts_at<end_time and s.ends_at>start_time) then raise exception 'template_shift_overlap'; end if;
      insert into public.shifts(organisation_id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source,locked,created_by)
      values(target_organisation_id,template.venue_id,(item->>'department_id')::uuid,(item->>'role_id')::uuid,candidate_staff,start_time,end_time,(item->>'break_minutes')::integer,(item->>'hourly_cost_minor')::bigint,'draft',case when target_repeat_count>1 then 'recurring_template' else 'template' end,(item->>'locked')::boolean,auth.uid()) returning id into created_id;
      created_ids=array_append(created_ids,created_id);
    end loop;
  end loop;
  insert into public.roster_template_applications(organisation_id,venue_id,template_id,starts_at,repeat_count,idempotency_key,created_shift_ids,created_by) values(target_organisation_id,template.venue_id,template.id,target_starts_at,target_repeat_count,target_idempotency_key,created_ids,auth.uid());
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,template.venue_id,'roster_template',template.id,'roster_template.applied',auth.uid(),jsonb_build_object('created',cardinality(created_ids),'repeat_count',target_repeat_count));
  return jsonb_build_object('created',cardinality(created_ids),'replayed',false);
end $$;

revoke all on function public.save_roster_template(uuid,uuid,text,uuid[]) from public,anon;
revoke all on function public.apply_roster_template(uuid,uuid,timestamptz,integer,uuid) from public,anon;
grant execute on function public.save_roster_template(uuid,uuid,text,uuid[]) to authenticated;
grant execute on function public.apply_roster_template(uuid,uuid,timestamptz,integer,uuid) to authenticated;
commit;
