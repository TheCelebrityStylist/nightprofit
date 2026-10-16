-- Team & Roster: employees, shifts, availability, leave/sickness and
-- immutable, versioned week publications. Money in integer minor units.
begin;

create extension if not exists btree_gist with schema extensions;

insert into public.capability_permissions(capability,description) values
('roster.view','View rosters, availability and labour cost'),
('roster.manage','Edit employees, shifts, availability and leave requests'),
('roster.publish','Publish roster weeks and decide on leave')
on conflict(capability) do update set description=excluded.description;

insert into public.role_capabilities(role,capability) values
('owner','roster.view'),('owner','roster.manage'),('owner','roster.publish'),
('administrator','roster.view'),('administrator','roster.manage'),('administrator','roster.publish'),
('manager','roster.view'),('manager','roster.manage'),('manager','roster.publish'),
('venue_manager','roster.view'),('venue_manager','roster.manage'),('venue_manager','roster.publish'),
('finance','roster.view'),('bookkeeper','roster.view')
on conflict do nothing;

create table public.roster_employees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{8,20}$'),
  email extensions.citext,
  default_role text not null default 'bar' check (length(btrim(default_role)) between 1 and 40),
  hourly_cost_minor bigint not null default 0 check (hourly_cost_minor between 0 and 100000),
  contract_minutes_week integer check (contract_minutes_week is null or contract_minutes_week between 0 and 4800),
  active boolean not null default true,
  notes text check (notes is null or length(notes)<=500),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,id)
);
create index roster_employees_org_idx on public.roster_employees(organisation_id,active,full_name);

create table public.roster_shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  service_date date not null,
  employee_id uuid,
  role text not null default 'bar' check (length(btrim(role)) between 1 and 40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 180),
  hourly_cost_minor bigint not null default 0 check (hourly_cost_minor between 0 and 100000),
  notes text check (notes is null or length(notes)<=500),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  published_version integer,
  changed_since_publish boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id) on delete cascade,
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete restrict,
  constraint roster_shift_window check (ends_at > starts_at and ends_at - starts_at <= interval '16 hours'),
  constraint roster_shift_break check (break_minutes * interval '1 minute' < ends_at - starts_at),
  constraint roster_no_double_booking exclude using gist (
    employee_id with =, tstzrange(starts_at,ends_at,'[)') with &&
  ) where (employee_id is not null and status='scheduled')
);
create index roster_shifts_week_idx on public.roster_shifts(venue_id,service_date);
create index roster_shifts_employee_idx on public.roster_shifts(employee_id,service_date);

create table public.roster_availability (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null,
  service_date date not null,
  status text not null check (status in ('available','preferred','unavailable')),
  note text check (note is null or length(note)<=300),
  source text not null default 'manager' check (source in ('manager','whatsapp','phone','self')),
  recorded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id,service_date),
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete cascade
);

create table public.roster_leave (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null,
  kind text not null check (kind in ('leave','sick','other')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  note text check (note is null or length(note)<=300),
  requested_by uuid references auth.users(id) default auth.uid(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 366),
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete cascade
);
create index roster_leave_range_idx on public.roster_leave(organisation_id,starts_on,ends_on);

create table public.roster_publications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  venue_id uuid not null,
  week_start date not null check (extract(isodow from week_start)=1),
  version integer not null check (version>0),
  shift_count integer not null,
  open_shift_count integer not null,
  paid_minutes bigint not null,
  labour_cost_minor bigint not null,
  snapshot jsonb not null,
  content_hash text not null,
  note text,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique(venue_id,week_start,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id) on delete restrict
);
create trigger immutable_roster_publications before update or delete on public.roster_publications
for each row execute function public.prevent_mutation();

-- Deterministic cost rule shared with lib/roster.ts: paid minutes x hourly
-- cost / 60, rounded half up, integer arithmetic only.
create or replace function public.roster_shift_cost_minor(paid_minutes bigint, hourly_cost_minor bigint)
returns bigint language sql immutable set search_path='' as $$
  select ((paid_minutes*hourly_cost_minor*2)+60)/120
$$;
create or replace function public.roster_paid_minutes(starts_at timestamptz, ends_at timestamptz, break_minutes integer)
returns bigint language sql immutable set search_path='' as $$
  select (extract(epoch from (ends_at-starts_at))::bigint/60) - break_minutes
$$;

create or replace function public.roster_shift_guard() returns trigger
language plpgsql set search_path='' as $$
declare venue_tz text; local_day date; employee_rate bigint; employee_active boolean;
begin
  if tg_op='DELETE' then
    if old.published_version is not null then
      raise exception 'PUBLISHED_SHIFT_CANNOT_BE_DELETED' using hint='Cancel the shift and republish the week.';
    end if;
    return old;
  end if;

  select timezone into venue_tz from public.venues where id=new.venue_id and organisation_id=new.organisation_id;
  if venue_tz is null then raise exception 'VENUE_NOT_FOUND'; end if;
  local_day := (new.starts_at at time zone venue_tz)::date;
  if local_day not in (new.service_date, new.service_date+1) then
    raise exception 'SHIFT_OUTSIDE_SERVICE_DATE';
  end if;

  if new.employee_id is not null and (tg_op='INSERT' or new.employee_id is distinct from old.employee_id) then
    select hourly_cost_minor, active into employee_rate, employee_active
    from public.roster_employees where id=new.employee_id and organisation_id=new.organisation_id;
    if employee_active is distinct from true then raise exception 'EMPLOYEE_INACTIVE'; end if;
    new.hourly_cost_minor := employee_rate;
  end if;

  if tg_op='INSERT' then
    new.published_version := null;
    new.changed_since_publish := true;
  elsif new.published_version is not distinct from old.published_version then
    if (new.employee_id, new.role, new.starts_at, new.ends_at, new.break_minutes, new.status, new.service_date, new.notes, new.hourly_cost_minor)
       is distinct from
       (old.employee_id, old.role, old.starts_at, old.ends_at, old.break_minutes, old.status, old.service_date, old.notes, old.hourly_cost_minor) then
      new.changed_since_publish := true;
    else
      new.changed_since_publish := old.changed_since_publish;
    end if;
  elsif current_setting('nightprofit.roster_publish', true) is distinct from 'on' then
    raise exception 'PUBLICATION_STATE_IS_SYSTEM_MANAGED';
  end if;
  return new;
end $$;
create trigger roster_shift_guard before insert or update or delete on public.roster_shifts
for each row execute function public.roster_shift_guard();

create or replace function public.roster_leave_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.kind='sick' then
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
    elsif new.status<>'requested' then
      if not public.has_capability(new.organisation_id,null,'roster.publish') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    else
      new.decided_by := null; new.decided_at := null;
    end if;
  elsif new.status is distinct from old.status then
    if old.kind<>'sick' and not public.has_capability(new.organisation_id,null,'roster.publish') then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
    new.decided_by := case when new.status='requested' then null else auth.uid() end;
    new.decided_at := case when new.status='requested' then null else now() end;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;
create trigger roster_leave_guard before insert or update on public.roster_leave
for each row execute function public.roster_leave_guard();

do $$ declare t text; begin
  foreach t in array array['roster_employees','roster_shifts','roster_availability','roster_leave'] loop
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()',t,t);
  end loop;
end $$;

-- Append-only audit of every roster mutation, written by the database itself.
create or replace function public.roster_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; before_data jsonb; after_data jsonb; venue uuid;
begin
  if tg_op='DELETE' then row_data := to_jsonb(old); else row_data := to_jsonb(new); end if;
  before_data := case when tg_op='INSERT' then null else to_jsonb(old) - 'phone' - 'email' - 'hourly_cost_minor' - 'notes' end;
  after_data := case when tg_op='DELETE' then null else to_jsonb(new) - 'phone' - 'email' - 'hourly_cost_minor' - 'notes' end;
  venue := nullif(row_data->>'venue_id','')::uuid;
  insert into public.audit_logs(organisation_id,venue_id,actor_id,action,entity_type,entity_id,before_summary,after_summary,correlation_id,source)
  values((row_data->>'organisation_id')::uuid, venue, auth.uid(), tg_table_name||'.'||lower(tg_op), tg_table_name,
         (row_data->>'id')::uuid, before_data, after_data, gen_random_uuid(), 'database');
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['roster_employees','roster_shifts','roster_leave'] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.roster_audit()',t,t);
  end loop;
end $$;

create or replace function public.publish_roster_week(target_venue_id uuid, target_week_start date, publish_note text default null)
returns public.roster_publications
language plpgsql security definer set search_path='' as $$
declare
  target_venue public.venues;
  next_version integer;
  pending integer;
  shifts_json jsonb;
  totals record;
  snapshot_data jsonb;
  result public.roster_publications;
begin
  select * into target_venue from public.venues where id=target_venue_id;
  if target_venue.id is null then raise exception 'VENUE_NOT_FOUND'; end if;
  if not public.has_capability(target_venue.organisation_id,target_venue.id,'roster.publish') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if extract(isodow from target_week_start)<>1 then raise exception 'WEEK_START_NOT_MONDAY'; end if;
  if publish_note is not null and length(publish_note)>300 then raise exception 'NOTE_TOO_LONG'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_venue_id::text||':'||target_week_start::text,0));

  select coalesce(max(version),0)+1 into next_version from public.roster_publications
  where venue_id=target_venue_id and week_start=target_week_start;

  select count(*) into pending from public.roster_shifts
  where venue_id=target_venue_id and service_date between target_week_start and target_week_start+6
    and changed_since_publish
    and (status='scheduled' or published_version is not null);
  if pending=0 then raise exception 'NO_CHANGES_TO_PUBLISH'; end if;

  select count(*)::integer as shift_count,
         count(*) filter (where s.employee_id is null)::integer as open_count,
         coalesce(sum(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes)),0)::bigint as minutes,
         coalesce(sum(public.roster_shift_cost_minor(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),s.hourly_cost_minor)),0)::bigint as cost
  into totals
  from public.roster_shifts s
  where s.venue_id=target_venue_id and s.service_date between target_week_start and target_week_start+6 and s.status='scheduled';

  select coalesce(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'service_date',s.service_date,'employee_id',s.employee_id,'employee_name',e.full_name,
    'role',s.role,'starts_at',s.starts_at,'ends_at',s.ends_at,'break_minutes',s.break_minutes,
    'hourly_cost_minor',s.hourly_cost_minor,
    'paid_minutes',public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),
    'cost_minor',public.roster_shift_cost_minor(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),s.hourly_cost_minor),
    'notes',s.notes
  ) order by s.starts_at,s.id),'[]'::jsonb)
  into shifts_json
  from public.roster_shifts s left join public.roster_employees e on e.id=s.employee_id
  where s.venue_id=target_venue_id and s.service_date between target_week_start and target_week_start+6 and s.status='scheduled';

  snapshot_data := jsonb_build_object(
    'schema_version','1','venue_id',target_venue.id,'venue_name',target_venue.name,'timezone',target_venue.timezone,
    'week_start',target_week_start,'version',next_version,'currency_minor_units',true,'shifts',shifts_json);

  insert into public.roster_publications(organisation_id,venue_id,week_start,version,shift_count,open_shift_count,
    paid_minutes,labour_cost_minor,snapshot,content_hash,note,published_by)
  values(target_venue.organisation_id,target_venue.id,target_week_start,next_version,totals.shift_count,totals.open_count,
    totals.minutes,totals.cost,snapshot_data,
    encode(extensions.digest(convert_to(snapshot_data::text,'UTF8'),'sha256'),'hex'),publish_note,auth.uid())
  returning * into result;

  perform set_config('nightprofit.roster_publish','on',true);
  update public.roster_shifts set published_version=next_version, changed_since_publish=false
  where venue_id=target_venue_id and service_date between target_week_start and target_week_start+6 and changed_since_publish;
  perform set_config('nightprofit.roster_publish','off',true);

  insert into public.audit_logs(organisation_id,venue_id,actor_id,action,entity_type,entity_id,after_summary,correlation_id,source)
  values(target_venue.organisation_id,target_venue.id,auth.uid(),'roster.published','roster_publication',result.id,
    jsonb_build_object('week_start',target_week_start,'version',next_version,'shift_count',totals.shift_count,
      'labour_cost_minor',totals.cost,'content_hash',result.content_hash),gen_random_uuid(),'database');
  return result;
end $$;

alter table public.roster_employees enable row level security;
alter table public.roster_shifts enable row level security;
alter table public.roster_availability enable row level security;
alter table public.roster_leave enable row level security;
alter table public.roster_publications enable row level security;

create policy roster_employees_read on public.roster_employees for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_employees_write on public.roster_employees for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_shifts_read on public.roster_shifts for select
using(public.has_capability(organisation_id,venue_id,'roster.view'));
create policy roster_shifts_write on public.roster_shifts for all
using(public.has_capability(organisation_id,venue_id,'roster.manage'))
with check(public.has_capability(organisation_id,venue_id,'roster.manage'));

create policy roster_availability_read on public.roster_availability for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_availability_write on public.roster_availability for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_leave_read on public.roster_leave for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_leave_write on public.roster_leave for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_publications_read on public.roster_publications for select
using(public.has_capability(organisation_id,venue_id,'roster.view'));

grant select, insert, update, delete on public.roster_employees, public.roster_shifts,
  public.roster_availability, public.roster_leave to authenticated;
grant select on public.roster_publications to authenticated;
revoke insert, update, delete on public.roster_publications from authenticated;
grant all privileges on public.roster_employees, public.roster_shifts, public.roster_availability,
  public.roster_leave, public.roster_publications to service_role;
revoke execute on function public.roster_shift_guard() from public, authenticated;
revoke execute on function public.roster_leave_guard() from public, authenticated;
revoke execute on function public.roster_audit() from public, authenticated;
grant execute on function public.publish_roster_week(uuid,date,text) to authenticated;
grant execute on function public.roster_paid_minutes(timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.roster_shift_cost_minor(bigint,bigint) to authenticated;

commit;
