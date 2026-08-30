begin;

create table public.workforce_scenarios(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  scenario_type text not null check(scenario_type in ('demand_change','sickness','service_time','minimum_coverage','revenue_change','locked_extension','role_unavailable','labor_target')),
  inputs jsonb not null,
  result jsonb not null,
  status text not null default 'draft' check(status in ('draft','applied','discarded')),
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  check(window_end>window_start),
  unique(organisation_id,idempotency_key),
  unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.shift_break_plans(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  shift_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check(status in ('planned','adjusted','taken','missed','cancelled')),
  revision integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at),
  unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,shift_id) references public.shifts(organisation_id,id) on delete cascade
);

create table public.payroll_export_versions(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  period_start date not null,
  period_end date not null,
  version integer not null,
  status text not null default 'approved' check(status in ('approved','exported','superseded')),
  totals jsonb not null,
  content_hash text not null,
  column_version text not null default 'nightprofit-payroll-v1',
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  exported_at timestamptz,
  unique(organisation_id,venue_id,period_start,period_end,version),
  unique(organisation_id,content_hash),
  unique(organisation_id,id),
  check(period_end>=period_start),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.payroll_export_lines(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  export_version_id uuid not null,
  staff_id uuid not null,
  approved_minutes integer not null check(approved_minutes>=0),
  base_cost_minor bigint not null check(base_cost_minor>=0),
  supplement_minor bigint not null check(supplement_minor>=0),
  total_cost_minor bigint not null check(total_cost_minor=base_cost_minor+supplement_minor),
  evidence jsonb not null,
  unique(organisation_id,export_version_id,staff_id),
  foreign key(organisation_id,export_version_id) references public.payroll_export_versions(organisation_id,id) on delete cascade,
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);

alter table public.workforce_scenarios enable row level security;
alter table public.shift_break_plans enable row level security;
alter table public.payroll_export_versions enable row level security;
alter table public.payroll_export_lines enable row level security;

create policy workforce_scenarios_manager on public.workforce_scenarios for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy shift_break_plans_read on public.shift_break_plans for select
  using(public.has_venue_access(organisation_id,venue_id));
create policy shift_break_plans_manage on public.shift_break_plans for all
  using(public.has_capability(organisation_id,venue_id,'planning.manage'))
  with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy payroll_versions_manager on public.payroll_export_versions for select
  using(public.has_capability(organisation_id,venue_id,'time.approve'));
create policy payroll_lines_manager on public.payroll_export_lines for select
  using(exists(select 1 from public.payroll_export_versions v where v.organisation_id=payroll_export_lines.organisation_id and v.id=payroll_export_lines.export_version_id and public.has_capability(v.organisation_id,v.venue_id,'time.approve')));

create or replace function public.validate_roster_version_constraints()
returns trigger language plpgsql security definer set search_path='' as $$
declare violation text;
begin
  if new.status<>'published' then return new; end if;
  if exists(select 1 from public.shifts s where s.organisation_id=new.organisation_id and s.venue_id=new.venue_id and s.status='draft' and s.starts_at>=new.window_start and s.starts_at<new.window_end and s.staff_id is null) then raise exception 'open_shift_unresolved'; end if;
  if exists(select 1 from public.shifts s where s.organisation_id=new.organisation_id and s.venue_id=new.venue_id and s.status='draft' and s.starts_at>=new.window_start and s.starts_at<new.window_end and not exists(select 1 from public.staff_availability a where a.organisation_id=s.organisation_id and a.venue_id=s.venue_id and a.staff_id=s.staff_id and a.availability in ('available','preferred','preferably_not') and a.starts_at<=s.starts_at and a.ends_at>=s.ends_at)) then raise exception 'availability_conflict'; end if;
  if exists(select 1 from public.shifts s where s.organisation_id=new.organisation_id and s.venue_id=new.venue_id and s.status='draft' and s.starts_at>=new.window_start and s.starts_at<new.window_end and not exists(select 1 from public.staff_role_qualifications q where q.organisation_id=s.organisation_id and q.staff_id=s.staff_id and q.role_id=s.role_id and (q.qualified_until is null or q.qualified_until>=s.starts_at::date))) then raise exception 'role_qualification_missing'; end if;
  if exists(select 1 from public.shifts s join public.staff_absences a on a.organisation_id=s.organisation_id and a.staff_id=s.staff_id and a.status in ('approved','recorded') and a.starts_at<s.ends_at and a.ends_at>s.starts_at where s.organisation_id=new.organisation_id and s.venue_id=new.venue_id and s.status='draft' and s.starts_at>=new.window_start and s.starts_at<new.window_end) then raise exception 'absence_conflict'; end if;
  if exists(with ordered as (select s.staff_id,s.starts_at,s.ends_at,lag(s.ends_at) over(partition by s.staff_id order by s.starts_at,s.id) previous_end from public.shifts s where s.organisation_id=new.organisation_id and s.staff_id is not null and s.status not in ('cancelled','rejected') and s.starts_at<new.window_end+interval '11 hours' and s.ends_at>new.window_start-interval '11 hours') select 1 from ordered where previous_end is not null and starts_at-previous_end<interval '11 hours') then raise exception 'minimum_rest_violation'; end if;
  if exists(select 1 from public.staff_profiles p join lateral(select coalesce(sum(greatest(0,floor(extract(epoch from(s.ends_at-s.starts_at))/60)::integer-s.break_minutes)),0) minutes from public.shifts s where s.organisation_id=p.organisation_id and s.staff_id=p.id and s.status not in ('cancelled','rejected') and s.starts_at>=new.window_start and s.starts_at<new.window_end) planned on true where p.organisation_id=new.organisation_id and p.maximum_minutes_week is not null and planned.minutes>p.maximum_minutes_week) then raise exception 'maximum_hours_violation'; end if;
  return new;
end $$;

drop trigger if exists validate_roster_version_constraints on public.roster_versions;
create trigger validate_roster_version_constraints before insert on public.roster_versions for each row execute function public.validate_roster_version_constraints();

create or replace function public.prevent_payroll_export_mutation()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' then raise exception 'immutable_payroll_export'; end if;
  if old.organisation_id<>new.organisation_id or old.venue_id<>new.venue_id or old.period_start<>new.period_start or old.period_end<>new.period_end or old.version<>new.version or old.totals<>new.totals or old.content_hash<>new.content_hash or old.column_version<>new.column_version or old.approved_by<>new.approved_by or old.approved_at<>new.approved_at then raise exception 'immutable_payroll_export'; end if;
  if not(old.status='approved' and new.status='exported' and new.exported_at is not null) then raise exception 'invalid_payroll_export_transition'; end if;
  return new;
end $$;
create trigger payroll_versions_immutable before update or delete on public.payroll_export_versions for each row execute function public.prevent_payroll_export_mutation();
create or replace function public.prevent_payroll_export_line_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'immutable_payroll_export_line';
end;
$$;
create trigger payroll_lines_immutable before update or delete on public.payroll_export_lines for each row execute function public.prevent_payroll_export_line_mutation();

grant select,insert,update on public.workforce_scenarios,public.shift_break_plans to authenticated;
grant select on public.payroll_export_versions,public.payroll_export_lines to authenticated;
grant all on public.workforce_scenarios,public.shift_break_plans,public.payroll_export_versions,public.payroll_export_lines to service_role;

commit;
