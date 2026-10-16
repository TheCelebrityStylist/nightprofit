begin;

alter table public.availability_request_periods drop constraint if exists availability_request_periods_status_check;
alter table public.availability_request_periods add constraint availability_request_periods_status_check
check(status in ('draft','scheduled','sent','closed','cancelled'));
alter table public.availability_request_recipients drop constraint if exists availability_request_recipients_status_check;
alter table public.availability_request_recipients add constraint availability_request_recipients_status_check
check(status in ('draft','scheduled','sent','delivered','opened','partial','submitted','expired','revoked','failed'));
alter table public.staff_availability add column request_recipient_id uuid references public.availability_request_recipients(id) on delete set null;
alter table public.staff_availability add column submitted_at timestamptz;
create index availability_request_recipient_idx on public.staff_availability(request_recipient_id) where request_recipient_id is not null;

create or replace function public.create_availability_request(
  target_organisation_id uuid,target_venue_id uuid,target_starts_at timestamptz,target_ends_at timestamptz,
  target_deadline_at timestamptz,recipient_inputs jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare request_id uuid; item jsonb; recipient_id uuid; correlation uuid:=gen_random_uuid(); staff_name text;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'workforce.manage') then raise exception 'forbidden'; end if;
  if target_ends_at<=target_starts_at or target_deadline_at<=now() or target_deadline_at>target_ends_at then raise exception 'invalid_request_window'; end if;
  if jsonb_typeof(recipient_inputs)<>'array' or jsonb_array_length(recipient_inputs)=0 then raise exception 'recipients_required'; end if;
  insert into public.availability_request_periods(organisation_id,venue_id,starts_at,ends_at,deadline_at,status,created_by)
  values(target_organisation_id,target_venue_id,target_starts_at,target_ends_at,target_deadline_at,'sent',auth.uid()) returning id into request_id;
  for item in select * from jsonb_array_elements(recipient_inputs) loop
    select s.full_name into staff_name from public.staff_profiles s
    join public.staff_venue_assignments a on a.organisation_id=s.organisation_id and a.staff_id=s.id
    where s.organisation_id=target_organisation_id and a.venue_id=target_venue_id and s.id=(item->>'staff_id')::uuid;
    if staff_name is null then raise exception 'recipient_not_assigned'; end if;
    insert into public.availability_request_recipients(organisation_id,venue_id,request_id,staff_id,status)
    values(target_organisation_id,target_venue_id,request_id,(item->>'staff_id')::uuid,'sent') returning id into recipient_id;
    insert into public.secure_response_tokens(organisation_id,recipient_id,token_hash,purpose,expires_at)
    values(target_organisation_id,recipient_id,item->>'token_hash','availability',target_deadline_at);
    insert into public.notification_outbox(organisation_id,venue_id,channel,destination_e164,correlation_type,correlation_id,payload,state)
    values(target_organisation_id,target_venue_id,'copyable_message',null,'availability_request',recipient_id,
      jsonb_build_object('staff_name',staff_name,'response_url',item->>'response_url','starts_at',target_starts_at,'ends_at',target_ends_at,'language',coalesce(item->>'language','nl')),'pending');
  end loop;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,correlation_id,payload)
  values(target_organisation_id,target_venue_id,'availability_request',request_id,'availability_requested',auth.uid(),correlation,jsonb_build_object('recipient_count',jsonb_array_length(recipient_inputs)));
  return request_id;
end $$;

create or replace function public.inspect_availability_request(target_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods; result jsonb;
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then return jsonb_build_object('state','invalid'); end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id;
  if token_row.revoked_at is not null or recipient.status='revoked' then return jsonb_build_object('state','revoked'); end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then
    update public.availability_request_recipients set status='expired' where id=recipient.id and status not in ('submitted','revoked');
    return jsonb_build_object('state','expired');
  end if;
  if recipient.status in ('sent','delivered') then
    update public.availability_request_recipients set status='opened',opened_at=coalesce(opened_at,now()) where id=recipient.id;
    insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,correlation_id,payload)
    values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability_opened',gen_random_uuid(),'{}');
  end if;
  select jsonb_build_object('state',r.status,'starts_at',p.starts_at,'ends_at',p.ends_at,'deadline_at',p.deadline_at,
    'venue_name',v.name,'entries',coalesce((select jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'availability',a.availability,'note',a.note) order by a.starts_at)
      from public.staff_availability a where a.request_recipient_id=r.id),'[]'::jsonb))
  into result from public.availability_request_recipients r join public.availability_request_periods p on p.id=r.request_id
  join public.venues v on v.id=r.venue_id and v.organisation_id=r.organisation_id where r.id=recipient.id;
  return result;
end $$;

create or replace function public.submit_availability_request(target_token_hash text,entry_inputs jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods;
item jsonb; left_item jsonb; correlation uuid:=gen_random_uuid();
begin
  select * into token_row from public.secure_response_tokens where token_hash=target_token_hash and purpose='availability' for update;
  if token_row.id is null then raise exception 'invalid_token'; end if;
  select * into recipient from public.availability_request_recipients where id=token_row.recipient_id for update;
  select * into period from public.availability_request_periods where id=recipient.request_id for update;
  if token_row.revoked_at is not null or recipient.status='revoked' then raise exception 'token_revoked'; end if;
  if token_row.expires_at<=now() or period.deadline_at<=now() then raise exception 'token_expired'; end if;
  if jsonb_typeof(entry_inputs)<>'array' or jsonb_array_length(entry_inputs)=0 or jsonb_array_length(entry_inputs)>100 then raise exception 'entries_required'; end if;
  for item in select * from jsonb_array_elements(entry_inputs) loop
    if (item->>'starts_at')::timestamptz<period.starts_at or (item->>'ends_at')::timestamptz>period.ends_at
      or (item->>'ends_at')::timestamptz<=(item->>'starts_at')::timestamptz
      or item->>'availability' not in ('available','preferred','unavailable') then raise exception 'invalid_entry'; end if;
    for left_item in select * from jsonb_array_elements(entry_inputs) loop
      if left_item<>item and (left_item->>'starts_at')::timestamptz<(item->>'ends_at')::timestamptz
        and (left_item->>'ends_at')::timestamptz>(item->>'starts_at')::timestamptz then raise exception 'overlapping_entries'; end if;
    end loop;
  end loop;
  delete from public.staff_availability where request_recipient_id=recipient.id;
  for item in select * from jsonb_array_elements(entry_inputs) loop
    insert into public.staff_availability(organisation_id,venue_id,staff_id,starts_at,ends_at,availability,note,source,created_by,request_recipient_id,submitted_at)
    values(recipient.organisation_id,recipient.venue_id,recipient.staff_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,
      item->>'availability',nullif(item->>'note',''),'availability_link',period.created_by,recipient.id,now());
  end loop;
  update public.availability_request_recipients set status='submitted',submitted_at=now(),opened_at=coalesce(opened_at,now()) where id=recipient.id;
  update public.secure_response_tokens set consumed_at=now() where id=token_row.id;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,correlation_id,payload)
  values(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability_submitted',correlation,jsonb_build_object('entry_count',jsonb_array_length(entry_inputs)));
  return jsonb_build_object('state','submitted','submitted_at',now());
end $$;

revoke all on function public.create_availability_request(uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb) from public,anon;
grant execute on function public.create_availability_request(uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb) to authenticated;
revoke all on function public.inspect_availability_request(text) from public,authenticated;
revoke all on function public.submit_availability_request(text,jsonb) from public,authenticated;
grant execute on function public.inspect_availability_request(text) to anon;
grant execute on function public.submit_availability_request(text,jsonb) to anon;
grant all on all tables in schema public to service_role;
commit;
