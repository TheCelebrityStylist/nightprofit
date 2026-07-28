begin;

insert into public.capability_permissions(capability,description) values
('planning.manage','Manage demand forecasts, availability and staff schedules'),
('planning.publish','Publish schedules and open shifts'),
('time.manage','Review attendance and worked time')
on conflict(capability) do update set description=excluded.description;

insert into public.role_capabilities(role,capability)
select role, capability
from (values
  ('owner'::public.member_role),('administrator'::public.member_role),
  ('manager'::public.member_role),('venue_manager'::public.member_role)
) roles(role)
cross join (values ('planning.manage'),('planning.publish'),('time.manage')) capabilities(capability)
on conflict do nothing;

create table public.demand_forecasts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  trading_date date not null,
  interval_start timestamptz not null,
  interval_end timestamptz not null,
  expected_guests integer not null check(expected_guests>=0),
  expected_revenue_minor bigint not null check(expected_revenue_minor>=0),
  confidence_basis_points integer not null default 0 check(confidence_basis_points between 0 and 10000),
  source_basis text[] not null default '{}',
  assumptions jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,venue_id,interval_start),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

alter table public.staff_profiles
  add constraint staff_profiles_org_id_unique unique(organisation_id,id);

create table public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  staff_profile_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  availability text not null check(availability in ('available','unavailable','preferred')),
  source text not null default 'manager' check(source in ('manager','employee','whatsapp','import')),
  note text,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_profile_id) references public.staff_profiles(organisation_id,id) on delete cascade
);

create table public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  staff_profile_id uuid,
  role_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check(break_minutes between 0 and 720),
  hourly_cost_minor bigint not null default 0 check(hourly_cost_minor>=0),
  status text not null default 'draft' check(status in ('draft','open','published','accepted','declined','completed','cancelled')),
  source text not null default 'manual' check(source in ('manual','ai_proposal','template','open_shift')),
  demand_forecast_id uuid references public.demand_forecasts(id) on delete set null,
  note text,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_profile_id) references public.staff_profiles(organisation_id,id) on delete set null
);

create table public.time_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  shift_id uuid references public.staff_shifts(id) on delete set null,
  staff_profile_id uuid not null,
  clocked_in_at timestamptz not null,
  clocked_out_at timestamptz,
  break_minutes integer not null default 0 check(break_minutes between 0 and 720),
  status text not null default 'open' check(status in ('open','submitted','approved','corrected')),
  correction_reason text,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_profile_id) references public.staff_profiles(organisation_id,id) on delete cascade
);

create table public.operating_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  action_date date not null,
  domain text not null check(domain in ('revenue','bookings','planning','purchasing','service','close','compliance')),
  title text not null,
  rationale text not null,
  impact_minor bigint,
  priority text not null check(priority in ('critical','high','medium','low')),
  status text not null default 'proposed' check(status in ('proposed','approved','in_progress','done','dismissed')),
  evidence jsonb not null default '[]',
  generated_by text not null default 'rules' check(generated_by in ('rules','ai','human')),
  model text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create index demand_forecasts_day_idx on public.demand_forecasts(organisation_id,venue_id,trading_date,interval_start);
create index staff_availability_window_idx on public.staff_availability(organisation_id,venue_id,starts_at,ends_at);
create index staff_shifts_window_idx on public.staff_shifts(organisation_id,venue_id,starts_at,ends_at);
create index time_records_window_idx on public.time_records(organisation_id,venue_id,clocked_in_at);
create index operating_actions_queue_idx on public.operating_actions(organisation_id,action_date,status,priority);

do $$ declare t text; begin
  foreach t in array array['demand_forecasts','staff_availability','staff_shifts','time_records','operating_actions']
  loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy demand_forecasts_read on public.demand_forecasts for select using(public.is_venue_member(organisation_id,venue_id));
create policy demand_forecasts_write on public.demand_forecasts for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy staff_availability_read on public.staff_availability for select using(public.is_venue_member(organisation_id,venue_id));
create policy staff_availability_write on public.staff_availability for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy staff_shifts_read on public.staff_shifts for select using(public.is_venue_member(organisation_id,venue_id));
create policy staff_shifts_write on public.staff_shifts for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy time_records_read on public.time_records for select using(public.is_venue_member(organisation_id,venue_id));
create policy time_records_write on public.time_records for all
  using(public.has_capability(organisation_id,venue_id,'time.manage'))
  with check(public.has_capability(organisation_id,venue_id,'time.manage'));
create policy operating_actions_read on public.operating_actions for select
  using((venue_id is null and public.is_member(organisation_id)) or public.is_venue_member(organisation_id,venue_id));
create policy operating_actions_write on public.operating_actions for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));

grant select,insert,update,delete on public.demand_forecasts,public.staff_availability,public.staff_shifts,public.time_records,public.operating_actions to authenticated;
grant all on public.demand_forecasts,public.staff_availability,public.staff_shifts,public.time_records,public.operating_actions to service_role;

commit;
