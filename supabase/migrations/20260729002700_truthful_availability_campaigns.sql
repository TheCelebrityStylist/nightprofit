begin;

create table public.availability_response_revisions(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  request_recipient_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  availability text not null,
  note text,
  source_row_id uuid not null,
  source_created_at timestamptz not null,
  replaced_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,request_recipient_id) references public.availability_request_recipients(organisation_id,id) on delete cascade,
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade,
  unique(organisation_id,source_row_id)
);

alter table public.availability_response_revisions enable row level security;
create policy availability_revision_manager on public.availability_response_revisions for select
  using(public.has_capability(organisation_id,venue_id,'workforce.manage'));
create policy availability_revision_employee on public.availability_response_revisions for select
  using(exists(select 1 from public.staff_profiles s where s.organisation_id=availability_response_revisions.organisation_id and s.id=availability_response_revisions.staff_id and s.auth_user_id=auth.uid()));

create or replace function public.archive_availability_response_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.request_recipient_id is not null then
    insert into public.availability_response_revisions(
      organisation_id,venue_id,request_recipient_id,staff_id,starts_at,ends_at,
      availability,note,source_row_id,source_created_at
    ) values(
      old.organisation_id,old.venue_id,old.request_recipient_id,old.staff_id,old.starts_at,old.ends_at,
      old.availability,old.note,old.id,old.created_at
    ) on conflict(organisation_id,source_row_id) do nothing;
  end if;
  return old;
end $$;

drop trigger if exists archive_availability_response_revision on public.staff_availability;
create trigger archive_availability_response_revision before delete on public.staff_availability
for each row execute function public.archive_availability_response_revision();

alter table public.availability_request_periods add column if not exists idempotency_key text;
create unique index if not exists availability_request_idempotency_unique on public.availability_request_periods(organisation_id,idempotency_key) where idempotency_key is not null;

create or replace function public.create_availability_request_v3(
  target_organisation_id uuid,target_venue_id uuid,target_starts_at timestamptz,target_ends_at timestamptz,
  target_deadline_at timestamptz,recipient_inputs jsonb,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare request_id uuid; item jsonb; recipient_id uuid; correlation uuid:=gen_random_uuid(); staff_name text; recipient_status text; existing_id uuid;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'workforce.manage') then raise exception 'forbidden'; end if;
  if length(target_idempotency_key)<16 then raise exception 'invalid_idempotency_key'; end if;
  select id into existing_id from public.availability_request_periods where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if existing_id is not null then return jsonb_build_object('request_id',existing_id,'replayed',true); end if;
  if target_ends_at<=target_starts_at or target_deadline_at<=now() or target_deadline_at>target_ends_at then raise exception 'invalid_request_window'; end if;
  if jsonb_typeof(recipient_inputs)<>'array' or jsonb_array_length(recipient_inputs)=0 then raise exception 'recipients_required'; end if;
  insert into public.availability_request_periods(organisation_id,venue_id,starts_at,ends_at,deadline_at,status,created_by,reminder_policy,idempotency_key)
  values(target_organisation_id,target_venue_id,target_starts_at,target_ends_at,target_deadline_at,'scheduled',auth.uid(),'{"maximum_reminders":2,"schedule_hours_before_deadline":[48,12]}'::jsonb,target_idempotency_key) returning id into request_id;
  for item in select * from jsonb_array_elements(recipient_inputs) loop
    select s.full_name into staff_name from public.staff_profiles s join public.staff_venue_assignments a on a.organisation_id=s.organisation_id and a.staff_id=s.id
    where s.organisation_id=target_organisation_id and a.venue_id=target_venue_id and s.id=(item->>'staff_id')::uuid;
    if staff_name is null then raise exception 'recipient_not_assigned'; end if;
    recipient_status=case item->>'phone_state' when 'valid' then 'ready' when 'invalid' then 'invalid_phone' else 'missing_phone' end;
    insert into public.availability_request_recipients(organisation_id,venue_id,request_id,staff_id,status,destination_e164)
    values(target_organisation_id,target_venue_id,request_id,(item->>'staff_id')::uuid,recipient_status,nullif(item->>'destination_e164','')) returning id into recipient_id;
    insert into public.secure_response_tokens(organisation_id,recipient_id,token_hash,purpose,expires_at)
    values(target_organisation_id,recipient_id,item->>'token_hash','availability',target_deadline_at);
    insert into public.notification_outbox(organisation_id,venue_id,channel,destination_e164,correlation_type,correlation_id,payload,state)
    values(target_organisation_id,target_venue_id,'copyable_message',nullif(item->>'destination_e164',''),'availability_request',recipient_id,
      jsonb_build_object('staff_name',staff_name,'response_url',item->>'response_url','starts_at',target_starts_at,'ends_at',target_ends_at,'language',coalesce(item->>'language','nl'),'delivery_available',false),'pending');
  end loop;
  perform public.append_operational_event(target_organisation_id,target_venue_id,'availability_request',request_id,'availability.prepared',jsonb_build_object('recipient_count',jsonb_array_length(recipient_inputs),'external_delivery',false),correlation);
  return jsonb_build_object('request_id',request_id,'replayed',false);
end $$;

create or replace function public.inspect_availability_request_v2(target_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_row public.secure_response_tokens; recipient public.availability_request_recipients; period public.availability_request_periods; staff public.staff_profiles; result jsonb; became_opened boolean:=false;
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
  if recipient.status in ('sent','delivered','provider_accepted','manually_shared','ready','missing_phone','invalid_phone') then
    update public.availability_request_recipients set status='opened',opened_at=coalesce(opened_at,now()) where id=recipient.id;
    became_opened=true;
  end if;
  if became_opened then perform public.append_operational_event(recipient.organisation_id,recipient.venue_id,'availability_recipient',recipient.id,'availability.opened','{}',gen_random_uuid()); end if;
  select jsonb_build_object('state',r.status,'starts_at',p.starts_at,'ends_at',p.ends_at,'deadline_at',p.deadline_at,'venue_name',v.name,'preferred_language',staff.preferred_language,'employee_name',coalesce(staff.first_name,split_part(staff.full_name,' ',1)),'entries',coalesce((select jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'availability',a.availability,'note',a.note) order by a.starts_at) from public.staff_availability a where a.request_recipient_id=r.id),'[]'::jsonb)) into result
  from public.availability_request_recipients r join public.availability_request_periods p on p.id=r.request_id join public.venues v on v.id=r.venue_id and v.organisation_id=r.organisation_id where r.id=recipient.id;
  return result;
end $$;

revoke all on function public.create_availability_request(uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb) from authenticated;
revoke all on function public.create_availability_request_v3(uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb,text) from public,anon;
grant execute on function public.create_availability_request_v3(uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb,text) to authenticated;
revoke all on function public.inspect_availability_request_v2(text) from public,authenticated;
grant execute on function public.inspect_availability_request_v2(text) to anon;
grant all on public.availability_response_revisions to service_role;

commit;
