begin;

insert into public.capability_permissions(capability,description) values
('workforce.manage','Manage workforce requests, offers and swaps'),
('time.approve','Approve submitted attendance')
on conflict(capability) do update set description=excluded.description;
insert into public.role_capabilities(role,capability)
select role,capability from (values
('owner'::public.member_role,'workforce.manage'),('administrator','workforce.manage'),
('manager','workforce.manage'),('venue_manager','workforce.manage'),
('owner','time.approve'),('administrator','time.approve'),('manager','time.approve'),
('venue_manager','time.approve'),('bookkeeper','time.approve'),('finance','time.approve')
) v(role,capability) on conflict do nothing;

create table public.operational_events(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid, aggregate_type text not null, aggregate_id uuid not null, event_type text not null,
 actor_id uuid references auth.users(id), correlation_id uuid not null default gen_random_uuid(), causation_id uuid,
 payload jsonb not null default '{}', occurred_at timestamptz not null default now(),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create index operational_events_aggregate_idx on public.operational_events(organisation_id,aggregate_type,aggregate_id,occurred_at);

create table public.availability_request_periods(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null, deadline_at timestamptz not null,
 status text not null check(status in ('draft','open','closed','cancelled')), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), check(ends_at>starts_at), check(deadline_at<=ends_at),
 unique(organisation_id,id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create table public.availability_request_recipients(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, request_id uuid not null, staff_id uuid not null,
 status text not null check(status in ('requested','opened','partial','submitted','expired','revoked')),
 opened_at timestamptz, submitted_at timestamptz, created_at timestamptz not null default now(),
 unique(organisation_id,id), unique(request_id,staff_id),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,request_id) references public.availability_request_periods(organisation_id,id) on delete cascade,
 foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);
create table public.secure_response_tokens(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 recipient_id uuid not null, token_hash text not null unique, purpose text not null check(purpose in ('availability','roster_acknowledgement','shift_change')),
 expires_at timestamptz not null, revoked_at timestamptz, consumed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(organisation_id,recipient_id) references public.availability_request_recipients(organisation_id,id) on delete cascade
);

create table public.roster_versions(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, window_start timestamptz not null, window_end timestamptz not null, version integer not null,
 status text not null check(status in ('draft','validated','published','superseded')),
 validation_summary jsonb not null default '{}', cost_minor bigint not null default 0 check(cost_minor>=0),
 approved_by uuid references auth.users(id), published_at timestamptz, supersedes_id uuid,
 created_at timestamptz not null default now(), unique(organisation_id,id), unique(organisation_id,venue_id,window_start,window_end,version),
 check(window_end>window_start), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,supersedes_id) references public.roster_versions(organisation_id,id)
);
create table public.roster_acknowledgements(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, roster_version_id uuid not null, staff_id uuid not null,
 status text not null check(status in ('pending','acknowledged','rejected')), responded_at timestamptz, reason text,
 unique(roster_version_id,staff_id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,roster_version_id) references public.roster_versions(organisation_id,id) on delete cascade,
 foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);

create table public.open_shift_offers(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, shift_id uuid not null, state text not null check(state in ('draft','offered','claiming','assigned','confirmed','withdrawn','expired','cancelled')),
 closes_at timestamptz, assigned_staff_id uuid, resolved_by uuid references auth.users(id), resolved_at timestamptz,
 created_at timestamptz not null default now(), unique(organisation_id,id), unique(shift_id),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,shift_id) references public.shifts(organisation_id,id),
 foreign key(organisation_id,assigned_staff_id) references public.staff_profiles(organisation_id,id)
);
create table public.open_shift_claims(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, offer_id uuid not null, staff_id uuid not null,
 status text not null check(status in ('claimed','withdrawn','selected','declined')), claimed_at timestamptz not null default now(), resolved_at timestamptz,
 unique(offer_id,staff_id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,offer_id) references public.open_shift_offers(organisation_id,id) on delete cascade,
 foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);
create table public.swap_requests(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, shift_id uuid not null, requester_staff_id uuid not null, candidate_staff_id uuid,
 state text not null check(state in ('requested','candidate_accepted','approved','rejected','cancelled')),
 reason text, manager_reason text, cost_effect_minor bigint, coverage_effect jsonb not null default '{}',
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now(),
 unique(organisation_id,id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
 foreign key(organisation_id,shift_id) references public.shifts(organisation_id,id),
 foreign key(organisation_id,requester_staff_id) references public.staff_profiles(organisation_id,id),
 foreign key(organisation_id,candidate_staff_id) references public.staff_profiles(organisation_id,id)
);

create table public.time_breaks(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, time_record_id uuid not null references public.time_records(id) on delete cascade,
 started_at timestamptz not null, ended_at timestamptz, created_at timestamptz not null default now(),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create unique index one_open_time_record_per_staff on public.time_records(organisation_id,staff_id) where clocked_out_at is null;
create unique index one_open_break_per_record on public.time_breaks(time_record_id) where ended_at is null;
create table public.time_corrections(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid not null, time_record_id uuid not null references public.time_records(id),
 requested_by uuid not null references auth.users(id), reason text not null, original_values jsonb not null, proposed_values jsonb not null,
 status text not null check(status in ('requested','approved','rejected')), reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.whatsapp_templates(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 template_key text not null, language text not null, version integer not null, provider_name text, provider_template_id text,
 status text not null check(status in ('draft','approved','disabled')), body text not null, unique(organisation_id,template_key,language,version)
);
create table public.notification_outbox(
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 venue_id uuid, channel text not null check(channel in ('whatsapp','copyable_message')),
 template_id uuid references public.whatsapp_templates(id), destination_e164 text, correlation_type text not null, correlation_id uuid not null,
 payload jsonb not null, state text not null check(state in ('pending','sending','sent','delivered','read','failed','opted_out','rate_limited')),
 provider_message_id text, failure_reason text, retry_count integer not null default 0, next_retry_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create table public.webhook_events(
 id uuid primary key default gen_random_uuid(), organisation_id uuid references public.organisations(id) on delete cascade,
 provider text not null, provider_event_id text not null, signature_valid boolean not null, payload_hash text not null,
 processed_at timestamptz, error text, received_at timestamptz not null default now(), unique(provider,provider_event_id)
);

do $$ declare n text; begin foreach n in array array[
'operational_events','availability_request_periods','availability_request_recipients','secure_response_tokens',
'roster_versions','roster_acknowledgements','open_shift_offers','open_shift_claims','swap_requests','time_breaks',
'time_corrections','whatsapp_templates','notification_outbox','webhook_events'] loop
execute format('alter table public.%I enable row level security',n); end loop; end $$;

create policy workforce_manager_events_read on public.operational_events for select using(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_requests on public.availability_request_periods for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_recipients on public.availability_request_recipients for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_tokens on public.secure_response_tokens for all using(public.has_capability(organisation_id,null,'workforce.manage')) with check(public.has_capability(organisation_id,null,'workforce.manage'));
create policy workforce_manager_rosters on public.roster_versions for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_ack on public.roster_acknowledgements for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_offers on public.open_shift_offers for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_claims on public.open_shift_claims for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy workforce_manager_swaps on public.swap_requests for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy time_break_owner on public.time_breaks for all using(exists(select 1 from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id where t.id=time_record_id and s.auth_user_id=auth.uid())) with check(exists(select 1 from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id where t.id=time_record_id and s.auth_user_id=auth.uid()));
create policy time_correction_owner_manager on public.time_corrections for all using(requested_by=auth.uid() or public.has_capability(organisation_id,venue_id,'time.approve')) with check(requested_by=auth.uid() or public.has_capability(organisation_id,venue_id,'time.approve'));
create policy notification_manager on public.notification_outbox for all using(public.has_capability(organisation_id,venue_id,'workforce.manage')) with check(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy templates_manager on public.whatsapp_templates for all using(public.has_capability(organisation_id,null,'workforce.manage')) with check(public.has_capability(organisation_id,null,'workforce.manage'));

create or replace function public.append_operational_event(target_organisation_id uuid,target_venue_id uuid,target_aggregate_type text,target_aggregate_id uuid,target_event_type text,target_payload jsonb default '{}',target_correlation_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$ declare event_id uuid; begin
if auth.uid() is null then raise exception 'unauthenticated'; end if;
insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,correlation_id,payload)
values(target_organisation_id,target_venue_id,target_aggregate_type,target_aggregate_id,target_event_type,auth.uid(),target_correlation_id,target_payload) returning id into event_id;
return event_id; end $$;
revoke all on function public.append_operational_event(uuid,uuid,text,uuid,text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.clock_in(target_organisation_id uuid,target_venue_id uuid,target_shift_id uuid default null)
returns public.time_records language plpgsql security definer set search_path='' as $$ declare staff public.staff_profiles; created public.time_records; shift_row public.shifts; begin
select * into staff from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and onboarding_status<>'archived' for update;
if staff.id is null then raise exception 'staff_profile_required'; end if;
if target_shift_id is not null then select * into shift_row from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_shift_id and staff_id=staff.id for update;
if shift_row.id is null then raise exception 'assigned_shift_required'; end if;
if now()<shift_row.starts_at-interval '2 hours' or now()>shift_row.ends_at+interval '4 hours' then raise exception 'outside_clock_window'; end if; end if;
insert into public.time_records(organisation_id,venue_id,shift_id,staff_id,clocked_in_at,status) values(target_organisation_id,target_venue_id,target_shift_id,staff.id,now(),'open') returning * into created;
perform public.append_operational_event(target_organisation_id,target_venue_id,'time_record',created.id,'clocked_in','{}',gen_random_uuid()); return created; end $$;

create or replace function public.clock_out(target_organisation_id uuid,target_time_record_id uuid)
returns public.time_records language plpgsql security definer set search_path='' as $$ declare record public.time_records; staff public.staff_profiles; break_total integer; begin
select * into record from public.time_records where organisation_id=target_organisation_id and id=target_time_record_id for update;
select * into staff from public.staff_profiles where organisation_id=target_organisation_id and id=record.staff_id and auth_user_id=auth.uid();
if staff.id is null or record.status<>'open' or record.clocked_out_at is not null then raise exception 'invalid_time_record_state'; end if;
if exists(select 1 from public.time_breaks where time_record_id=record.id and ended_at is null) then raise exception 'open_break'; end if;
select coalesce(sum(floor(extract(epoch from(ended_at-started_at))/60)),0)::integer into break_total from public.time_breaks where time_record_id=record.id;
if break_total>floor(extract(epoch from(now()-record.clocked_in_at))/60) then raise exception 'invalid_break_duration'; end if;
update public.time_records set clocked_out_at=now(),break_minutes=break_total,status='submitted',updated_at=now() where id=record.id returning * into record;
perform public.append_operational_event(record.organisation_id,record.venue_id,'time_record',record.id,'time_submitted','{}',gen_random_uuid()); return record; end $$;

create or replace function public.approve_time_record(target_organisation_id uuid,target_time_record_id uuid,target_correction_reason text default null)
returns public.time_records language plpgsql security definer set search_path='' as $$ declare record public.time_records; begin
select * into record from public.time_records where organisation_id=target_organisation_id and id=target_time_record_id for update;
if record.id is null or not public.has_capability(target_organisation_id,record.venue_id,'time.approve') then raise exception 'forbidden'; end if;
if record.status not in ('submitted','corrected') or record.clocked_out_at is null then raise exception 'invalid_time_record_state'; end if;
update public.time_records set status='approved',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=record.id returning * into record;
perform public.append_operational_event(record.organisation_id,record.venue_id,'time_record',record.id,'time_approved',jsonb_build_object('had_correction',target_correction_reason is not null),gen_random_uuid()); return record; end $$;

revoke all on function public.clock_in(uuid,uuid,uuid) from public,anon;
revoke all on function public.clock_out(uuid,uuid) from public,anon;
revoke all on function public.approve_time_record(uuid,uuid,text) from public,anon;
grant execute on function public.clock_in(uuid,uuid,uuid) to authenticated;
grant execute on function public.clock_out(uuid,uuid) to authenticated;
grant execute on function public.approve_time_record(uuid,uuid,text) to authenticated;
grant all on all tables in schema public to service_role;
commit;
