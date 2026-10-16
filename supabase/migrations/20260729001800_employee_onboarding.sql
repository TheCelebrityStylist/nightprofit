begin;

create table public.staff_onboarding_invitations(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, staff_id uuid not null, token_hash text not null unique, access_role public.member_role not null default 'employee' check(access_role='employee'),
  language text not null check(language in ('nl','en')), expires_at timestamptz not null, revoked_at timestamptz, claimed_at timestamptz,
  message_state text not null default 'prepared' check(message_state in ('prepared','opened_in_whatsapp','copied','provider_queued','provider_sent','failed','revoked','claimed')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organisation_id,id), foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete cascade
);
alter table public.staff_onboarding_invitations enable row level security;
create policy staff_onboarding_manager_read on public.staff_onboarding_invitations for select using(public.has_capability(organisation_id,venue_id,'members.manage'));
create policy staff_onboarding_manager_update on public.staff_onboarding_invitations for update using(public.has_capability(organisation_id,venue_id,'members.manage')) with check(public.has_capability(organisation_id,venue_id,'members.manage'));
grant select,update on public.staff_onboarding_invitations to authenticated;
grant all on public.staff_onboarding_invitations to service_role;

create or replace function public.create_invited_staff(target_organisation_id uuid,target_venue_id uuid,target_department_id uuid,target_role_id uuid,target_full_name text,target_email text,target_phone text,target_language text,target_engagement_type text,target_token_hash text,target_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff_id uuid; role_name text; invitation_id uuid;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'members.manage') then raise exception 'forbidden'; end if;
  select name into role_name from public.operational_roles where organisation_id=target_organisation_id and id=target_role_id and department_id=target_department_id and active=true;
  if role_name is null then raise exception 'invalid_team_assignment'; end if;
  if exists(select 1 from public.staff_profiles where organisation_id=target_organisation_id and (lower(contact_email)=lower(nullif(target_email,'')) or contact_phone=target_phone)) then raise exception 'duplicate_staff'; end if;
  insert into public.staff_profiles(organisation_id,full_name,contact_email,contact_phone,preferred_language,engagement_type,role_name,onboarding_status,employment_status,invitation_state)
  values(target_organisation_id,trim(target_full_name),nullif(lower(target_email),''),target_phone,target_language,target_engagement_type,role_name,'invited','invited','pending') returning id into staff_id;
  insert into public.staff_venue_assignments(organisation_id,staff_id,venue_id) values(target_organisation_id,staff_id,target_venue_id);
  insert into public.staff_role_qualifications(organisation_id,staff_id,role_id,verified_by,verified_at) values(target_organisation_id,staff_id,target_role_id,auth.uid(),now());
  insert into public.staff_onboarding_invitations(organisation_id,venue_id,staff_id,token_hash,access_role,language,expires_at,created_by) values(target_organisation_id,target_venue_id,staff_id,target_token_hash,'employee',target_language,target_expires_at,auth.uid()) returning id into invitation_id;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,target_venue_id,'staff_profile',staff_id,'staff.invited',auth.uid(),jsonb_build_object('invitation_id',invitation_id,'role_id',target_role_id,'department_id',target_department_id,'delivery_state','prepared'));
  return jsonb_build_object('staff_id',staff_id,'invitation_id',invitation_id,'role_name',role_name);
end $$;

create or replace function public.claim_staff_onboarding(target_token_hash text,target_user_id uuid,target_email text,target_contracted_minutes integer,target_minimum_minutes integer,target_maximum_minutes integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.staff_onboarding_invitations; staff public.staff_profiles;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  select * into invitation from public.staff_onboarding_invitations where token_hash=target_token_hash for update;
  if invitation.id is null then raise exception 'invalid_invitation'; end if;
  if invitation.revoked_at is not null or invitation.claimed_at is not null then raise exception 'invitation_unavailable'; end if;
  if invitation.expires_at<=now() then raise exception 'invitation_expired'; end if;
  if target_contracted_minutes<0 or target_minimum_minutes<0 or target_maximum_minutes<target_minimum_minutes or target_contracted_minutes>target_maximum_minutes or target_maximum_minutes>10080 then raise exception 'invalid_contract_minutes'; end if;
  if exists(select 1 from public.organisation_members where organisation_id=invitation.organisation_id and user_id=target_user_id) then raise exception 'membership_exists'; end if;
  select * into staff from public.staff_profiles where organisation_id=invitation.organisation_id and id=invitation.staff_id for update;
  if staff.id is null or staff.auth_user_id is not null or staff.employment_status='deactivated' then raise exception 'staff_unavailable'; end if;
  insert into public.organisation_members(organisation_id,user_id,role,venue_ids,active) values(invitation.organisation_id,target_user_id,'employee',array[invitation.venue_id],true);
  update public.staff_profiles set auth_user_id=target_user_id,contact_email=lower(target_email),contracted_minutes_week=target_contracted_minutes,minimum_minutes_week=target_minimum_minutes,maximum_minutes_week=target_maximum_minutes,onboarding_status='cleared',employment_status='active',invitation_state='accepted',updated_at=now() where id=staff.id;
  update public.staff_onboarding_invitations set claimed_at=now(),message_state='claimed',updated_at=now() where id=invitation.id;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(invitation.organisation_id,invitation.venue_id,'staff_profile',staff.id,'staff.onboarding_completed',target_user_id,jsonb_build_object('invitation_id',invitation.id));
  return jsonb_build_object('organisation_id',invitation.organisation_id,'venue_id',invitation.venue_id,'staff_id',staff.id);
end $$;

revoke all on function public.claim_staff_onboarding(text,uuid,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.create_invited_staff(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz) from public,anon;
grant execute on function public.claim_staff_onboarding(text,uuid,text,integer,integer,integer) to service_role;
grant execute on function public.create_invited_staff(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz) to authenticated;
commit;
