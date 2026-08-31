begin;

create table public.shift_replacement_actions(
  id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id) on delete restrict,venue_id uuid not null,
  original_shift_id uuid not null,absence_id uuid,successor_roster_version_id uuid not null,segments jsonb not null,cost_effect_minor bigint not null,
  reason text not null check(length(trim(reason))>=5),idempotency_key uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),unique(organisation_id,id),foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,original_shift_id) references public.shifts(organisation_id,id),foreign key(organisation_id,absence_id) references public.staff_absences(organisation_id,id),
  foreign key(organisation_id,successor_roster_version_id) references public.roster_versions(organisation_id,id)
);
alter table public.shift_replacement_actions enable row level security;
create policy shift_replacement_manager_read on public.shift_replacement_actions for select using(public.has_capability(organisation_id,venue_id,'planning.manage'));
create trigger shift_replacement_actions_immutable before update or delete on public.shift_replacement_actions for each row execute function public.prevent_append_only_mutation();
grant select on public.shift_replacement_actions to authenticated;
grant all on public.shift_replacement_actions to service_role;

create or replace function public.replace_published_shift_segments(
  target_organisation_id uuid,target_shift_id uuid,target_absence_id uuid,target_expected_revision integer,target_segments jsonb,target_reason text,target_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.shifts; absence public.staff_absences; latest public.roster_versions; successor public.roster_versions; prior_action public.shift_replacement_actions;
  item jsonb; candidate public.staff_profiles; segment_start timestamptz; segment_end timestamptz; previous_end timestamptz; segment_break integer;
  segment_minutes integer; weekly_minutes integer; total_break integer:=0; segment_count integer:=0; next_cost bigint; snapshot jsonb; created_segments jsonb:='[]'; created_id uuid; cost_effect bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_shift_id::text,0));
  select * into prior_action from public.shift_replacement_actions where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if prior_action.id is not null then
    if not public.has_capability(target_organisation_id,prior_action.venue_id,'planning.manage') then raise exception 'forbidden'; end if;
    return jsonb_build_object('replayed',true,'replacement_action_id',prior_action.id,'successor_roster_version_id',prior_action.successor_roster_version_id,'segments',prior_action.segments,'cost_effect_minor',prior_action.cost_effect_minor);
  end if;
  if jsonb_typeof(target_segments)<>'array' or jsonb_array_length(target_segments)<1 or jsonb_array_length(target_segments)>4 or length(trim(target_reason))<5 then raise exception 'invalid_replacement_input'; end if;
  select * into original from public.shifts where organisation_id=target_organisation_id and id=target_shift_id and status='published' and starts_at>now() for update;
  if original.id is null or original.revision<>target_expected_revision or not public.has_capability(target_organisation_id,original.venue_id,'planning.manage') then raise exception 'stale_or_forbidden_shift'; end if;
  if target_absence_id is not null then
    select * into absence from public.staff_absences where organisation_id=target_organisation_id and venue_id=original.venue_id and id=target_absence_id and staff_id=original.staff_id and status in('approved','recorded') and starts_at<original.ends_at and ends_at>original.starts_at;
    if absence.id is null then raise exception 'active_absence_required'; end if;
  end if;
  select * into latest from public.roster_versions where organisation_id=target_organisation_id and venue_id=original.venue_id and id=original.roster_version_id and status='published' for update;
  if latest.id is null then raise exception 'published_roster_missing'; end if;
  previous_end=original.starts_at;
  for item in select value from jsonb_array_elements(target_segments) with ordinality ordered(value,position) order by position loop
    segment_count=segment_count+1;segment_start=(item->>'starts_at')::timestamptz;segment_end=(item->>'ends_at')::timestamptz;segment_break=(item->>'break_minutes')::integer;
    if segment_start<>previous_end or segment_end<=segment_start or segment_start<original.starts_at or segment_end>original.ends_at or segment_break<0 then raise exception 'replacement_segments_must_be_contiguous'; end if;
    select * into candidate from public.staff_profiles where organisation_id=target_organisation_id and id=(item->>'staff_id')::uuid and employment_status='active';
    if candidate.id is null or not exists(select 1 from public.staff_venue_assignments where organisation_id=target_organisation_id and venue_id=original.venue_id and staff_id=candidate.id) then raise exception 'candidate_not_at_venue'; end if;
    if not exists(select 1 from public.staff_role_qualifications q where q.organisation_id=target_organisation_id and q.staff_id=candidate.id and q.role_id=original.role_id and(q.qualified_until is null or q.qualified_until>=segment_start::date)) then raise exception 'candidate_unqualified'; end if;
    if not exists(select 1 from public.staff_availability a where a.organisation_id=target_organisation_id and a.venue_id=original.venue_id and a.staff_id=candidate.id and a.availability in('available','preferred','preferably_not') and a.starts_at<=segment_start and a.ends_at>=segment_end) then raise exception 'candidate_unavailable'; end if;
    if exists(select 1 from public.staff_absences a where a.organisation_id=target_organisation_id and a.staff_id=candidate.id and a.status in('approved','recorded') and a.starts_at<segment_end and a.ends_at>segment_start) then raise exception 'candidate_absent'; end if;
    if exists(select 1 from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.id<>original.id and s.status not in('cancelled','rejected') and s.starts_at<segment_end+interval '11 hours' and s.ends_at>segment_start-interval '11 hours') then raise exception 'candidate_overlap_or_rest'; end if;
    segment_minutes=greatest(0,floor(extract(epoch from(segment_end-segment_start))/60)::integer-segment_break);
    if segment_break>floor(extract(epoch from(segment_end-segment_start))/60)::integer then raise exception 'invalid_segment_break'; end if;
    select coalesce(sum(greatest(0,floor(extract(epoch from(s.ends_at-s.starts_at))/60)::integer-s.break_minutes)),0) into weekly_minutes from public.shifts s where s.organisation_id=target_organisation_id and s.staff_id=candidate.id and s.id<>original.id and s.status not in('cancelled','rejected') and s.starts_at>=date_trunc('week',segment_start) and s.starts_at<date_trunc('week',segment_start)+interval '7 days';
    if candidate.maximum_minutes_week is not null and weekly_minutes+segment_minutes>candidate.maximum_minutes_week then raise exception 'candidate_maximum_hours'; end if;
    total_break=total_break+segment_break;previous_end=segment_end;
  end loop;
  if previous_end<>original.ends_at or total_break<>original.break_minutes then raise exception 'replacement_must_preserve_shift_and_breaks'; end if;

  update public.shifts set status='cancelled',revision=revision+1,updated_at=now() where id=original.id;
  for item in select value from jsonb_array_elements(target_segments) with ordinality ordered(value,position) order by position loop
    insert into public.shifts(organisation_id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source,locked,revision,created_by)
      values(target_organisation_id,original.venue_id,original.department_id,original.role_id,(item->>'staff_id')::uuid,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,(item->>'break_minutes')::integer,coalesce((select effective_hourly_cost_minor from public.staff_profiles where organisation_id=target_organisation_id and id=(item->>'staff_id')::uuid),original.hourly_cost_minor),'published','manager',original.locked,1,auth.uid()) returning id into created_id;
    created_segments=created_segments||jsonb_build_array(jsonb_build_object('shift_id',created_id,'staff_id',item->>'staff_id','starts_at',item->>'starts_at','ends_at',item->>'ends_at','break_minutes',(item->>'break_minutes')::integer));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'staff_id',staff_id,'department_id',department_id,'role_id',role_id,'starts_at',starts_at,'ends_at',ends_at,'break_minutes',break_minutes,'hourly_cost_minor',hourly_cost_minor,'locked',locked) order by starts_at,id),'[]'),coalesce(sum((greatest(0,floor(extract(epoch from(ends_at-starts_at))/60)::integer-break_minutes)::bigint*hourly_cost_minor+30)/60),0)
    into snapshot,next_cost from public.shifts where organisation_id=target_organisation_id and venue_id=original.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  update public.roster_versions set status='superseded' where id=latest.id;
  insert into public.roster_versions(organisation_id,venue_id,window_start,window_end,version,status,validation_summary,cost_minor,approved_by,published_at,supersedes_id,idempotency_key,source_revision,shift_snapshot,content_hash,acknowledged_exceptions)
    values(target_organisation_id,original.venue_id,latest.window_start,latest.window_end,latest.version+1,'published',jsonb_build_object('source','governed_replacement','original_shift_id',original.id,'absence_id',absence.id,'segment_count',segment_count,'hard_constraints','passed'),next_cost,auth.uid(),now(),latest.id,'replacement:'||target_idempotency_key,greatest(original.revision+1,latest.source_revision),snapshot,encode(extensions.digest(snapshot::text,'sha256'),'hex'),'[]') returning * into successor;
  update public.shifts set roster_version_id=successor.id where organisation_id=target_organisation_id and venue_id=original.venue_id and starts_at>=latest.window_start and starts_at<latest.window_end and status='published';
  cost_effect=next_cost-latest.cost_minor;
  insert into public.shift_replacement_actions(organisation_id,venue_id,original_shift_id,absence_id,successor_roster_version_id,segments,cost_effect_minor,reason,idempotency_key,created_by)
    values(target_organisation_id,original.venue_id,original.id,absence.id,successor.id,created_segments,cost_effect,target_reason,target_idempotency_key,auth.uid()) returning * into prior_action;
  insert into public.roster_acknowledgements(organisation_id,venue_id,roster_version_id,staff_id,status)
    select target_organisation_id,original.venue_id,successor.id,staff_id,'pending' from(select original.staff_id staff_id union select (value->>'staff_id')::uuid from jsonb_array_elements(target_segments)) affected where staff_id is not null on conflict do nothing;
  insert into public.notification_outbox(organisation_id,venue_id,channel,destination_e164,correlation_type,correlation_id,payload,state)
    select target_organisation_id,original.venue_id,'copyable_message',s.contact_phone,'roster_replacement',prior_action.id,jsonb_build_object('staff_id',s.id,'successor_roster_version_id',successor.id,'manual_delivery_required',true),'pending' from public.staff_profiles s where s.organisation_id=target_organisation_id and s.id in(select staff_id from(select original.staff_id staff_id union select (value->>'staff_id')::uuid from jsonb_array_elements(target_segments)) affected);
  perform public.append_operational_event(target_organisation_id,original.venue_id,'shift_replacement_action',prior_action.id,'shift.replacement_published',jsonb_build_object('original_shift_id',original.id,'absence_id',absence.id,'successor_roster_version_id',successor.id,'cost_effect_minor',cost_effect,'segments',created_segments),gen_random_uuid());
  return jsonb_build_object('replayed',false,'replacement_action_id',prior_action.id,'successor_roster_version_id',successor.id,'segments',created_segments,'cost_effect_minor',cost_effect);
end $$;

revoke all on function public.replace_published_shift_segments(uuid,uuid,uuid,integer,jsonb,text,uuid) from public,anon;
grant execute on function public.replace_published_shift_segments(uuid,uuid,uuid,integer,jsonb,text,uuid) to authenticated;

commit;
