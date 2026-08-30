begin;

alter table public.open_shift_offers add column if not exists idempotency_key uuid;
create unique index if not exists open_shift_offer_idempotency_unique on public.open_shift_offers(organisation_id,idempotency_key) where idempotency_key is not null;

create or replace function public.create_open_shift_offer(target_organisation_id uuid,target_venue_id uuid,target_shift_id uuid,target_closes_at timestamptz,target_idempotency_key uuid)
returns public.open_shift_offers language plpgsql security definer set search_path='' as $$
declare result public.open_shift_offers; shift_row public.shifts;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden';end if;
  select * into result from public.open_shift_offers where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;if result.id is not null then return result;end if;
  select * into shift_row from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_shift_id and status='published' and starts_at>now() for update;
  if shift_row.id is null or target_closes_at<=now() or target_closes_at>=shift_row.starts_at then raise exception 'invalid_open_shift_offer';end if;
  insert into public.open_shift_offers(organisation_id,venue_id,shift_id,state,closes_at,idempotency_key) values(target_organisation_id,target_venue_id,target_shift_id,'offered',target_closes_at,target_idempotency_key) on conflict(shift_id) do update set state=case when public.open_shift_offers.state in('withdrawn','expired','cancelled') then 'offered' else public.open_shift_offers.state end,closes_at=excluded.closes_at,idempotency_key=excluded.idempotency_key returning * into result;
  perform public.append_operational_event(target_organisation_id,target_venue_id,'open_shift_offer',result.id,'open_shift.offered',jsonb_build_object('shift_id',target_shift_id,'closes_at',target_closes_at),gen_random_uuid());return result;
end $$;

create or replace function public.eligible_open_shift_offers(target_organisation_id uuid)
returns table(offer_id uuid,venue_id uuid,shift_id uuid,starts_at timestamptz,ends_at timestamptz,break_minutes integer,role_name text,closes_at timestamptz) language sql stable security definer set search_path='' as $$
  select offer.id,offer.venue_id,shift_row.id,shift_row.starts_at,shift_row.ends_at,shift_row.break_minutes,role.name,offer.closes_at
  from public.staff_profiles candidate join public.staff_venue_assignments assignment on assignment.organisation_id=candidate.organisation_id and assignment.staff_id=candidate.id
  join public.open_shift_offers offer on offer.organisation_id=candidate.organisation_id and offer.venue_id=assignment.venue_id and offer.state in('offered','claiming') and offer.closes_at>now()
  join public.shifts shift_row on shift_row.organisation_id=offer.organisation_id and shift_row.id=offer.shift_id and shift_row.status='published' and shift_row.starts_at>now()
  join public.operational_roles role on role.organisation_id=shift_row.organisation_id and role.id=shift_row.role_id
  where candidate.organisation_id=target_organisation_id and candidate.auth_user_id=auth.uid() and candidate.employment_status='active'
    and exists(select 1 from public.staff_role_qualifications q where q.organisation_id=target_organisation_id and q.staff_id=candidate.id and q.role_id=shift_row.role_id and(q.qualified_until is null or q.qualified_until>=shift_row.starts_at::date))
    and exists(select 1 from public.staff_availability a where a.organisation_id=target_organisation_id and a.venue_id=offer.venue_id and a.staff_id=candidate.id and a.availability in('available','preferred','preferably_not') and a.starts_at<=shift_row.starts_at and a.ends_at>=shift_row.ends_at)
    and not exists(select 1 from public.staff_absences a where a.organisation_id=target_organisation_id and a.staff_id=candidate.id and a.status in('approved','recorded') and a.starts_at<shift_row.ends_at and a.ends_at>shift_row.starts_at)
    and not exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.id<>shift_row.id and s.status not in('cancelled','rejected') and s.starts_at<shift_row.ends_at+interval '11 hours' and s.ends_at>shift_row.starts_at-interval '11 hours')
  order by shift_row.starts_at,offer.id;
$$;

create or replace function public.claim_open_shift_v2(target_organisation_id uuid,target_offer_id uuid,target_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare offer public.open_shift_offers; shift_row public.shifts; staff public.staff_profiles; latest public.roster_versions; successor public.roster_versions; snapshot jsonb; next_cost bigint; duration_minutes integer; existing_claim public.open_shift_claims;
begin
  select * into offer from public.open_shift_offers where organisation_id=target_organisation_id and id=target_offer_id for update;
  select * into staff from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid() and employment_status='active';
  if offer.id is null or staff.id is null then raise exception 'offer_unavailable';end if;
  select * into existing_claim from public.open_shift_claims where offer_id=offer.id and staff_id=staff.id;if existing_claim.status='selected' and offer.assigned_staff_id=staff.id then return jsonb_build_object('assigned',true,'replayed',true,'offer_id',offer.id);end if;
  if offer.state not in('offered','claiming') or offer.closes_at<=now() then raise exception 'offer_unavailable';end if;
  select * into shift_row from public.shifts where organisation_id=target_organisation_id and id=offer.shift_id and status='published' and starts_at>now() for update;
  if shift_row.id is null or not exists(select 1 from public.staff_venue_assignments where organisation_id=target_organisation_id and venue_id=offer.venue_id and staff_id=staff.id) then raise exception 'staff_not_at_venue';end if;
  if not exists(select 1 from public.staff_role_qualifications q where q.organisation_id=target_organisation_id and q.staff_id=staff.id and q.role_id=shift_row.role_id and(q.qualified_until is null or q.qualified_until>=shift_row.starts_at::date)) then raise exception 'staff_unqualified';end if;
  if not exists(select 1 from public.staff_availability a where a.organisation_id=target_organisation_id and a.venue_id=offer.venue_id and a.staff_id=staff.id and a.availability in('available','preferred','preferably_not') and a.starts_at<=shift_row.starts_at and a.ends_at>=shift_row.ends_at) then raise exception 'staff_unavailable';end if;
  if exists(select 1 from public.staff_absences a where a.organisation_id=target_organisation_id and a.staff_id=staff.id and a.status in('approved','recorded') and a.starts_at<shift_row.ends_at and a.ends_at>shift_row.starts_at) then raise exception 'absence_conflict';end if;
  if exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=staff.id and s.id<>shift_row.id and s.status not in('cancelled','rejected') and s.starts_at<shift_row.ends_at+interval '11 hours' and s.ends_at>shift_row.starts_at-interval '11 hours') then raise exception 'overlap_or_rest_conflict';end if;
  duration_minutes=greatest(0,floor(extract(epoch from(shift_row.ends_at-shift_row.starts_at))/60)::integer-shift_row.break_minutes);
  if staff.maximum_minutes_week is not null and staff.maximum_minutes_week<(select coalesce(sum(greatest(0,floor(extract(epoch from(s.ends_at-s.starts_at))/60)::integer-s.break_minutes)),0)+duration_minutes from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=staff.id and s.status not in('cancelled','rejected') and s.starts_at>=date_trunc('week',shift_row.starts_at) and s.starts_at<date_trunc('week',shift_row.starts_at)+interval '7 days') then raise exception 'maximum_hours_conflict';end if;
  insert into public.open_shift_claims(organisation_id,venue_id,offer_id,staff_id,status) values(target_organisation_id,offer.venue_id,offer.id,staff.id,'selected') on conflict(offer_id,staff_id) do update set status='selected',resolved_at=now();
  update public.open_shift_offers set state='assigned',assigned_staff_id=staff.id,resolved_by=auth.uid(),resolved_at=now() where id=offer.id;
  update public.shifts set staff_id=staff.id,hourly_cost_minor=coalesce(staff.effective_hourly_cost_minor,hourly_cost_minor),revision=revision+1,updated_at=now() where id=shift_row.id;
  select * into latest from public.roster_versions where organisation_id=target_organisation_id and id=shift_row.roster_version_id and status='published' for update;if latest.id is null then raise exception 'published_roster_missing';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'department_id',department_id,'role_id',role_id,'starts_at',starts_at,'ends_at',ends_at,'break_minutes',break_minutes,'hourly_cost_minor',hourly_cost_minor,'locked',locked) order by starts_at,id),'[]'),coalesce(sum((greatest(0,floor(extract(epoch from(ends_at-starts_at))/60)::integer-break_minutes)::bigint*hourly_cost_minor+30)/60),0) into snapshot,next_cost from public.shifts where organisation_id=target_organisation_id and venue_id=offer.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  update public.roster_versions set status='superseded' where id=latest.id;
  insert into public.roster_versions(organisation_id,venue_id,window_start,window_end,version,status,validation_summary,cost_minor,approved_by,published_at,supersedes_id,idempotency_key,source_revision,shift_snapshot,content_hash,acknowledged_exceptions) values(target_organisation_id,offer.venue_id,latest.window_start,latest.window_end,latest.version+1,'published',jsonb_build_object('source','open_shift_claim','offer_id',offer.id,'hard_constraints','passed'),next_cost,auth.uid(),now(),latest.id,'open-shift:'||offer.id||':'||target_idempotency_key,greatest(shift_row.revision+1,latest.source_revision),snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'[]') returning * into successor;
  update public.shifts set roster_version_id=successor.id where organisation_id=target_organisation_id and venue_id=offer.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  insert into public.roster_acknowledgements(organisation_id,venue_id,roster_version_id,staff_id,status) values(target_organisation_id,offer.venue_id,successor.id,staff.id,'pending') on conflict do nothing;
  update public.open_shift_claims set status='declined',resolved_at=now() where offer_id=offer.id and staff_id<>staff.id and status='claimed';
  perform public.append_operational_event(target_organisation_id,offer.venue_id,'open_shift_offer',offer.id,'open_shift.assigned',jsonb_build_object('staff_id',staff.id,'successor_roster_version_id',successor.id),gen_random_uuid());return jsonb_build_object('assigned',true,'replayed',false,'offer_id',offer.id,'successor_roster_version_id',successor.id);
end $$;

revoke all on function public.create_open_shift_offer(uuid,uuid,uuid,timestamptz,uuid) from public,anon;
revoke all on function public.eligible_open_shift_offers(uuid) from public,anon;
revoke all on function public.claim_open_shift_v2(uuid,uuid,uuid) from public,anon;
grant execute on function public.create_open_shift_offer(uuid,uuid,uuid,timestamptz,uuid) to authenticated;
grant execute on function public.eligible_open_shift_offers(uuid) to authenticated;
grant execute on function public.claim_open_shift_v2(uuid,uuid,uuid) to authenticated;
commit;
