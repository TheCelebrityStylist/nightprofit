begin;

alter table public.swap_requests add column if not exists successor_roster_version_id uuid;
alter table public.swap_requests add column if not exists idempotency_key uuid;
create unique index if not exists swap_requests_idempotency_unique on public.swap_requests(organisation_id,idempotency_key) where idempotency_key is not null;

create policy swap_employee_read on public.swap_requests for select using(exists(select 1 from public.staff_profiles s where s.organisation_id=swap_requests.organisation_id and s.auth_user_id=auth.uid() and s.id in(swap_requests.requester_staff_id,swap_requests.candidate_staff_id)));

create or replace function public.request_shift_swap(target_organisation_id uuid,target_shift_id uuid,target_candidate_staff_id uuid,target_reason text,target_idempotency_key uuid)
returns public.swap_requests language plpgsql security definer set search_path='' as $$
declare requester public.staff_profiles; candidate public.staff_profiles; shift_row public.shifts; result public.swap_requests;
begin
  select * into result from public.swap_requests where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if result.id is not null then return result;end if;
  select * into requester from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and employment_status='active';
  select * into shift_row from public.shifts where organisation_id=target_organisation_id and id=target_shift_id and staff_id=requester.id and status='published' and starts_at>now() for update;
  select * into candidate from public.staff_profiles where organisation_id=target_organisation_id and id=target_candidate_staff_id and employment_status='active';
  if requester.id is null or shift_row.id is null or candidate.id is null or candidate.id=requester.id then raise exception 'invalid_swap_request';end if;
  if not exists(select 1 from public.staff_venue_assignments where organisation_id=target_organisation_id and venue_id=shift_row.venue_id and staff_id=candidate.id) then raise exception 'candidate_not_at_venue';end if;
  insert into public.swap_requests(organisation_id,venue_id,shift_id,requester_staff_id,candidate_staff_id,state,reason,idempotency_key)
  values(target_organisation_id,shift_row.venue_id,shift_row.id,requester.id,candidate.id,'requested',nullif(trim(target_reason),''),target_idempotency_key) returning * into result;
  perform public.append_operational_event(target_organisation_id,shift_row.venue_id,'swap_request',result.id,'swap.requested',jsonb_build_object('shift_id',shift_row.id,'candidate_staff_id',candidate.id),gen_random_uuid());return result;
end $$;

create or replace function public.respond_shift_swap(target_organisation_id uuid,target_swap_id uuid,target_accept boolean)
returns public.swap_requests language plpgsql security definer set search_path='' as $$
declare candidate public.staff_profiles; result public.swap_requests;
begin
  select * into result from public.swap_requests where organisation_id=target_organisation_id and id=target_swap_id for update;
  select * into candidate from public.staff_profiles where organisation_id=target_organisation_id and id=result.candidate_staff_id and auth_user_id=auth.uid() and employment_status='active';
  if result.id is null or candidate.id is null or result.state<>'requested' then raise exception 'invalid_swap_response';end if;
  update public.swap_requests set state=case when target_accept then 'candidate_accepted' else 'rejected' end,manager_reason=case when target_accept then manager_reason else 'Declined by candidate' end where id=result.id returning * into result;
  perform public.append_operational_event(target_organisation_id,result.venue_id,'swap_request',result.id,case when target_accept then 'swap.candidate_accepted' else 'swap.candidate_declined' end,'{}',gen_random_uuid());return result;
end $$;

create or replace function public.decide_shift_swap(target_organisation_id uuid,target_swap_id uuid,target_approve boolean,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare swap_row public.swap_requests; shift_row public.shifts; candidate public.staff_profiles; latest public.roster_versions; successor public.roster_versions; snapshot jsonb; next_cost bigint; duration_minutes integer; cost_effect bigint;
begin
  select * into swap_row from public.swap_requests where organisation_id=target_organisation_id and id=target_swap_id for update;
  if swap_row.id is null or not public.has_capability(target_organisation_id,swap_row.venue_id,'planning.manage') or swap_row.state not in ('requested','candidate_accepted') then raise exception 'invalid_swap_decision';end if;
  if not target_approve then update public.swap_requests set state='rejected',manager_reason=target_reason,reviewed_by=auth.uid(),reviewed_at=now() where id=swap_row.id;perform public.append_operational_event(target_organisation_id,swap_row.venue_id,'swap_request',swap_row.id,'swap.rejected',jsonb_build_object('reason',target_reason),gen_random_uuid());return jsonb_build_object('state','rejected');end if;
  if swap_row.state<>'candidate_accepted' then raise exception 'candidate_consent_required';end if;
  select * into shift_row from public.shifts where organisation_id=target_organisation_id and id=swap_row.shift_id and staff_id=swap_row.requester_staff_id and status='published' and starts_at>now() for update;
  select * into candidate from public.staff_profiles where organisation_id=target_organisation_id and id=swap_row.candidate_staff_id and employment_status='active';
  if shift_row.id is null or candidate.id is null then raise exception 'swap_stale';end if;
  if not exists(select 1 from public.staff_role_qualifications q where q.organisation_id=target_organisation_id and q.staff_id=candidate.id and q.role_id=shift_row.role_id and(q.qualified_until is null or q.qualified_until>=shift_row.starts_at::date)) then raise exception 'candidate_unqualified';end if;
  if not exists(select 1 from public.staff_availability a where a.organisation_id=target_organisation_id and a.venue_id=shift_row.venue_id and a.staff_id=candidate.id and a.availability in('available','preferred','preferably_not') and a.starts_at<=shift_row.starts_at and a.ends_at>=shift_row.ends_at) then raise exception 'candidate_unavailable';end if;
  if exists(select 1 from public.staff_absences a where a.organisation_id=target_organisation_id and a.staff_id=candidate.id and a.status in('approved','recorded') and a.starts_at<shift_row.ends_at and a.ends_at>shift_row.starts_at) then raise exception 'candidate_absent';end if;
  if exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.id<>shift_row.id and s.status not in('cancelled','rejected') and(s.starts_at<shift_row.ends_at+interval '11 hours' and s.ends_at>shift_row.starts_at-interval '11 hours')) then raise exception 'candidate_overlap_or_rest';end if;
  duration_minutes=greatest(0,floor(extract(epoch from(shift_row.ends_at-shift_row.starts_at))/60)::integer-shift_row.break_minutes);
  if candidate.maximum_minutes_week is not null and candidate.maximum_minutes_week<(select coalesce(sum(greatest(0,floor(extract(epoch from(s.ends_at-s.starts_at))/60)::integer-s.break_minutes)),0)+duration_minutes from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.status not in('cancelled','rejected') and s.starts_at>=date_trunc('week',shift_row.starts_at) and s.starts_at<date_trunc('week',shift_row.starts_at)+interval '7 days') then raise exception 'candidate_maximum_hours';end if;
  select * into latest from public.roster_versions where organisation_id=target_organisation_id and venue_id=shift_row.venue_id and id=shift_row.roster_version_id and status='published' for update;
  if latest.id is null then raise exception 'published_roster_missing';end if;
  cost_effect=((coalesce(candidate.effective_hourly_cost_minor,shift_row.hourly_cost_minor)-shift_row.hourly_cost_minor)*duration_minutes+30)/60;
  update public.shifts set staff_id=candidate.id,hourly_cost_minor=coalesce(candidate.effective_hourly_cost_minor,hourly_cost_minor),revision=revision+1,updated_at=now() where id=shift_row.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'department_id',department_id,'role_id',role_id,'starts_at',starts_at,'ends_at',ends_at,'break_minutes',break_minutes,'hourly_cost_minor',hourly_cost_minor,'locked',locked) order by starts_at,id),'[]'),coalesce(sum((greatest(0,floor(extract(epoch from(ends_at-starts_at))/60)::integer-break_minutes)::bigint*hourly_cost_minor+30)/60),0) into snapshot,next_cost from public.shifts where organisation_id=target_organisation_id and venue_id=shift_row.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  update public.roster_versions set status='superseded' where id=latest.id;
  insert into public.roster_versions(organisation_id,venue_id,window_start,window_end,version,status,validation_summary,cost_minor,approved_by,published_at,supersedes_id,idempotency_key,source_revision,shift_snapshot,content_hash,acknowledged_exceptions)
  values(target_organisation_id,shift_row.venue_id,latest.window_start,latest.window_end,latest.version+1,'published',jsonb_build_object('source','approved_swap','swap_id',swap_row.id,'hard_constraints','passed'),next_cost,auth.uid(),now(),latest.id,'swap:'||swap_row.id,greatest(shift_row.revision+1,latest.source_revision),snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'[]') returning * into successor;
  update public.shifts set roster_version_id=successor.id where organisation_id=target_organisation_id and venue_id=shift_row.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  update public.swap_requests set state='approved',manager_reason=target_reason,cost_effect_minor=cost_effect,coverage_effect=jsonb_build_object('preserved',true),reviewed_by=auth.uid(),reviewed_at=now(),successor_roster_version_id=successor.id where id=swap_row.id;
  insert into public.roster_acknowledgements(organisation_id,venue_id,roster_version_id,staff_id,status) values(target_organisation_id,shift_row.venue_id,successor.id,swap_row.requester_staff_id,'pending'),(target_organisation_id,shift_row.venue_id,successor.id,candidate.id,'pending') on conflict do nothing;
  perform public.append_operational_event(target_organisation_id,shift_row.venue_id,'swap_request',swap_row.id,'swap.approved',jsonb_build_object('successor_roster_version_id',successor.id,'cost_effect_minor',cost_effect),gen_random_uuid());return jsonb_build_object('state','approved','successor_roster_version_id',successor.id,'cost_effect_minor',cost_effect);
end $$;

create or replace function public.eligible_swap_candidates(target_organisation_id uuid,target_shift_id uuid)
returns table(staff_id uuid,full_name text) language sql stable security definer set search_path='' as $$
  select candidate.id,candidate.full_name from public.shifts shift_row join public.staff_profiles requester on requester.organisation_id=shift_row.organisation_id and requester.id=shift_row.staff_id and requester.auth_user_id=auth.uid()
  join public.staff_venue_assignments assignment on assignment.organisation_id=shift_row.organisation_id and assignment.venue_id=shift_row.venue_id
  join public.staff_profiles candidate on candidate.organisation_id=assignment.organisation_id and candidate.id=assignment.staff_id and candidate.id<>requester.id and candidate.employment_status='active'
  where shift_row.organisation_id=target_organisation_id and shift_row.id=target_shift_id and shift_row.status='published' and shift_row.starts_at>now()
    and exists(select 1 from public.staff_role_qualifications q where q.organisation_id=target_organisation_id and q.staff_id=candidate.id and q.role_id=shift_row.role_id and(q.qualified_until is null or q.qualified_until>=shift_row.starts_at::date))
    and exists(select 1 from public.staff_availability a where a.organisation_id=target_organisation_id and a.venue_id=shift_row.venue_id and a.staff_id=candidate.id and a.availability in('available','preferred','preferably_not') and a.starts_at<=shift_row.starts_at and a.ends_at>=shift_row.ends_at)
    and not exists(select 1 from public.staff_absences a where a.organisation_id=target_organisation_id and a.staff_id=candidate.id and a.status in('approved','recorded') and a.starts_at<shift_row.ends_at and a.ends_at>shift_row.starts_at)
    and not exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.id<>shift_row.id and s.status not in('cancelled','rejected') and s.starts_at<shift_row.ends_at+interval '11 hours' and s.ends_at>shift_row.starts_at-interval '11 hours')
  order by candidate.full_name,candidate.id;
$$;

revoke all on function public.request_shift_swap(uuid,uuid,uuid,text,uuid) from public,anon;
revoke all on function public.respond_shift_swap(uuid,uuid,boolean) from public,anon;
revoke all on function public.decide_shift_swap(uuid,uuid,boolean,text) from public,anon;
revoke all on function public.eligible_swap_candidates(uuid,uuid) from public,anon;
grant execute on function public.request_shift_swap(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.respond_shift_swap(uuid,uuid,boolean) to authenticated;
grant execute on function public.decide_shift_swap(uuid,uuid,boolean,text) to authenticated;
grant execute on function public.eligible_swap_candidates(uuid,uuid) to authenticated;
commit;
