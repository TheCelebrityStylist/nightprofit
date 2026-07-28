begin;

alter table public.staff_incidents
  add column if not exists category text not null default 'other',
  add column if not exists witnesses text,
  add column if not exists actions_taken text;

create index if not exists booking_inquiries_pipeline_idx
  on public.booking_inquiries(organisation_id,venue_id,status,preferred_start);
create index if not exists supplier_contract_notice_idx
  on public.supplier_contracts(organisation_id,notice_deadline) where status in ('active','notice_due');
create index if not exists staff_policy_expiry_idx
  on public.compliance_policies(organisation_id,expires_at) where expires_at is not null;
create index if not exists event_yield_recent_idx
  on public.event_yield_scenarios(organisation_id,venue_id,created_at desc);

commit;
