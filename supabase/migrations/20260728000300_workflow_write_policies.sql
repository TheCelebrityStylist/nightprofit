begin;

drop policy if exists suppliers_cap_all on public.suppliers;
create policy suppliers_cap_all on public.suppliers for all
using(public.has_capability(organisation_id,null,'suppliers.manage'))
with check(public.has_capability(organisation_id,null,'suppliers.manage'));

drop policy if exists events_cap_all on public.events;
create policy events_cap_all on public.events for all
using(public.has_capability(organisation_id,venue_id,'events.manage'))
with check(public.has_capability(organisation_id,venue_id,'events.manage'));

commit;
