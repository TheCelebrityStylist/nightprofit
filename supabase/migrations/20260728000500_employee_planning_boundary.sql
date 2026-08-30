alter type public.member_role add value if not exists 'employee';
commit;

begin;

insert into public.role_capabilities(role,capability) values
('employee','planning.respond'),
('employee','time.record')
on conflict do nothing;

create policy compliance_staff_self_read on public.staff_profiles for select
using(auth_user_id=auth.uid());

drop policy if exists availability_read on public.staff_availability;
drop policy if exists availability_write on public.staff_availability;
create policy availability_manager_read on public.staff_availability for select
using(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy availability_self_read on public.staff_availability for select
using(exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=staff_availability.organisation_id
    and staff.id=staff_availability.staff_id and staff.auth_user_id=auth.uid()
));
create policy availability_manager_write on public.staff_availability for all
using(public.has_capability(organisation_id,venue_id,'planning.manage'))
with check(public.has_capability(organisation_id,venue_id,'planning.manage'));
create policy availability_self_insert on public.staff_availability for insert
with check(created_by=auth.uid() and exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=staff_availability.organisation_id
    and staff.id=staff_availability.staff_id and staff.auth_user_id=auth.uid()
));

create policy responses_self_read on public.shift_responses for select
using(exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=shift_responses.organisation_id
    and staff.id=shift_responses.staff_id and staff.auth_user_id=auth.uid()
));
drop policy if exists responses_write on public.shift_responses;
create policy responses_self_insert on public.shift_responses for insert
with check(public.has_capability(organisation_id,venue_id,'planning.respond') and exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=shift_responses.organisation_id
    and staff.id=shift_responses.staff_id and staff.auth_user_id=auth.uid()
));

create policy time_records_self_read on public.time_records for select
using(exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=time_records.organisation_id
    and staff.id=time_records.staff_id and staff.auth_user_id=auth.uid()
));
create policy time_records_self_insert on public.time_records for insert
with check(public.has_capability(organisation_id,venue_id,'time.record') and status='open' and exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=time_records.organisation_id
    and staff.id=time_records.staff_id and staff.auth_user_id=auth.uid()
));
create policy time_records_self_update on public.time_records for update
using(status='open' and exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=time_records.organisation_id
    and staff.id=time_records.staff_id and staff.auth_user_id=auth.uid()
))
with check(status in ('open','submitted') and approved_by is null and exists(
  select 1 from public.staff_profiles staff
  where staff.organisation_id=time_records.organisation_id
    and staff.id=time_records.staff_id and staff.auth_user_id=auth.uid()
));

commit;
