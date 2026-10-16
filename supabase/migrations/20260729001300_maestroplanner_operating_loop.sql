begin;

-- Additive Maestroplanner fields. Historical workforce rows remain intact.
alter table public.staff_profiles add column if not exists first_name text;
alter table public.staff_profiles add column if not exists last_name text;
alter table public.staff_profiles add column if not exists employment_status text not null default 'pending';
alter table public.staff_profiles add column if not exists contracted_minutes_week integer;
alter table public.staff_profiles add column if not exists minimum_minutes_week integer;
alter table public.staff_profiles add column if not exists maximum_minutes_week integer;
alter table public.staff_profiles add column if not exists effective_hourly_cost_minor bigint;
alter table public.staff_profiles add column if not exists preferences jsonb not null default '{}';
alter table public.staff_profiles add column if not exists invitation_state text not null default 'not_invited';
update public.staff_profiles set employment_status=case when onboarding_status in ('suspended','rejected','expired') then 'deactivated' when auth_user_id is not null then 'active' when onboarding_status='invited' then 'invited' else 'pending' end,
  invitation_state=case when auth_user_id is not null then 'accepted' when onboarding_status='invited' then 'pending' else invitation_state end,
  first_name=coalesce(first_name,split_part(full_name,' ',1)),last_name=coalesce(last_name,nullif(btrim(substring(full_name from length(split_part(full_name,' ',1))+1)),''));
alter table public.staff_profiles add constraint staff_profiles_employment_status_check
  check(employment_status in ('active','invited','pending','deactivated')) not valid;
alter table public.staff_profiles add constraint staff_profiles_invitation_state_check
  check(invitation_state in ('not_invited','pending','accepted','revoked','expired')) not valid;
alter table public.staff_profiles add constraint staff_profiles_minutes_check
  check((contracted_minutes_week is null or contracted_minutes_week>=0)
    and (minimum_minutes_week is null or minimum_minutes_week>=0)
    and (maximum_minutes_week is null or maximum_minutes_week>=coalesce(minimum_minutes_week,0))) not valid;
alter table public.staff_profiles add constraint staff_profiles_hourly_cost_check
  check(effective_hourly_cost_minor is null or effective_hourly_cost_minor>=0) not valid;

create table public.staff_skills(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null, name text not null, proficiency text not null default 'qualified',
  created_at timestamptz not null default now(), unique(organisation_id,staff_id,name),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);
create table public.staff_certifications(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null, name text not null, issued_on date, expires_on date, verified_by uuid references auth.users(id),
  verified_at timestamptz, created_at timestamptz not null default now(), unique(organisation_id,staff_id,name,expires_on),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);
create table public.staff_cost_supplements(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null, supplement_type text not null, basis_points integer not null check(basis_points between 0 and 100000),
  applies_from time, applies_until time, weekday_numbers integer[] not null default '{}', effective_from date not null,
  effective_until date, created_at timestamptz not null default now(),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);

alter table public.staff_availability drop constraint if exists staff_availability_availability_check;
alter table public.staff_availability add constraint staff_availability_availability_check
  check(availability in ('available','preferred','preferably_not','unavailable'));
alter table public.staff_availability add column if not exists provenance jsonb not null default '{}';
alter table public.staff_availability add column if not exists supersedes_id uuid references public.staff_availability(id);

alter table public.availability_request_periods add column if not exists cancelled_at timestamptz;
alter table public.availability_request_periods add column if not exists reminder_policy jsonb not null default '{"maximum_reminders":2}';
alter table public.availability_request_periods add column if not exists message_template_version integer not null default 1;
alter table public.availability_request_recipients add column if not exists destination_e164 text;
alter table public.availability_request_recipients add column if not exists provider text;
alter table public.availability_request_recipients add column if not exists provider_message_id text;
alter table public.availability_request_recipients add column if not exists provider_status_at timestamptz;
alter table public.availability_request_recipients add column if not exists reminder_count integer not null default 0;
alter table public.availability_request_recipients add column if not exists manually_shared_at timestamptz;
alter table public.availability_request_recipients add column if not exists failure_code text;
alter table public.availability_request_recipients add column if not exists opted_out_at timestamptz;
alter table public.secure_response_tokens add column if not exists access_count integer not null default 0;
alter table public.secure_response_tokens add column if not exists access_window_started_at timestamptz;
alter table public.availability_request_recipients drop constraint if exists availability_request_recipients_status_check;
alter table public.availability_request_recipients add constraint availability_request_recipients_status_check check(status in (
  'draft','ready','sent','missing_phone','invalid_phone','manually_shared','provider_accepted','delivered','read','opened',
  'partial','submitted','responded','reminder_due','failed','expired','cancelled','revoked'
));

create table public.availability_message_attempts(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, recipient_id uuid not null, attempt_type text not null check(attempt_type in ('initial','reminder')),
  channel text not null check(channel in ('whatsapp_provider','manual_whatsapp')), idempotency_key text not null,
  provider text, provider_message_id text, state text not null check(state in ('prepared','manually_shared','provider_accepted','delivered','read','failed')),
  failure_code text, failure_explanation text, attempted_by uuid references auth.users(id), attempted_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,recipient_id) references public.availability_request_recipients(organisation_id,id) on delete cascade
);

create table public.staffing_requirement_versions(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, service_operation_id uuid, trading_date date not null, version integer not null,
  interval_minutes integer not null check(interval_minutes in (15,30)), status text not null check(status in ('current','stale','superseded')),
  input_evidence jsonb not null, calculation_version text not null, manager_overrides jsonb not null default '{}',
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,trading_date,version), unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create table public.staffing_requirement_intervals(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, requirement_version_id uuid not null, department_id uuid not null, role_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null, required_staff integer not null check(required_staff>=0),
  expected_revenue_minor bigint not null default 0 check(expected_revenue_minor>=0), created_at timestamptz not null default now(),
  check(ends_at>starts_at), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,requirement_version_id) references public.staffing_requirement_versions(organisation_id,id) on delete cascade,
  foreign key(organisation_id,department_id) references public.departments(organisation_id,id),
  foreign key(organisation_id,role_id) references public.operational_roles(organisation_id,id)
);

alter table public.shifts add column if not exists locked boolean not null default false;
alter table public.shifts add column if not exists revision integer not null default 1;
alter table public.shifts add column if not exists roster_version_id uuid;
alter table public.shifts add column if not exists location_label text;
create index if not exists shifts_roster_version_idx on public.shifts(organisation_id,roster_version_id);

alter table public.roster_versions add column if not exists idempotency_key text;
alter table public.roster_versions add column if not exists source_revision integer not null default 0;
alter table public.roster_versions add column if not exists shift_snapshot jsonb not null default '[]';
alter table public.roster_versions add column if not exists content_hash text;
alter table public.roster_versions add column if not exists acknowledged_exceptions jsonb not null default '[]';
create unique index if not exists roster_versions_idempotency_unique on public.roster_versions(organisation_id,idempotency_key) where idempotency_key is not null;

create table public.roster_proposals(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, window_start timestamptz not null, window_end timestamptz not null,
  objective text not null check(objective in ('balanced','lowest_cost','preference')), status text not null check(status in ('current','stale','applied','rejected')),
  input_hash text not null, input_snapshot jsonb not null, result_summary jsonb not null, shift_plan jsonb not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.approved_labour_results(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, trading_date date not null, planned_minutes integer not null, worked_minutes integer not null,
  planned_cost_minor bigint not null, actual_cost_minor bigint not null, calculation_version text not null,
  evidence jsonb not null, content_hash text not null, calculated_at timestamptz not null default now(),
  unique(organisation_id,venue_id,trading_date,content_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create table public.workforce_import_receipts(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, idempotency_key text not null, imported_count integer not null, result jsonb not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

do $$ declare n text; begin foreach n in array array[
  'staff_skills','staff_certifications','staff_cost_supplements','availability_message_attempts',
  'staffing_requirement_versions','staffing_requirement_intervals','roster_proposals','approved_labour_results','workforce_import_receipts'
] loop execute format('alter table public.%I enable row level security',n); end loop; end $$;

create policy maestro_staff_manager on public.staff_skills for all using(public.has_capability(organisation_id,null,'workforce.manage')) with check(public.has_capability(organisation_id,null,'workforce.manage'));
create policy maestro_cert_manager on public.staff_certifications for all using(public.has_capability(organisation_id,null,'workforce.manage')) with check(public.has_capability(organisation_id,null,'workforce.manage'));
create policy maestro_supplement_manager on public.staff_cost_supplements for all using(public.has_capability(organisation_id,null,'workforce.manage')) with check(public.has_capability(organisation_id,null,'workforce.manage'));
create policy maestro_message_manager on public.availability_message_attempts for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy maestro_requirements_read on public.staffing_requirement_versions for select using(public.has_venue_access(organisation_id,venue_id));
create policy maestro_requirements_manage on public.staffing_requirement_versions for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy maestro_intervals_read on public.staffing_requirement_intervals for select using(public.has_venue_access(organisation_id,venue_id));
create policy maestro_intervals_manage on public.staffing_requirement_intervals for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy maestro_proposals_manage on public.roster_proposals for all using(public.has_capability(organisation_id,venue_id,'planning.manage')) with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy maestro_labour_read on public.approved_labour_results for select using(public.has_venue_access(organisation_id,venue_id));
create policy maestro_labour_manage on public.approved_labour_results for insert with check(public.has_capability(organisation_id,venue_id,'time.approve'));
create policy maestro_import_receipts on public.workforce_import_receipts for select using(public.has_capability(organisation_id,venue_id,'workforce.manage'));

create or replace function public.import_staff_profiles(
  target_organisation_id uuid,target_venue_id uuid,target_rows jsonb,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; existing public.staff_profiles; staff_id uuid; department_id uuid; role_id uuid; imported integer:=0; merged integer:=0; skipped integer:=0; receipt public.workforce_import_receipts; result jsonb;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'workforce.manage') then raise exception 'forbidden'; end if;
  if length(target_idempotency_key)<16 or jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows)>500 then raise exception 'invalid_import'; end if;
  select * into receipt from public.workforce_import_receipts where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if receipt.id is not null then return receipt.result||jsonb_build_object('replayed',true); end if;
  for item in select * from jsonb_array_elements(target_rows) loop
    select * into existing from public.staff_profiles where organisation_id=target_organisation_id and (lower(contact_email)=lower(item->>'email') or (item->>'phone'<>'' and contact_phone=item->>'phone')) order by created_at limit 1 for update;
    if existing.id is not null and item->>'decision'='reject' then raise exception 'duplicate_employee'; end if;
    if existing.id is not null and item->>'decision'='skip' then skipped:=skipped+1; continue; end if;
    select d.id into department_id from public.departments d where d.organisation_id=target_organisation_id and d.venue_id=target_venue_id and lower(d.name)=lower(item->>'department') and d.active;
    select r.id into role_id from public.operational_roles r where r.organisation_id=target_organisation_id and r.department_id=department_id and lower(r.name)=lower(item->>'role') and r.active;
    if department_id is null or role_id is null then raise exception 'unknown_department_or_role'; end if;
    if existing.id is not null and item->>'decision'='merge' then
      update public.staff_profiles set first_name=item->>'firstName',last_name=item->>'lastName',full_name=item->>'firstName'||' '||item->>'lastName',contact_email=item->>'email',contact_phone=nullif(item->>'phone',''),preferred_language=item->>'preferredLanguage',engagement_type=item->>'contractType',contracted_minutes_week=(item->>'contractedMinutesWeek')::integer,effective_hourly_cost_minor=(item->>'hourlyCostMinor')::bigint,role_name=item->>'role',updated_at=now() where id=existing.id returning id into staff_id;
      merged:=merged+1;
    elsif existing.id is null then
      insert into public.staff_profiles(organisation_id,first_name,last_name,full_name,contact_email,contact_phone,preferred_language,engagement_type,contracted_minutes_week,effective_hourly_cost_minor,role_name,onboarding_status,employment_status,invitation_state)
      values(target_organisation_id,item->>'firstName',item->>'lastName',item->>'firstName'||' '||item->>'lastName',item->>'email',nullif(item->>'phone',''),item->>'preferredLanguage',item->>'contractType',(item->>'contractedMinutesWeek')::integer,(item->>'hourlyCostMinor')::bigint,item->>'role','invited','invited','pending') returning id into staff_id;
      imported:=imported+1;
    else raise exception 'duplicate_decision_required'; end if;
    insert into public.staff_venue_assignments(organisation_id,staff_id,venue_id) values(target_organisation_id,staff_id,target_venue_id) on conflict do nothing;
    insert into public.staff_role_qualifications(organisation_id,staff_id,role_id,verified_by,verified_at) values(target_organisation_id,staff_id,role_id,auth.uid(),now()) on conflict(staff_id,role_id) do update set verified_by=excluded.verified_by,verified_at=excluded.verified_at;
  end loop;
  result=jsonb_build_object('imported',imported,'merged',merged,'skipped',skipped);
  insert into public.workforce_import_receipts(organisation_id,venue_id,idempotency_key,imported_count,result,created_by) values(target_organisation_id,target_venue_id,target_idempotency_key,imported,result,auth.uid());
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,target_venue_id,'workforce_import',(select id from public.workforce_import_receipts where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key),'staff.imported',auth.uid(),result);
  return result;
end $$;

create or replace function public.publish_roster_v2(
  target_organisation_id uuid,target_venue_id uuid,target_window_start timestamptz,target_window_end timestamptz,
  target_expected_revision integer,target_idempotency_key text,target_acknowledged_exceptions jsonb default '[]'
) returns public.roster_versions language plpgsql security definer set search_path='' as $$
declare result public.roster_versions; latest public.roster_versions; snapshot jsonb; current_revision integer; shift_count integer; digest text;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_window_end<=target_window_start or length(target_idempotency_key)<16 then raise exception 'invalid_publish_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text||target_window_start::text,0));
  select * into result from public.roster_versions where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if result.id is not null then return result; end if;
  select coalesce(max(revision),0),count(*) into current_revision,shift_count from public.shifts
    where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status='draft';
  if shift_count=0 then raise exception 'no_draft_shifts'; end if;
  if current_revision<>target_expected_revision then raise exception 'concurrent_roster_edit'; end if;
  if exists(select 1 from public.shifts l join public.shifts r on r.organisation_id=l.organisation_id and r.staff_id=l.staff_id and r.id<>l.id
      and r.starts_at<l.ends_at and r.ends_at>l.starts_at and r.status not in ('cancelled','rejected')
    where l.organisation_id=target_organisation_id and l.venue_id=target_venue_id and l.staff_id is not null
      and l.starts_at>=target_window_start and l.starts_at<target_window_end and l.status='draft') then raise exception 'overlapping_shifts'; end if;
  if exists(select 1 from public.shifts s join public.staff_absences a on a.organisation_id=s.organisation_id and a.staff_id=s.staff_id
      and a.status in ('approved','recorded') and a.starts_at<s.ends_at and a.ends_at>s.starts_at
    where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.starts_at>=target_window_start and s.starts_at<target_window_end and s.status='draft') then raise exception 'absence_conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'department_id',department_id,'role_id',role_id,'starts_at',starts_at,'ends_at',ends_at,'break_minutes',break_minutes,'hourly_cost_minor',hourly_cost_minor,'locked',locked) order by starts_at,id),'[]')
    into snapshot from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status='draft';
  digest=encode(digest(snapshot::text,'sha256'),'hex');
  select * into latest from public.roster_versions where organisation_id=target_organisation_id and venue_id=target_venue_id and window_start=target_window_start and window_end=target_window_end and status='published' order by version desc limit 1 for update;
  if latest.id is not null then update public.roster_versions set status='superseded' where id=latest.id; end if;
  insert into public.roster_versions(organisation_id,venue_id,window_start,window_end,version,status,validation_summary,cost_minor,approved_by,published_at,supersedes_id,idempotency_key,source_revision,shift_snapshot,content_hash,acknowledged_exceptions)
  select target_organisation_id,target_venue_id,target_window_start,target_window_end,coalesce(latest.version,0)+1,'published',jsonb_build_object('shift_count',shift_count,'hard_constraints','passed'),
    coalesce(sum((greatest(0,floor(extract(epoch from(ends_at-starts_at))/60)::integer-break_minutes)::bigint*hourly_cost_minor+30)/60),0),auth.uid(),now(),latest.id,target_idempotency_key,current_revision,snapshot,digest,target_acknowledged_exceptions
  from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status='draft' returning * into result;
  update public.shifts set status='published',publication_batch=result.id,roster_version_id=result.id,updated_at=now()
    where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status='draft';
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
    values(target_organisation_id,target_venue_id,'roster_version',result.id,'roster.published',auth.uid(),jsonb_build_object('version',result.version,'content_hash',digest,'shift_count',shift_count));
  return result;
end $$;

create or replace function public.apply_roster_proposal(target_organisation_id uuid,target_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal public.roster_proposals; item jsonb; created integer:=0;
begin
  select * into proposal from public.roster_proposals where organisation_id=target_organisation_id and id=target_proposal_id for update;
  if proposal.id is null or not public.has_capability(target_organisation_id,proposal.venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if proposal.status='applied' then return jsonb_build_object('created',0,'replayed',true); end if;
  if proposal.status<>'current' or exists(select 1 from public.staffing_requirement_versions where organisation_id=target_organisation_id and venue_id=proposal.venue_id and status='stale' and created_at>proposal.created_at) then raise exception 'stale_proposal'; end if;
  for item in select * from jsonb_array_elements(proposal.shift_plan) loop
    if item->>'staff_id' is not null and exists(select 1 from public.shifts where organisation_id=target_organisation_id and staff_id=(item->>'staff_id')::uuid and status not in ('cancelled','rejected') and starts_at<(item->>'ends_at')::timestamptz and ends_at>(item->>'starts_at')::timestamptz) then raise exception 'proposal_conflict'; end if;
    insert into public.shifts(organisation_id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source,created_by)
    values(target_organisation_id,proposal.venue_id,(item->>'department_id')::uuid,(item->>'role_id')::uuid,nullif(item->>'staff_id','')::uuid,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,(item->>'break_minutes')::integer,(item->>'hourly_cost_minor')::bigint,'draft','deterministic_proposal',auth.uid());
    created:=created+1;
  end loop;
  update public.roster_proposals set status='stale' where organisation_id=target_organisation_id and venue_id=proposal.venue_id and id<>proposal.id and status='current';
  update public.roster_proposals set status='applied' where id=proposal.id;
  perform public.append_operational_event(target_organisation_id,proposal.venue_id,'roster_proposal',proposal.id,'roster_proposal.applied',jsonb_build_object('created_shifts',created),gen_random_uuid());
  return jsonb_build_object('created',created,'replayed',false);
end $$;

create or replace function public.submit_availability_request_v2(target_token_hash text,target_entry_inputs jsonb,target_final boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods; staff public.staff_profiles; item jsonb; left_item jsonb; next_status text; correlation uuid:=gen_random_uuid();
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then raise exception 'invalid_token'; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id for update;
  select * into staff from public.staff_profiles where organisation_id=recipient.organisation_id and id=recipient.staff_id;
  if token_row.revoked_at is not null or recipient.status in ('revoked','cancelled') or period.status='cancelled' or staff.employment_status='deactivated' then raise exception 'token_revoked'; end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then raise exception 'token_expired'; end if;
  if jsonb_typeof(target_entry_inputs)<>'array' or jsonb_array_length(target_entry_inputs)>100 or (target_final and jsonb_array_length(target_entry_inputs)=0) then raise exception 'entries_required'; end if;
  for item in select * from jsonb_array_elements(target_entry_inputs) loop
    if (item->>'starts_at')::timestamptz<period.starts_at or (item->>'ends_at')::timestamptz>period.ends_at or (item->>'ends_at')::timestamptz<=(item->>'starts_at')::timestamptz or item->>'availability' not in ('available','preferred','preferably_not','unavailable') then raise exception 'invalid_entry'; end if;
    for left_item in select * from jsonb_array_elements(target_entry_inputs) loop if left_item<>item and (left_item->>'starts_at')::timestamptz<(item->>'ends_at')::timestamptz and (left_item->>'ends_at')::timestamptz>(item->>'starts_at')::timestamptz then raise exception 'overlapping_entries'; end if; end loop;
  end loop;
  delete from public.staff_availability where request_recipient_id=recipient.id;
  for item in select * from jsonb_array_elements(target_entry_inputs) loop
    insert into public.staff_availability(organisation_id,venue_id,staff_id,starts_at,ends_at,availability,note,source,created_by,request_recipient_id,submitted_at,provenance)
    values(recipient.organisation_id,recipient.venue_id,recipient.staff_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,item->>'availability',nullif(item->>'note',''),'availability_link',period.created_by,recipient.id,case when target_final then now() else null end,jsonb_build_object('source','employee_secure_link'));
  end loop;
  next_status=case when target_final then 'submitted' else 'partial' end;
  update public.availability_request_recipients set status=next_status,submitted_at=case when target_final then now() else submitted_at end,opened_at=coalesce(opened_at,now()) where id=recipient.id;
  update public.secure_response_tokens set consumed_at=case when target_final then now() else consumed_at end where id=token_row.id;
  update public.roster_proposals set status='stale' where organisation_id=recipient.organisation_id and venue_id=recipient.venue_id and status='current' and window_start<period.ends_at and window_end>period.starts_at;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,correlation_id,payload) values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,case when target_final then 'availability.submitted' else 'availability.partial_saved' end,correlation,jsonb_build_object('entry_count',jsonb_array_length(target_entry_inputs)));
  return jsonb_build_object('state',next_status,'saved_at',now());
end $$;

create or replace function public.inspect_availability_request_v2(target_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods; staff public.staff_profiles; result jsonb;
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then return jsonb_build_object('state','invalid'); end if;
  if token_row.access_window_started_at is null or token_row.access_window_started_at<now()-interval '15 minutes' then update public.secure_response_tokens set access_count=1,access_window_started_at=now() where id=token_row.id;
  elsif token_row.access_count>=60 then return jsonb_build_object('state','rate_limited');
  else update public.secure_response_tokens set access_count=access_count+1 where id=token_row.id; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id;
  select * into staff from public.staff_profiles where organisation_id=recipient.organisation_id and id=recipient.staff_id;
  if token_row.revoked_at is not null or recipient.status in ('revoked','cancelled') or period.status='cancelled' or staff.employment_status='deactivated' then return jsonb_build_object('state','revoked'); end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then update public.availability_request_recipients set status='expired' where id=recipient.id and status not in ('submitted','responded','revoked','cancelled');return jsonb_build_object('state','expired'); end if;
  if recipient.status in ('sent','delivered','provider_accepted','manually_shared','ready') then update public.availability_request_recipients set status='opened',opened_at=coalesce(opened_at,now()) where id=recipient.id; end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,correlation_id,payload) values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability.opened',gen_random_uuid(),'{}');
  select jsonb_build_object('state',r.status,'starts_at',p.starts_at,'ends_at',p.ends_at,'deadline_at',p.deadline_at,'venue_name',v.name,'preferred_language',staff.preferred_language,'employee_name',coalesce(staff.first_name,split_part(staff.full_name,' ',1)),'entries',coalesce((select jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'availability',a.availability,'note',a.note) order by a.starts_at) from public.staff_availability a where a.request_recipient_id=r.id),'[]'::jsonb)) into result
  from public.availability_request_recipients r join public.availability_request_periods p on p.id=r.request_id join public.venues v on v.id=r.venue_id and v.organisation_id=r.organisation_id where r.id=recipient.id;
  return result;
end $$;

create or replace function public.claim_open_shift(target_organisation_id uuid,target_offer_id uuid)
returns public.open_shift_offers language plpgsql security definer set search_path='' as $$
declare offer public.open_shift_offers; shift_row public.shifts; staff public.staff_profiles;
begin
  select * into offer from public.open_shift_offers where organisation_id=target_organisation_id and id=target_offer_id for update;
  if offer.id is null or offer.state not in ('offered','claiming') or offer.closes_at<=now() then raise exception 'offer_unavailable'; end if;
  select * into staff from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and employment_status='active';
  if staff.id is null then raise exception 'staff_profile_required'; end if;
  select * into shift_row from public.shifts where organisation_id=target_organisation_id and id=offer.shift_id for update;
  if exists(select 1 from public.shifts where organisation_id=target_organisation_id and staff_id=staff.id and id<>shift_row.id and status not in ('cancelled','rejected') and starts_at<shift_row.ends_at and ends_at>shift_row.starts_at) then raise exception 'double_booking'; end if;
  if exists(select 1 from public.staff_absences where organisation_id=target_organisation_id and staff_id=staff.id and status in ('approved','recorded') and starts_at<shift_row.ends_at and ends_at>shift_row.starts_at) then raise exception 'absence_conflict'; end if;
  insert into public.open_shift_claims(organisation_id,venue_id,offer_id,staff_id,status) values(target_organisation_id,offer.venue_id,offer.id,staff.id,'selected')
    on conflict(offer_id,staff_id) do update set status='selected',resolved_at=now();
  update public.open_shift_offers set state='assigned',assigned_staff_id=staff.id,resolved_by=auth.uid(),resolved_at=now() where id=offer.id returning * into offer;
  update public.shifts set staff_id=staff.id,revision=revision+1,updated_at=now() where id=shift_row.id;
  update public.open_shift_claims set status='declined',resolved_at=now() where offer_id=offer.id and staff_id<>staff.id and status='claimed';
  perform public.append_operational_event(target_organisation_id,offer.venue_id,'open_shift_offer',offer.id,'open_shift.assigned',jsonb_build_object('staff_id',staff.id),gen_random_uuid());
  return offer;
end $$;

create or replace function public.start_time_break(target_organisation_id uuid,target_time_record_id uuid)
returns public.time_breaks language plpgsql security definer set search_path='' as $$ declare result public.time_breaks; begin
  insert into public.time_breaks(organisation_id,venue_id,time_record_id,started_at)
  select t.organisation_id,t.venue_id,t.id,now() from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id
  where t.organisation_id=target_organisation_id and t.id=target_time_record_id and t.status='open' and s.auth_user_id=auth.uid() returning * into result;
  if result.id is null then raise exception 'invalid_time_record'; end if; return result;
end $$;

create or replace function public.request_staff_absence(target_organisation_id uuid,target_venue_id uuid,target_starts_at timestamptz,target_ends_at timestamptz,target_type text,target_note text default null)
returns public.staff_absences language plpgsql security definer set search_path='' as $$ declare staff public.staff_profiles; result public.staff_absences; begin
  select * into staff from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and employment_status='active';
  if staff.id is null or target_ends_at<=target_starts_at or target_type not in ('leave','sickness') or not exists(select 1 from public.staff_venue_assignments where organisation_id=target_organisation_id and staff_id=staff.id and venue_id=target_venue_id) then raise exception 'invalid_absence_request'; end if;
  insert into public.staff_absences(organisation_id,venue_id,staff_id,starts_at,ends_at,absence_type,status,note) values(target_organisation_id,target_venue_id,staff.id,target_starts_at,target_ends_at,target_type,case when target_type='sickness' then 'recorded' else 'requested' end,target_note) returning * into result;
  update public.roster_proposals set status='stale' where organisation_id=target_organisation_id and venue_id=target_venue_id and status='current' and window_start<target_ends_at and window_end>target_starts_at;
  perform public.append_operational_event(target_organisation_id,target_venue_id,'staff_absence',result.id,case when target_type='sickness' then 'sickness.reported' else 'leave.requested' end,jsonb_build_object('affected_shift_count',(select count(*) from public.shifts where organisation_id=target_organisation_id and staff_id=staff.id and status='published' and starts_at<target_ends_at and ends_at>target_starts_at)),gen_random_uuid());
  return result;
end $$;

create or replace function public.withdraw_staff_leave(target_organisation_id uuid,target_absence_id uuid)
returns public.staff_absences language plpgsql security definer set search_path='' as $$ declare result public.staff_absences; begin
  update public.staff_absences a set status='rejected',note=concat_ws(E'\n',a.note,'Withdrawn by employee') from public.staff_profiles s where a.organisation_id=target_organisation_id and a.id=target_absence_id and a.absence_type='leave' and a.status='requested' and s.organisation_id=a.organisation_id and s.id=a.staff_id and s.auth_user_id=auth.uid() returning a.* into result;
  if result.id is null then raise exception 'leave_not_withdrawable'; end if;
  perform public.append_operational_event(result.organisation_id,result.venue_id,'staff_absence',result.id,'leave.withdrawn','{}',gen_random_uuid());return result;
end $$;
create or replace function public.end_time_break(target_organisation_id uuid,target_time_record_id uuid)
returns public.time_breaks language plpgsql security definer set search_path='' as $$ declare result public.time_breaks; begin
  update public.time_breaks b set ended_at=now() from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id
  where b.organisation_id=target_organisation_id and b.time_record_id=target_time_record_id and b.ended_at is null and t.id=b.time_record_id and t.status='open' and s.auth_user_id=auth.uid() returning b.* into result;
  if result.id is null then raise exception 'open_break_required'; end if; return result;
end $$;

revoke all on function public.publish_roster_v2(uuid,uuid,timestamptz,timestamptz,integer,text,jsonb) from public,anon;
revoke all on function public.import_staff_profiles(uuid,uuid,jsonb,text) from public,anon;
revoke all on function public.apply_roster_proposal(uuid,uuid) from public,anon;
revoke all on function public.submit_availability_request_v2(text,jsonb,boolean) from public,authenticated;
revoke all on function public.inspect_availability_request_v2(text) from public,authenticated;
revoke all on function public.claim_open_shift(uuid,uuid) from public,anon;
revoke all on function public.start_time_break(uuid,uuid) from public,anon;
revoke all on function public.end_time_break(uuid,uuid) from public,anon;
revoke all on function public.request_staff_absence(uuid,uuid,timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.withdraw_staff_leave(uuid,uuid) from public,anon;
grant execute on function public.publish_roster_v2(uuid,uuid,timestamptz,timestamptz,integer,text,jsonb) to authenticated;
grant execute on function public.import_staff_profiles(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.apply_roster_proposal(uuid,uuid) to authenticated;
grant execute on function public.submit_availability_request_v2(text,jsonb,boolean) to anon;
grant execute on function public.inspect_availability_request_v2(text) to anon;
grant execute on function public.claim_open_shift(uuid,uuid) to authenticated;
grant execute on function public.start_time_break(uuid,uuid) to authenticated;
grant execute on function public.end_time_break(uuid,uuid) to authenticated;
grant execute on function public.request_staff_absence(uuid,uuid,timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.withdraw_staff_leave(uuid,uuid) to authenticated;
grant select,insert,update on public.staff_skills,public.staff_certifications,public.staff_cost_supplements,public.availability_message_attempts,public.staffing_requirement_versions,public.staffing_requirement_intervals,public.roster_proposals,public.approved_labour_results,public.workforce_import_receipts to authenticated;
grant all on all tables in schema public to service_role;

commit;
