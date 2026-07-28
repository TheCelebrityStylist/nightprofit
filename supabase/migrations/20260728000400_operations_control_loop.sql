begin;

insert into public.capability_permissions(capability,description) values
('planning.manage','Create, review and publish venue rosters'),
('planning.respond','Submit availability and respond to assigned shifts'),
('time.manage','Review and approve employee time records'),
('time.record','Record own attendance and breaks'),
('actions.manage','Own and resolve operating actions'),
('ai.propose','Create governed operational proposals')
on conflict(capability) do update set description=excluded.description;

insert into public.role_capabilities(role,capability) values
('owner','planning.manage'),('owner','planning.respond'),('owner','time.manage'),('owner','time.record'),('owner','actions.manage'),('owner','ai.propose'),
('administrator','planning.manage'),('administrator','planning.respond'),('administrator','time.manage'),('administrator','time.record'),('administrator','actions.manage'),('administrator','ai.propose'),
('manager','planning.manage'),('manager','planning.respond'),('manager','time.manage'),('manager','time.record'),('manager','actions.manage'),('manager','ai.propose'),
('venue_manager','planning.manage'),('venue_manager','planning.respond'),('venue_manager','time.manage'),('venue_manager','time.record'),('venue_manager','actions.manage'),('venue_manager','ai.propose'),
('bookkeeper','time.manage'),('bookkeeper','actions.manage'),
('finance','time.manage'),('finance','actions.manage'),
('bookings','planning.respond'),('procurement','planning.respond'),('compliance_manager','planning.respond')
on conflict do nothing;

alter table public.staff_profiles
  add constraint staff_profiles_org_id_unique unique(organisation_id,id);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,name),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
alter table public.departments add constraint departments_org_id_unique unique(organisation_id,id);

create table public.operational_roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  department_id uuid not null,
  name text not null,
  hourly_cost_minor bigint not null check(hourly_cost_minor>=0),
  minimum_staff integer not null default 0 check(minimum_staff>=0),
  guests_per_staff integer not null default 30 check(guests_per_staff>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organisation_id,department_id,name),
  foreign key(organisation_id,department_id) references public.departments(organisation_id,id)
);
alter table public.operational_roles add constraint operational_roles_org_id_unique unique(organisation_id,id);

create table public.staff_role_qualifications (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null,
  role_id uuid not null,
  qualified_until date,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(staff_id,role_id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade,
  foreign key(organisation_id,role_id) references public.operational_roles(organisation_id,id) on delete cascade
);

create table public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  availability text not null check(availability in ('available','preferred','unavailable')),
  note text,
  source text not null default 'manager' check(source in ('manager','employee','availability_link')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);

create table public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  absence_type text not null check(absence_type in ('leave','sickness','other')),
  status text not null check(status in ('requested','approved','rejected','recorded')),
  note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);

create table public.demand_forecasts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  trading_date date not null,
  status text not null check(status in ('draft','approved','superseded')),
  source_basis jsonb not null default '[]',
  assumptions jsonb not null default '{}',
  missing_data text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,trading_date,status),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
alter table public.demand_forecasts add constraint demand_forecasts_org_id_unique unique(organisation_id,id);

create table public.demand_forecast_intervals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  forecast_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expected_guests integer not null check(expected_guests>=0),
  expected_revenue_minor bigint not null check(expected_revenue_minor>=0),
  required_staff integer not null check(required_staff>=0),
  confidence_basis text not null,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,forecast_id) references public.demand_forecasts(organisation_id,id) on delete cascade
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  department_id uuid not null,
  role_id uuid not null,
  staff_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check(break_minutes between 0 and 480),
  hourly_cost_minor bigint not null check(hourly_cost_minor>=0),
  status text not null check(status in ('draft','published','accepted','rejected','cancelled','completed')),
  source text not null check(source in ('manager','template','deterministic_proposal','ai_proposal')),
  publication_batch uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,department_id) references public.departments(organisation_id,id),
  foreign key(organisation_id,role_id) references public.operational_roles(organisation_id,id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);
alter table public.shifts add constraint shifts_org_id_unique unique(organisation_id,id);

create table public.shift_responses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  shift_id uuid not null,
  staff_id uuid not null,
  response text not null check(response in ('accepted','rejected','claim_requested','swap_requested')),
  reason text,
  created_at timestamptz not null default now(),
  unique(shift_id,staff_id,response),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,shift_id) references public.shifts(organisation_id,id) on delete cascade,
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);

create table public.time_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  shift_id uuid,
  staff_id uuid not null,
  clocked_in_at timestamptz not null,
  clocked_out_at timestamptz,
  break_minutes integer not null default 0 check(break_minutes between 0 and 480),
  status text not null check(status in ('open','submitted','approved','corrected')),
  correction_reason text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,shift_id) references public.shifts(organisation_id,id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);

create table public.operating_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  action_type text not null,
  title text not null,
  rationale text not null,
  severity text not null check(severity in ('low','medium','high','critical')),
  status text not null check(status in ('open','approved','in_progress','resolved','dismissed')),
  owner_id uuid references auth.users(id),
  due_at timestamptz,
  expected_impact_minor bigint,
  evidence_refs jsonb not null default '[]',
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  action_type text not null,
  proposed_change jsonb not null,
  rationale text not null,
  expected_effect jsonb not null default '{}',
  evidence_refs jsonb not null default '[]',
  input_snapshot jsonb not null,
  missing_data text[] not null default '{}',
  confidence_basis text not null,
  model_version text not null,
  prompt_version text not null,
  approval_status text not null check(approval_status in ('proposed','approved','rejected')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  execution_status text not null check(execution_status in ('not_started','executed','failed','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create index demand_interval_window_idx on public.demand_forecast_intervals(organisation_id,venue_id,starts_at);
create index shifts_roster_window_idx on public.shifts(organisation_id,venue_id,starts_at,status);
create index shifts_staff_window_idx on public.shifts(organisation_id,staff_id,starts_at) where staff_id is not null;
create index availability_staff_window_idx on public.staff_availability(organisation_id,staff_id,starts_at);
create index operating_actions_queue_idx on public.operating_actions(organisation_id,status,severity,due_at);
create index time_records_staff_window_idx on public.time_records(organisation_id,staff_id,clocked_in_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'departments','operational_roles','staff_role_qualifications','staff_availability',
    'staff_absences','demand_forecasts','demand_forecast_intervals','shifts',
    'shift_responses','time_records','operating_actions','ai_proposals'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
  end loop;
end $$;

create policy departments_read on public.departments for select using(public.is_venue_member(organisation_id,venue_id));
create policy departments_write on public.departments for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy operational_roles_read on public.operational_roles for select using(public.is_member(organisation_id));
create policy operational_roles_write on public.operational_roles for all using(public.has_capability(organisation_id,null,'planning.manage')) with check(public.has_capability(organisation_id,null,'planning.manage'));
create policy qualifications_read on public.staff_role_qualifications for select using(public.has_capability(organisation_id,null,'planning.manage'));
create policy qualifications_write on public.staff_role_qualifications for all using(public.has_capability(organisation_id,null,'planning.manage')) with check(public.has_capability(organisation_id,null,'planning.manage'));
create policy availability_read on public.staff_availability for select using(public.has_capability(organisation_id,venue_id,'planning.manage') or created_by=auth.uid());
create policy availability_write on public.staff_availability for all using(public.has_capability(organisation_id,venue_id,'planning.manage') or created_by=auth.uid()) with check(public.has_capability(organisation_id,venue_id,'planning.manage') or created_by=auth.uid());
create policy absences_manager on public.staff_absences for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy forecasts_read on public.demand_forecasts for select using(public.is_venue_member(organisation_id,venue_id));
create policy forecasts_write on public.demand_forecasts for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy intervals_read on public.demand_forecast_intervals for select using(public.is_venue_member(organisation_id,venue_id));
create policy intervals_write on public.demand_forecast_intervals for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy shifts_read on public.shifts for select using(public.is_venue_member(organisation_id,venue_id));
create policy shifts_write on public.shifts for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy responses_read on public.shift_responses for select using(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy responses_write on public.shift_responses for insert with check(public.has_capability(organisation_id,venue_id,'planning.respond'));
create policy time_records_read on public.time_records for select using(public.has_capability(organisation_id,venue_id,'time.manage'));
create policy time_records_manage on public.time_records for all using(public.has_capability(organisation_id,venue_id,'time.manage')) with check(public.has_capability(organisation_id,venue_id,'time.manage'));
create policy actions_read on public.operating_actions for select using(public.is_member(organisation_id));
create policy actions_write on public.operating_actions for all using(public.has_capability(organisation_id,venue_id,'actions.manage')) with check(public.has_capability(organisation_id,venue_id,'actions.manage'));
create policy proposals_read on public.ai_proposals for select using(public.is_member(organisation_id));
create policy proposals_write on public.ai_proposals for all using(public.has_capability(organisation_id,venue_id,'ai.propose')) with check(public.has_capability(organisation_id,venue_id,'ai.propose'));

create or replace function public.create_demand_plan(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_trading_date date,
  interval_inputs jsonb,
  target_assumptions jsonb default '{}'::jsonb
) returns public.demand_forecasts
language plpgsql security definer set search_path=''
as $$
declare
  created_forecast public.demand_forecasts;
  interval_input jsonb;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage')
  then raise exception 'forbidden'; end if;
  if jsonb_typeof(interval_inputs)<>'array' or jsonb_array_length(interval_inputs)=0
  then raise exception 'intervals_required'; end if;
  update public.demand_forecasts set status='superseded'
    where organisation_id=target_organisation_id and venue_id=target_venue_id
      and trading_date=target_trading_date and status='draft';
  insert into public.demand_forecasts(
    organisation_id,venue_id,trading_date,status,source_basis,assumptions,missing_data,created_by
  ) values (
    target_organisation_id,target_venue_id,target_trading_date,'draft',
    jsonb_build_array(jsonb_build_object('source','manager_input','verified',true)),
    target_assumptions,array['Historical interval calibration is not yet available.'],auth.uid()
  ) returning * into created_forecast;
  for interval_input in select * from jsonb_array_elements(interval_inputs)
  loop
    insert into public.demand_forecast_intervals(
      organisation_id,venue_id,forecast_id,starts_at,ends_at,expected_guests,
      expected_revenue_minor,required_staff,confidence_basis
    ) values (
      target_organisation_id,target_venue_id,created_forecast.id,
      (interval_input->>'starts_at')::timestamptz,(interval_input->>'ends_at')::timestamptz,
      (interval_input->>'expected_guests')::integer,(interval_input->>'expected_revenue_minor')::bigint,
      (interval_input->>'required_staff')::integer,'Deterministic manager input; no calibrated statistical confidence.'
    );
  end loop;
  return created_forecast;
end $$;

create or replace function public.publish_roster(
  target_organisation_id uuid,
  target_venue_id uuid,
  window_start timestamptz,
  window_end timestamptz
) returns integer
language plpgsql security definer set search_path=''
as $$
declare published_count integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage')
  then raise exception 'forbidden'; end if;
  if window_end<=window_start then raise exception 'invalid_window'; end if;
  if exists (
    select 1 from public.shifts left_shift
    join public.shifts right_shift on right_shift.organisation_id=left_shift.organisation_id
      and right_shift.staff_id=left_shift.staff_id and right_shift.id<>left_shift.id
      and right_shift.starts_at<left_shift.ends_at and right_shift.ends_at>left_shift.starts_at
      and right_shift.status not in ('cancelled','rejected')
    where left_shift.organisation_id=target_organisation_id and left_shift.venue_id=target_venue_id
      and left_shift.staff_id is not null and left_shift.starts_at>=window_start and left_shift.starts_at<window_end
      and left_shift.status='draft'
  ) then raise exception 'overlapping_shifts'; end if;
  update public.shifts set status='published',publication_batch=gen_random_uuid(),updated_at=now()
    where organisation_id=target_organisation_id and venue_id=target_venue_id
      and starts_at>=window_start and starts_at<window_end and status='draft';
  get diagnostics published_count=row_count;
  if published_count=0 then raise exception 'no_draft_shifts'; end if;
  insert into public.audit_logs(organisation_id,venue_id,actor_id,action,entity_type,entity_id,after_summary,correlation_id,source)
    values(target_organisation_id,target_venue_id,auth.uid(),'roster.published','venue',target_venue_id,
      jsonb_build_object('window_start',window_start,'window_end',window_end,'shift_count',published_count),
      gen_random_uuid(),'database_function');
  return published_count;
end $$;

grant select,insert,update,delete on public.departments,public.operational_roles,public.staff_role_qualifications,
  public.staff_availability,public.staff_absences,public.demand_forecasts,public.demand_forecast_intervals,
  public.shifts,public.shift_responses,public.time_records,public.operating_actions,public.ai_proposals to authenticated;
grant execute on function public.create_demand_plan(uuid,uuid,date,jsonb,jsonb) to authenticated;
grant execute on function public.publish_roster(uuid,uuid,timestamptz,timestamptz) to authenticated;

commit;
