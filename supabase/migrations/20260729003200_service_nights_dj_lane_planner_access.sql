-- Service nights: a venue's standard opening week, extra nights, a separate DJ lane
-- and a delegable planner permission. Applied to production 2026-10-17.

-- Departments get a kind so DJs are planned in their own lane and never count
-- towards bar/floor coverage.
alter table public.departments
  add column if not exists kind text not null default 'staff'
  check (kind in ('staff','dj'));

-- Standard week: per ISO weekday the shifts a normal night needs.
-- lines = [{role_id, count, start "HH:MM", end "HH:MM", break_minutes}]
-- An end at or before the start runs past midnight. Writes only via functions.
create table if not exists public.venue_service_patterns(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  active boolean not null default true,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines)='array'),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id, venue_id) references public.venues(organisation_id, id) on delete cascade,
  unique (organisation_id, venue_id, iso_weekday)
);
alter table public.venue_service_patterns enable row level security;
create policy venue_service_patterns_read on public.venue_service_patterns
  for select using (public.is_venue_member(organisation_id, venue_id));
grant select on public.venue_service_patterns to authenticated;

-- Planners need the team list (names, contact) to plan and share rosters.
create policy staff_profiles_planner_read on public.staff_profiles
  for select using (public.has_capability(organisation_id, null, 'planning.manage'));

create or replace function public.normalize_service_lines(
  target_organisation_id uuid, target_venue_id uuid, target_lines jsonb
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare item jsonb; result jsonb:='[]'::jsonb; role_ok boolean; line_count integer; start_text text; end_text text; break_value integer;
begin
  if target_lines is null or jsonb_typeof(target_lines)<>'array' then raise exception 'invalid_service_lines'; end if;
  if jsonb_array_length(target_lines)>20 then raise exception 'too_many_service_lines'; end if;
  for item in select value from jsonb_array_elements(target_lines) loop
    start_text=item->>'start'; end_text=item->>'end';
    line_count=coalesce((item->>'count')::integer,0);
    break_value=coalesce((item->>'break_minutes')::integer,0);
    if start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_service_time'; end if;
    if start_text=end_text then raise exception 'invalid_service_time'; end if;
    if line_count not between 1 and 50 then raise exception 'invalid_service_count'; end if;
    if break_value not between 0 and 120 then raise exception 'invalid_service_break'; end if;
    select exists(select 1 from public.operational_roles r join public.departments d on d.organisation_id=r.organisation_id and d.id=r.department_id
      where r.organisation_id=target_organisation_id and r.id=(item->>'role_id')::uuid and r.active and d.venue_id=target_venue_id and d.active) into role_ok;
    if not role_ok then raise exception 'invalid_service_role'; end if;
    result=result||jsonb_build_array(jsonb_build_object('role_id',item->>'role_id','count',line_count,'start',start_text,'end',end_text,'break_minutes',break_value));
  end loop;
  return result;
end $$;

create or replace function public.save_service_pattern(
  target_organisation_id uuid, target_venue_id uuid, target_iso_weekday integer, target_active boolean, target_lines jsonb
) returns public.venue_service_patterns
language plpgsql security definer set search_path=''
as $$
declare result public.venue_service_patterns; clean jsonb;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_iso_weekday not between 1 and 7 then raise exception 'invalid_weekday'; end if;
  clean=public.normalize_service_lines(target_organisation_id,target_venue_id,coalesce(target_lines,'[]'::jsonb));
  if target_active and jsonb_array_length(clean)=0 then raise exception 'service_lines_required'; end if;
  insert into public.venue_service_patterns(organisation_id,venue_id,iso_weekday,active,lines,updated_by,updated_at)
  values(target_organisation_id,target_venue_id,target_iso_weekday,target_active,clean,auth.uid(),now())
  on conflict(organisation_id,venue_id,iso_weekday) do update set active=excluded.active,lines=excluded.lines,updated_by=excluded.updated_by,updated_at=now()
  returning * into result;
  return result;
end $$;

-- Creates the open draft shifts a night needs. Running it twice never doubles a
-- night: only the shortfall per role and time slot is added. Times are local
-- venue time, so DST nights get their real length.
create or replace function public.plan_service_night(
  target_organisation_id uuid, target_venue_id uuid, target_service_date date, target_lines jsonb default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare clean jsonb; item jsonb; venue_tz text; start_at timestamptz; end_at timestamptz; existing integer; missing integer;
  role_row public.operational_roles; created integer:=0; already integer:=0; i integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  select coalesce(nullif(timezone,''),'Europe/Amsterdam') into venue_tz from public.venues where organisation_id=target_organisation_id and id=target_venue_id;
  if venue_tz is null then raise exception 'venue_not_found'; end if;
  if target_lines is null then
    select lines into clean from public.venue_service_patterns
      where organisation_id=target_organisation_id and venue_id=target_venue_id
        and iso_weekday=extract(isodow from target_service_date)::integer and active;
    if clean is null then raise exception 'no_standard_night'; end if;
  else
    clean=public.normalize_service_lines(target_organisation_id,target_venue_id,target_lines);
  end if;
  if jsonb_array_length(clean)=0 then raise exception 'service_lines_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text,0));
  for item in select value from jsonb_array_elements(clean) loop
    select * into role_row from public.operational_roles where organisation_id=target_organisation_id and id=(item->>'role_id')::uuid;
    start_at=(target_service_date+(item->>'start')::time) at time zone venue_tz;
    end_at=((target_service_date+case when (item->>'end')::time<=(item->>'start')::time then 1 else 0 end)+(item->>'end')::time) at time zone venue_tz;
    select count(*) into existing from public.shifts
      where organisation_id=target_organisation_id and venue_id=target_venue_id and role_id=role_row.id
        and starts_at=start_at and ends_at=end_at and status not in ('cancelled','rejected');
    missing=greatest((item->>'count')::integer-existing,0);
    already=already+least(existing,(item->>'count')::integer);
    for i in 1..missing loop
      insert into public.shifts(organisation_id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source,locked,created_by)
      values(target_organisation_id,target_venue_id,role_row.department_id,role_row.id,null,start_at,end_at,(item->>'break_minutes')::integer,role_row.hourly_cost_minor,'draft','template',false,auth.uid());
      created=created+1;
    end loop;
  end loop;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(target_organisation_id,target_venue_id,'service_night',target_venue_id,'service_night.planned',auth.uid(),
    jsonb_build_object('service_date',target_service_date,'created',created,'already_present',already,'standard',target_lines is null));
  return jsonb_build_object('service_date',target_service_date,'created',created,'already_present',already);
end $$;

create or replace function public.apply_standard_week(
  target_organisation_id uuid, target_venue_id uuid, target_week_start date
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare pattern public.venue_service_patterns; night jsonb; nights jsonb:='[]'::jsonb; created integer:=0;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if extract(isodow from target_week_start)<>1 then raise exception 'week_must_start_monday'; end if;
  for pattern in select * from public.venue_service_patterns
    where organisation_id=target_organisation_id and venue_id=target_venue_id and active order by iso_weekday loop
    night=public.plan_service_night(target_organisation_id,target_venue_id,target_week_start+(pattern.iso_weekday-1),null);
    nights=nights||jsonb_build_array(night);
    created=created+(night->>'created')::integer;
  end loop;
  if jsonb_array_length(nights)=0 then raise exception 'no_standard_week'; end if;
  return jsonb_build_object('created',created,'nights',nights);
end $$;

-- Planner permission: lets a team member with an account plan, request
-- availability and publish, without owner/finance access.
create or replace function public.set_staff_planner(
  target_organisation_id uuid, target_staff_id uuid, target_enabled boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare member_user uuid; capability_name text;
begin
  if not public.has_capability(target_organisation_id,null,'members.manage') then raise exception 'forbidden'; end if;
  select s.auth_user_id into member_user from public.staff_profiles s
    join public.organisation_members m on m.organisation_id=s.organisation_id and m.user_id=s.auth_user_id and m.active
    where s.organisation_id=target_organisation_id and s.id=target_staff_id;
  if member_user is null then raise exception 'staff_has_no_account'; end if;
  if member_user=auth.uid() then raise exception 'cannot_change_own_access'; end if;
  foreach capability_name in array array['planning.manage','planning.respond','workforce.manage'] loop
    if target_enabled then
      insert into public.member_capability_overrides(organisation_id,user_id,capability,allowed)
      values(target_organisation_id,member_user,capability_name,true)
      on conflict(organisation_id,user_id,capability) do update set allowed=true;
    else
      delete from public.member_capability_overrides
        where organisation_id=target_organisation_id and user_id=member_user and capability=capability_name;
    end if;
  end loop;
  insert into public.audit_logs(organisation_id,actor_id,action,entity_type,entity_id,after_summary,correlation_id,source)
  values(target_organisation_id,auth.uid(),case when target_enabled then 'planner.granted' else 'planner.revoked' end,'staff_profile',target_staff_id,
    jsonb_build_object('capabilities',array['planning.manage','planning.respond','workforce.manage']),gen_random_uuid(),'planning_api');
  return jsonb_build_object('staff_id',target_staff_id,'planner',target_enabled);
end $$;

revoke execute on function public.normalize_service_lines(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.save_service_pattern(uuid,uuid,integer,boolean,jsonb) from public, anon;
revoke execute on function public.plan_service_night(uuid,uuid,date,jsonb) from public, anon;
revoke execute on function public.apply_standard_week(uuid,uuid,date) from public, anon;
revoke execute on function public.set_staff_planner(uuid,uuid,boolean) from public, anon;
grant execute on function public.save_service_pattern(uuid,uuid,integer,boolean,jsonb) to authenticated;
grant execute on function public.plan_service_night(uuid,uuid,date,jsonb) to authenticated;
grant execute on function public.apply_standard_week(uuid,uuid,date) to authenticated;
grant execute on function public.set_staff_planner(uuid,uuid,boolean) to authenticated;
