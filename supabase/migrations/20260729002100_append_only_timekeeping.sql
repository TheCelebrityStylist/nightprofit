begin;

create table public.time_clock_events(
  id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id) on delete cascade,venue_id uuid not null,
  time_record_id uuid not null references public.time_records(id),staff_id uuid not null,event_type text not null check(event_type in('clock_in','break_start','break_end','clock_out','missed_event_recorded')),
  occurred_at timestamptz not null default now(),idempotency_key uuid not null,evidence jsonb not null default '{}',created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),unique(organisation_id,id),foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id)
);
alter table public.time_clock_events enable row level security;
create policy time_clock_events_self_read on public.time_clock_events for select using(exists(select 1 from public.staff_profiles s where s.organisation_id=time_clock_events.organisation_id and s.id=time_clock_events.staff_id and s.auth_user_id=auth.uid()));
create policy time_clock_events_manager_read on public.time_clock_events for select using(public.has_capability(organisation_id,venue_id,'time.approve'));
grant select on public.time_clock_events to authenticated;grant all on public.time_clock_events to service_role;
create or replace function public.prevent_time_clock_event_mutation() returns trigger language plpgsql set search_path='' as $$begin raise exception 'immutable_time_clock_event';end$$;
create trigger time_clock_events_immutable before update or delete on public.time_clock_events for each row execute function public.prevent_time_clock_event_mutation();

create or replace function public.clock_in_v2(target_organisation_id uuid,target_venue_id uuid,target_shift_id uuid,target_idempotency_key uuid)
returns public.time_records language plpgsql security definer set search_path='' as $$
declare staff public.staff_profiles; shift_row public.shifts; result public.time_records; prior public.time_clock_events;
begin
  select * into prior from public.time_clock_events where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if prior.id is not null then select * into result from public.time_records where id=prior.time_record_id;return result;end if;
  select * into staff from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and employment_status='active';if staff.id is null then raise exception 'staff_profile_required';end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||staff.id::text,0));
  if exists(select 1 from public.time_records where organisation_id=target_organisation_id and staff_id=staff.id and clocked_out_at is null) then raise exception 'already_clocked_in';end if;
  if target_shift_id is not null then select * into shift_row from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_shift_id and staff_id=staff.id and status='published';if shift_row.id is null or now()<shift_row.starts_at-interval '2 hours' or now()>shift_row.ends_at+interval '4 hours' then raise exception 'outside_clock_window';end if;end if;
  insert into public.time_records(organisation_id,venue_id,shift_id,staff_id,clocked_in_at,status) values(target_organisation_id,target_venue_id,target_shift_id,staff.id,now(),'open') returning * into result;
  insert into public.time_clock_events(organisation_id,venue_id,time_record_id,staff_id,event_type,idempotency_key,evidence,created_by) values(target_organisation_id,target_venue_id,result.id,staff.id,'clock_in',target_idempotency_key,jsonb_build_object('shift_id',target_shift_id),auth.uid());
  perform public.append_operational_event(target_organisation_id,target_venue_id,'time_record',result.id,'clocked_in','{}',gen_random_uuid());return result;
end$$;

create or replace function public.start_time_break_v2(target_organisation_id uuid,target_time_record_id uuid,target_idempotency_key uuid)
returns public.time_breaks language plpgsql security definer set search_path='' as $$declare result public.time_breaks;record public.time_records;staff public.staff_profiles;prior public.time_clock_events;begin
  select * into prior from public.time_clock_events where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if prior.id is not null then select * into result from public.time_breaks where time_record_id=prior.time_record_id and started_at=prior.occurred_at;return result;end if;
  select t.* into record from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id where t.organisation_id=target_organisation_id and t.id=target_time_record_id and t.status='open' and t.clocked_out_at is null and s.auth_user_id=auth.uid() for update;if record.id is null then raise exception 'invalid_time_record';end if;
  insert into public.time_breaks(organisation_id,venue_id,time_record_id,started_at) values(record.organisation_id,record.venue_id,record.id,now()) returning * into result;
  insert into public.time_clock_events(organisation_id,venue_id,time_record_id,staff_id,event_type,occurred_at,idempotency_key,created_by) values(record.organisation_id,record.venue_id,record.id,record.staff_id,'break_start',result.started_at,target_idempotency_key,auth.uid());return result;
end$$;

create or replace function public.end_time_break_v2(target_organisation_id uuid,target_time_record_id uuid,target_idempotency_key uuid)
returns public.time_breaks language plpgsql security definer set search_path='' as $$declare result public.time_breaks;record public.time_records;prior public.time_clock_events;begin
  select * into prior from public.time_clock_events where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if prior.id is not null then select * into result from public.time_breaks where time_record_id=prior.time_record_id and ended_at=prior.occurred_at;return result;end if;
  select t.* into record from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id where t.organisation_id=target_organisation_id and t.id=target_time_record_id and t.status='open' and s.auth_user_id=auth.uid() for update;if record.id is null then raise exception 'invalid_time_record';end if;
  update public.time_breaks set ended_at=now() where organisation_id=target_organisation_id and time_record_id=record.id and ended_at is null returning * into result;if result.id is null then raise exception 'no_open_break';end if;
  insert into public.time_clock_events(organisation_id,venue_id,time_record_id,staff_id,event_type,occurred_at,idempotency_key,created_by) values(record.organisation_id,record.venue_id,record.id,record.staff_id,'break_end',result.ended_at,target_idempotency_key,auth.uid());return result;
end$$;

create or replace function public.clock_out_v2(target_organisation_id uuid,target_time_record_id uuid,target_idempotency_key uuid)
returns public.time_records language plpgsql security definer set search_path='' as $$declare result public.time_records;staff public.staff_profiles;prior public.time_clock_events;break_total integer;begin
  select * into prior from public.time_clock_events where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if prior.id is not null then select * into result from public.time_records where id=prior.time_record_id;return result;end if;
  select t.* into result from public.time_records t join public.staff_profiles s on s.organisation_id=t.organisation_id and s.id=t.staff_id where t.organisation_id=target_organisation_id and t.id=target_time_record_id and t.status='open' and t.clocked_out_at is null and s.auth_user_id=auth.uid() for update;if result.id is null then raise exception 'invalid_time_record_state';end if;
  if exists(select 1 from public.time_breaks where time_record_id=result.id and ended_at is null) then raise exception 'open_break';end if;
  select coalesce(sum(floor(extract(epoch from(ended_at-started_at))/60)),0)::integer into break_total from public.time_breaks where time_record_id=result.id;if break_total>floor(extract(epoch from(now()-result.clocked_in_at))/60) then raise exception 'invalid_break_duration';end if;
  update public.time_records set clocked_out_at=now(),break_minutes=break_total,status='submitted',updated_at=now() where id=result.id returning * into result;
  insert into public.time_clock_events(organisation_id,venue_id,time_record_id,staff_id,event_type,occurred_at,idempotency_key,created_by) values(result.organisation_id,result.venue_id,result.id,result.staff_id,'clock_out',result.clocked_out_at,target_idempotency_key,auth.uid());perform public.append_operational_event(result.organisation_id,result.venue_id,'time_record',result.id,'time_submitted','{}',gen_random_uuid());return result;
end$$;

create or replace function public.decide_time_correction(target_organisation_id uuid,target_correction_id uuid,target_decision text,target_reason text)
returns public.time_corrections language plpgsql security definer set search_path='' as $$declare correction public.time_corrections;record public.time_records;begin
  select * into correction from public.time_corrections where organisation_id=target_organisation_id and id=target_correction_id for update;if correction.id is null or correction.status<>'requested' or not public.has_capability(target_organisation_id,correction.venue_id,'time.approve') then raise exception 'invalid_correction_decision';end if;
  if target_decision not in('approved','rejected') or length(trim(target_reason))<3 then raise exception 'decision_reason_required';end if;
  if target_decision='approved' then update public.time_records set clocked_in_at=(correction.proposed_values->>'clocked_in_at')::timestamptz,clocked_out_at=nullif(correction.proposed_values->>'clocked_out_at','')::timestamptz,break_minutes=(correction.proposed_values->>'break_minutes')::integer,status='corrected',updated_at=now() where organisation_id=target_organisation_id and id=correction.time_record_id returning * into record;if record.clocked_out_at is null or record.clocked_out_at<=record.clocked_in_at or record.break_minutes>floor(extract(epoch from(record.clocked_out_at-record.clocked_in_at))/60) then raise exception 'invalid_corrected_time';end if;end if;
  update public.time_corrections set status=target_decision,reviewed_by=auth.uid(),reviewed_at=now() where id=correction.id returning * into correction;
  perform public.append_operational_event(target_organisation_id,correction.venue_id,'time_correction',correction.id,'time_correction.'||target_decision,jsonb_build_object('reason',target_reason,'time_record_id',correction.time_record_id),gen_random_uuid());return correction;
end$$;

create or replace function public.record_missed_time_event(target_organisation_id uuid,target_venue_id uuid,target_staff_id uuid,target_shift_id uuid,target_clocked_in_at timestamptz,target_clocked_out_at timestamptz,target_break_minutes integer,target_reason text,target_idempotency_key uuid)
returns public.time_records language plpgsql security definer set search_path='' as $$declare result public.time_records;prior public.time_clock_events;begin
  if not public.has_capability(target_organisation_id,target_venue_id,'time.approve') then raise exception 'forbidden';end if;
  select * into prior from public.time_clock_events where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if prior.id is not null then select * into result from public.time_records where id=prior.time_record_id;return result;end if;
  if target_clocked_out_at<=target_clocked_in_at or target_break_minutes<0 or target_break_minutes>floor(extract(epoch from(target_clocked_out_at-target_clocked_in_at)/60)) or length(trim(target_reason))<5 then raise exception 'invalid_missed_event';end if;
  if not exists(select 1 from public.staff_profiles where organisation_id=target_organisation_id and id=target_staff_id and employment_status='active') or(target_shift_id is not null and not exists(select 1 from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_shift_id and staff_id=target_staff_id)) then raise exception 'invalid_staff_or_shift';end if;
  insert into public.time_records(organisation_id,venue_id,shift_id,staff_id,clocked_in_at,clocked_out_at,break_minutes,status,updated_at) values(target_organisation_id,target_venue_id,target_shift_id,target_staff_id,target_clocked_in_at,target_clocked_out_at,target_break_minutes,'corrected',now()) returning * into result;
  insert into public.time_clock_events(organisation_id,venue_id,time_record_id,staff_id,event_type,occurred_at,idempotency_key,evidence,created_by) values(target_organisation_id,target_venue_id,result.id,target_staff_id,'missed_event_recorded',now(),target_idempotency_key,jsonb_build_object('clocked_in_at',target_clocked_in_at,'clocked_out_at',target_clocked_out_at,'break_minutes',target_break_minutes,'reason',target_reason,'recorded_by_manager',true),auth.uid());
  perform public.append_operational_event(target_organisation_id,target_venue_id,'time_record',result.id,'time.missed_event_recorded',jsonb_build_object('reason',target_reason),gen_random_uuid());return result;
end$$;

revoke all on function public.clock_in_v2(uuid,uuid,uuid,uuid) from public,anon;revoke all on function public.start_time_break_v2(uuid,uuid,uuid) from public,anon;revoke all on function public.end_time_break_v2(uuid,uuid,uuid) from public,anon;revoke all on function public.clock_out_v2(uuid,uuid,uuid) from public,anon;revoke all on function public.decide_time_correction(uuid,uuid,text,text) from public,anon;revoke all on function public.record_missed_time_event(uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer,text,uuid) from public,anon;
grant execute on function public.clock_in_v2(uuid,uuid,uuid,uuid) to authenticated;grant execute on function public.start_time_break_v2(uuid,uuid,uuid) to authenticated;grant execute on function public.end_time_break_v2(uuid,uuid,uuid) to authenticated;grant execute on function public.clock_out_v2(uuid,uuid,uuid) to authenticated;grant execute on function public.decide_time_correction(uuid,uuid,text,text) to authenticated;grant execute on function public.record_missed_time_event(uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer,text,uuid) to authenticated;
commit;
