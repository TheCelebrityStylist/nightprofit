-- Cliniq planning flow.
-- 1. The planner asks availability for specific nights; people can only answer those nights.
-- 2. Answers are stored per night (18:00 -> 05:00 local) on the request, whether given
--    through the WhatsApp link or in "Mijn rooster".
-- 3. The planner fills nights slot by slot; changing a published slot turns it back into
--    a draft until the next publish.
-- 4. Access is by invitation only.

alter table public.availability_request_periods add column if not exists requested_dates date[];

create or replace function public.create_availability_request_v4(
  target_organisation_id uuid, target_venue_id uuid, target_dates date[], target_deadline_at timestamptz,
  recipient_inputs jsonb, target_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare venue_tz text; clean date[]; result jsonb;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'workforce.manage') then raise exception 'forbidden'; end if;
  select array_agg(distinct d order by d) into clean from unnest(target_dates) d where d is not null;
  if clean is null or cardinality(clean)=0 or cardinality(clean)>31 then raise exception 'dates_required'; end if;
  if clean[1]<current_date-1 or clean[cardinality(clean)]>current_date+180 then raise exception 'date_out_of_range'; end if;
  select coalesce(nullif(timezone,''),'Europe/Amsterdam') into venue_tz from public.venues where organisation_id=target_organisation_id and id=target_venue_id;
  if venue_tz is null then raise exception 'venue_not_found'; end if;
  result=public.create_availability_request_v3(
    target_organisation_id,target_venue_id,
    (clean[1]+time '18:00') at time zone venue_tz,
    ((clean[cardinality(clean)]+1)+time '05:00') at time zone venue_tz,
    target_deadline_at,recipient_inputs,target_idempotency_key);
  update public.availability_request_periods set requested_dates=clean
    where organisation_id=target_organisation_id and id=(result->>'request_id')::uuid and requested_dates is null;
  return result;
end $$;

-- Shared by the WhatsApp link and "Mijn rooster": records this person's answers for the request, one per night.
create or replace function public.apply_availability_answers(
  target_recipient_id uuid, target_entries jsonb, target_source text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare recipient public.availability_request_recipients; period public.availability_request_periods;
  venue_tz text; item jsonb; night date; answered integer; total integer; next_status text;
begin
  if target_source not in ('availability_link','employee') then raise exception 'invalid_source'; end if;
  select * into recipient from public.availability_request_recipients where id=target_recipient_id for update;
  if recipient.id is null then raise exception 'invalid_recipient'; end if;
  select * into period from public.availability_request_periods where id=recipient.request_id for update;
  if period.status in ('cancelled','closed') or recipient.status in ('revoked','cancelled') then raise exception 'request_closed'; end if;
  if period.deadline_at<=now() then raise exception 'deadline_passed'; end if;
  if jsonb_typeof(target_entries)<>'array' or jsonb_array_length(target_entries)>62 then raise exception 'invalid_entries'; end if;
  select coalesce(nullif(timezone,''),'Europe/Amsterdam') into venue_tz from public.venues where organisation_id=recipient.organisation_id and id=recipient.venue_id;
  for item in select value from jsonb_array_elements(target_entries) loop
    night=(item->>'date')::date;
    if period.requested_dates is not null then
      if not (night=any(period.requested_dates)) then raise exception 'night_not_requested'; end if;
    elsif (night+time '18:00') at time zone venue_tz<period.starts_at or ((night+1)+time '05:00') at time zone venue_tz>period.ends_at then
      raise exception 'night_not_requested';
    end if;
    if coalesce(item->>'availability','') not in ('available','preferably_not','unavailable') then raise exception 'invalid_availability'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(target_entries) as e(value) group by e.value->>'date' having count(*)>1) then raise exception 'duplicate_night'; end if;

  -- One row per requested night: overwrite the earlier answer for that night, or add it.
  for item in select value from jsonb_array_elements(target_entries) loop
    night=(item->>'date')::date;
    update public.staff_availability
      set availability=item->>'availability',note=nullif(left(coalesce(item->>'note',''),300),''),source=target_source,
          submitted_at=now(),provenance=jsonb_build_object('source',target_source,'night',night)
      where request_recipient_id=recipient.id and starts_at=(night+time '18:00') at time zone venue_tz;
    if not found then
      insert into public.staff_availability(organisation_id,venue_id,staff_id,starts_at,ends_at,availability,note,source,created_by,request_recipient_id,submitted_at,provenance)
      values(recipient.organisation_id,recipient.venue_id,recipient.staff_id,
        (night+time '18:00') at time zone venue_tz,((night+1)+time '05:00') at time zone venue_tz,
        item->>'availability',nullif(left(coalesce(item->>'note',''),300),''),target_source,
        coalesce(auth.uid(),period.created_by),recipient.id,now(),jsonb_build_object('source',target_source,'night',night));
    end if;
  end loop;

  select count(*) into answered from public.staff_availability where request_recipient_id=recipient.id;
  total=coalesce(cardinality(period.requested_dates),answered);
  next_status=case when answered>0 and answered>=total then 'submitted' when answered>0 then 'partial' else 'opened' end;
  update public.availability_request_recipients
    set status=next_status,submitted_at=case when next_status='submitted' then now() else null end,opened_at=coalesce(opened_at,now())
    where id=recipient.id;
  update public.roster_proposals set status='stale'
    where organisation_id=recipient.organisation_id and venue_id=recipient.venue_id and status='current';
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability.answered',auth.uid(),
    jsonb_build_object('answered',answered,'total',total,'source',target_source));
  return jsonb_build_object('state',next_status,'answered',answered,'total',total);
end $$;
revoke all on function public.apply_availability_answers(uuid,jsonb,text) from public,anon,authenticated;

-- What the personal link shows: only the nights the planner asked for.
create or replace function public.inspect_availability_request_v3(target_token_hash text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients;
  period public.availability_request_periods; staff public.staff_profiles; venue public.venues; venue_tz text; nights date[];
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then return jsonb_build_object('state','invalid'); end if;
  if token_row.access_window_started_at is null or token_row.access_window_started_at<now()-interval '15 minutes' then
    update public.secure_response_tokens set access_count=1,access_window_started_at=now() where id=token_row.id;
  elsif token_row.access_count>=60 then return jsonb_build_object('state','rate_limited');
  else update public.secure_response_tokens set access_count=access_count+1 where id=token_row.id; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id;
  select * into staff from public.staff_profiles where organisation_id=recipient.organisation_id and id=recipient.staff_id;
  select * into venue from public.venues where organisation_id=recipient.organisation_id and id=recipient.venue_id;
  venue_tz=coalesce(nullif(venue.timezone,''),'Europe/Amsterdam');
  if token_row.revoked_at is not null or recipient.status in ('revoked','cancelled') or period.status='cancelled' or staff.employment_status='deactivated' then
    return jsonb_build_object('state','revoked');
  end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then
    update public.availability_request_recipients set status='expired' where id=recipient.id and status not in ('submitted','responded','revoked','cancelled');
    return jsonb_build_object('state','expired','employee_name',coalesce(staff.first_name,split_part(staff.full_name,' ',1)),'venue_name',venue.name);
  end if;
  if recipient.status in ('sent','delivered','read','provider_accepted','manually_shared','ready','missing_phone','invalid_phone') then
    update public.availability_request_recipients set status='opened',opened_at=coalesce(opened_at,now()) where id=recipient.id;
    perform public.append_operational_event(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability.opened','{}',gen_random_uuid());
    recipient.status='opened';
  end if;
  nights=coalesce(period.requested_dates,(
    select array_agg(d::date order by d) from generate_series((period.starts_at at time zone venue_tz)::date,((period.ends_at at time zone venue_tz)-interval '6 hours')::date,interval '1 day') d));
  return jsonb_build_object(
    'state',recipient.status,
    'deadline_at',period.deadline_at,
    'venue_name',venue.name,
    'venue_timezone',venue_tz,
    'preferred_language',staff.preferred_language,
    'employee_name',coalesce(staff.first_name,split_part(staff.full_name,' ',1)),
    'nights',to_jsonb(nights),
    'answers',coalesce((select jsonb_object_agg(((a.starts_at at time zone venue_tz)::date)::text,a.availability)
      from public.staff_availability a where a.request_recipient_id=recipient.id),'{}'::jsonb));
end $$;
revoke all on function public.inspect_availability_request_v3(text) from public,authenticated;
grant execute on function public.inspect_availability_request_v3(text) to anon;

create or replace function public.submit_availability_request_v3(target_token_hash text, target_entries jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; staff public.staff_profiles; result jsonb;
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then raise exception 'invalid_token'; end if;
  if token_row.revoked_at is not null then raise exception 'token_revoked'; end if;
  if token_row.expires_at<=now() then raise exception 'token_expired'; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id;
  select * into staff from public.staff_profiles where organisation_id=recipient.organisation_id and id=recipient.staff_id;
  if staff.employment_status='deactivated' then raise exception 'token_revoked'; end if;
  result=public.apply_availability_answers(recipient.id,target_entries,'availability_link');
  return result;
end $$;
revoke all on function public.submit_availability_request_v3(text,jsonb) from public,authenticated;
grant execute on function public.submit_availability_request_v3(text,jsonb) to anon;

-- Team member answers a request from inside the app.
create or replace function public.set_my_availability(
  target_organisation_id uuid, target_request_id uuid, target_entries jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare me public.staff_profiles; recipient_id uuid;
begin
  select * into me from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid();
  if me.id is null or me.employment_status='deactivated' then raise exception 'no_staff_profile'; end if;
  select id into recipient_id from public.availability_request_recipients
    where organisation_id=target_organisation_id and request_id=target_request_id and staff_id=me.id
    order by created_at desc limit 1;
  if recipient_id is null then raise exception 'not_requested'; end if;
  return public.apply_availability_answers(recipient_id,target_entries,'employee');
end $$;
revoke all on function public.set_my_availability(uuid,uuid,jsonb) from public,anon;
grant execute on function public.set_my_availability(uuid,uuid,jsonb) to authenticated;

-- Own roster plus the open requests this person still can answer.
create or replace function public.get_my_roster(
  target_organisation_id uuid, target_from timestamptz, target_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare me public.staff_profiles; result jsonb; open_requests jsonb;
begin
  select * into me from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid();
  if me.id is null then return jsonb_build_object('staff',null,'shifts','[]'::jsonb,'requests','[]'::jsonb); end if;
  if target_to<=target_from or target_to-target_from>interval '120 days' then raise exception 'invalid_window'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'venue_id',s.venue_id,'starts_at',s.starts_at,'ends_at',s.ends_at,'break_minutes',s.break_minutes,
      'status',s.status,'role_name',r.name,'department_kind',d.kind,
      'colleagues',coalesce((
        select jsonb_agg(jsonb_build_object('name',split_part(p.full_name,' ',1),'role_name',r2.name,'starts_at',o.starts_at,'ends_at',o.ends_at) order by o.starts_at,p.full_name)
        from public.shifts o
        join public.staff_profiles p on p.organisation_id=o.organisation_id and p.id=o.staff_id
        join public.operational_roles r2 on r2.organisation_id=o.organisation_id and r2.id=o.role_id
        where o.organisation_id=s.organisation_id and o.venue_id=s.venue_id and o.id<>s.id and o.staff_id is not null
          and o.status in ('published','accepted','completed') and o.starts_at<s.ends_at and o.ends_at>s.starts_at
      ),'[]'::jsonb)
    ) order by s.starts_at),'[]'::jsonb)
  into result
  from public.shifts s
  join public.operational_roles r on r.organisation_id=s.organisation_id and r.id=s.role_id
  join public.departments d on d.organisation_id=s.organisation_id and d.id=s.department_id
  where s.organisation_id=target_organisation_id and s.staff_id=me.id
    and s.status in ('published','accepted','completed') and s.starts_at>=target_from and s.starts_at<target_to;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'venue_id',p.venue_id,'nights',to_jsonb(p.requested_dates),'deadline_at',p.deadline_at,'status',rr.status,
      'answers',coalesce((select jsonb_object_agg(((a.starts_at at time zone coalesce(nullif(v.timezone,''),'Europe/Amsterdam'))::date)::text,a.availability)
        from public.staff_availability a where a.request_recipient_id=rr.id),'{}'::jsonb)
    ) order by p.deadline_at),'[]'::jsonb)
  into open_requests
  from public.availability_request_recipients rr
  join public.availability_request_periods p on p.id=rr.request_id
  join public.venues v on v.organisation_id=p.organisation_id and v.id=p.venue_id
  where rr.organisation_id=target_organisation_id and rr.staff_id=me.id
    and p.requested_dates is not null and p.status not in ('cancelled','closed') and p.deadline_at>now()
    and rr.status not in ('revoked','cancelled','expired');
  return jsonb_build_object('staff',jsonb_build_object('id',me.id,'full_name',me.full_name,'first_name',coalesce(me.first_name,split_part(me.full_name,' ',1))),'shifts',result,'requests',open_requests);
end $$;
revoke execute on function public.get_my_roster(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_my_roster(uuid,timestamptz,timestamptz) to authenticated;

-- Put people on slots (or clear them). changes = [{shift_id, staff_id|null}]
create or replace function public.plan_assign_shifts(
  target_organisation_id uuid, target_venue_id uuid, target_changes jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare item jsonb; current_shift public.shifts; new_staff uuid; changed integer:=0; touched uuid[]:='{}';
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if jsonb_typeof(target_changes)<>'array' or jsonb_array_length(target_changes) not between 1 and 300 then raise exception 'invalid_changes'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text,0));
  for item in select value from jsonb_array_elements(target_changes) loop
    select * into current_shift from public.shifts
      where organisation_id=target_organisation_id and venue_id=target_venue_id and id=(item->>'shift_id')::uuid for update;
    if current_shift.id is null then raise exception 'shift_not_found'; end if;
    if current_shift.status not in ('draft','published') then raise exception 'shift_not_editable'; end if;
    if current_shift.locked then raise exception 'shift_locked'; end if;
    new_staff=nullif(item->>'staff_id','')::uuid;
    if new_staff is not distinct from current_shift.staff_id then continue; end if;
    if new_staff is not null then
      if not exists(select 1 from public.staff_profiles s
          join public.staff_venue_assignments a on a.organisation_id=s.organisation_id and a.staff_id=s.id and a.venue_id=target_venue_id
          where s.organisation_id=target_organisation_id and s.id=new_staff and coalesce(s.employment_status,'active')<>'deactivated') then
        raise exception 'staff_not_in_team';
      end if;
      touched=touched||new_staff;
    end if;
    update public.shifts set staff_id=new_staff,status='draft',source='manager',revision=revision+1,updated_at=now()
      where id=current_shift.id;
    changed=changed+1;
  end loop;
  if exists(select 1 from public.shifts l
      join public.shifts r on r.organisation_id=l.organisation_id and r.staff_id=l.staff_id and r.id<>l.id
        and r.starts_at<l.ends_at and r.ends_at>l.starts_at and r.status not in ('cancelled','rejected')
      where l.organisation_id=target_organisation_id and l.staff_id=any(touched) and l.status not in ('cancelled','rejected')) then
    raise exception 'shift_overlap';
  end if;
  if changed>0 then
    insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
    values(target_organisation_id,target_venue_id,'roster',target_venue_id,'roster.slots_assigned',auth.uid(),jsonb_build_object('changed',changed));
  end if;
  return jsonb_build_object('changed',changed);
end $$;

-- One extra open slot on a night (same role/time as an existing line, or new times).
create or replace function public.plan_add_open_shift(
  target_organisation_id uuid, target_venue_id uuid, target_role_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare role_row public.operational_roles; new_id uuid;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_ends_at<=target_starts_at or target_ends_at-target_starts_at>interval '16 hours' then raise exception 'invalid_window'; end if;
  select r.* into role_row from public.operational_roles r join public.departments d on d.organisation_id=r.organisation_id and d.id=r.department_id
    where r.organisation_id=target_organisation_id and r.id=target_role_id and d.venue_id=target_venue_id;
  if role_row.id is null then raise exception 'invalid_role'; end if;
  insert into public.shifts(organisation_id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,source,locked,created_by)
  values(target_organisation_id,target_venue_id,role_row.department_id,role_row.id,null,target_starts_at,target_ends_at,0,role_row.hourly_cost_minor,'draft','manager',false,auth.uid())
  returning id into new_id;
  return new_id;
end $$;

-- Remove open (unassigned) slots. Assigned slots must be cleared first.
create or replace function public.plan_remove_open_shifts(
  target_organisation_id uuid, target_venue_id uuid, target_shift_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare removed integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_shift_ids is null or cardinality(target_shift_ids) not between 1 and 300 then raise exception 'invalid_shifts'; end if;
  update public.shifts set status='cancelled',revision=revision+1,updated_at=now()
    where organisation_id=target_organisation_id and venue_id=target_venue_id and id=any(target_shift_ids)
      and staff_id is null and status in ('draft','published') and not locked;
  get diagnostics removed=row_count;
  if removed<>cardinality(target_shift_ids) then raise exception 'shift_not_open'; end if;
  return jsonb_build_object('removed',removed);
end $$;

-- A fresh invitation link for someone who has no account yet. Older links stop working.
create or replace function public.reissue_staff_invitation(
  target_organisation_id uuid, target_staff_id uuid, target_token_hash text, target_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare staff public.staff_profiles; venue uuid; invitation_id uuid;
begin
  if not public.has_capability(target_organisation_id,null,'members.manage') then raise exception 'forbidden'; end if;
  select * into staff from public.staff_profiles where organisation_id=target_organisation_id and id=target_staff_id for update;
  if staff.id is null or staff.employment_status='deactivated' then raise exception 'staff_unavailable'; end if;
  if staff.auth_user_id is not null then raise exception 'already_active'; end if;
  if length(target_token_hash)<>64 or target_expires_at<=now() or target_expires_at>now()+interval '30 days' then raise exception 'invalid_invitation'; end if;
  select venue_id into venue from public.staff_venue_assignments where organisation_id=target_organisation_id and staff_id=staff.id order by venue_id limit 1;
  if venue is null then raise exception 'staff_unavailable'; end if;
  update public.staff_onboarding_invitations set revoked_at=now(),message_state='revoked',updated_at=now()
    where organisation_id=target_organisation_id and staff_id=staff.id and claimed_at is null and revoked_at is null;
  insert into public.staff_onboarding_invitations(organisation_id,venue_id,staff_id,token_hash,access_role,language,expires_at,created_by)
  values(target_organisation_id,venue,staff.id,target_token_hash,'employee',case when staff.preferred_language='en' then 'en' else 'nl' end,target_expires_at,auth.uid())
  returning id into invitation_id;
  update public.staff_profiles set invitation_state='pending',updated_at=now() where id=staff.id;
  return jsonb_build_object('invitation_id',invitation_id,'venue_id',venue);
end $$;

revoke all on function public.create_availability_request_v4(uuid,uuid,date[],timestamptz,jsonb,text) from public,anon;
revoke all on function public.plan_assign_shifts(uuid,uuid,jsonb) from public,anon;
revoke all on function public.plan_add_open_shift(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon;
revoke all on function public.plan_remove_open_shifts(uuid,uuid,uuid[]) from public,anon;
revoke all on function public.reissue_staff_invitation(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.create_availability_request_v4(uuid,uuid,date[],timestamptz,jsonb,text) to authenticated;
grant execute on function public.plan_assign_shifts(uuid,uuid,jsonb) to authenticated;
grant execute on function public.plan_add_open_shift(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.plan_remove_open_shifts(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.reissue_staff_invitation(uuid,uuid,text,timestamptz) to authenticated;

