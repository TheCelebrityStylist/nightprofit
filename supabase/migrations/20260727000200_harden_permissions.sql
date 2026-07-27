begin;

drop policy if exists organisation_members_staff_insert on public.organisation_members;
drop policy if exists organisation_members_staff_update on public.organisation_members;
drop policy if exists organisation_members_admin_delete on public.organisation_members;
create policy organisation_members_owner_admin_insert on public.organisation_members for insert with check(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy organisation_members_owner_admin_update on public.organisation_members for update using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[])) with check(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy organisation_members_owner_admin_delete on public.organisation_members for delete using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));

drop policy if exists invitations_staff_insert on public.invitations;
drop policy if exists invitations_staff_update on public.invitations;
drop policy if exists invitations_admin_delete on public.invitations;
create policy invitations_admin_insert on public.invitations for insert with check(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy invitations_admin_update on public.invitations for update using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy invitations_admin_delete on public.invitations for delete using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));

drop policy if exists subscriptions_member_select on public.subscriptions;
drop policy if exists subscriptions_staff_insert on public.subscriptions;
drop policy if exists subscriptions_staff_update on public.subscriptions;
drop policy if exists subscriptions_admin_delete on public.subscriptions;
create policy subscriptions_owner_select on public.subscriptions for select using(public.has_role(organisation_id,array['owner']::public.member_role[]));

drop policy if exists feature_entitlements_staff_insert on public.feature_entitlements;
drop policy if exists feature_entitlements_staff_update on public.feature_entitlements;
drop policy if exists feature_entitlements_admin_delete on public.feature_entitlements;

drop policy if exists venue_settings_member_select on public.venue_settings;
drop policy if exists venue_settings_staff_insert on public.venue_settings;
drop policy if exists venue_settings_staff_update on public.venue_settings;
drop policy if exists venue_settings_admin_delete on public.venue_settings;
create policy venue_settings_member_select on public.venue_settings for select using(public.is_venue_member(organisation_id,venue_id));
create policy venue_settings_admin_insert on public.venue_settings for insert with check(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy venue_settings_admin_update on public.venue_settings for update using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy venue_settings_admin_delete on public.venue_settings for delete using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));

drop policy if exists venues_member_select on public.venues;
drop policy if exists venues_staff_insert on public.venues;
drop policy if exists venues_staff_update on public.venues;
drop policy if exists venues_admin_delete on public.venues;
create policy venues_member_select on public.venues for select using(public.is_venue_member(organisation_id,id));
create policy venues_admin_insert on public.venues for insert with check(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy venues_admin_update on public.venues for update using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));
create policy venues_admin_delete on public.venues for delete using(public.has_role(organisation_id,array['owner','administrator']::public.member_role[]));

create or replace function public.prevent_mutation() returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('request.jwt.claim.role',true)='service_role' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception 'immutable_record';
end $$;

revoke all on public.stripe_webhook_events from anon,authenticated;
grant select,insert,update,delete on public.stripe_webhook_events to service_role;

commit;
