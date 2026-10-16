begin;

create table public.capability_permissions (
  capability text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_capabilities (
  role public.member_role not null,
  capability text not null references public.capability_permissions(capability) on delete cascade,
  primary key(role, capability)
);

create table public.member_capability_overrides (
  organisation_id uuid not null,
  user_id uuid not null,
  capability text not null references public.capability_permissions(capability) on delete cascade,
  allowed boolean not null,
  created_at timestamptz not null default now(),
  primary key(organisation_id, user_id, capability),
  foreign key(organisation_id,user_id)
    references public.organisation_members(organisation_id,user_id) on delete cascade
);

create table public.venue_assignments (
  organisation_id uuid not null,
  venue_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(organisation_id,venue_id,user_id),
  foreign key(organisation_id,user_id)
    references public.organisation_members(organisation_id,user_id) on delete cascade
);

alter table public.venues
  add constraint venues_org_id_unique unique(organisation_id,id);

alter table public.closing_sessions add constraint closing_sessions_org_id_unique unique(organisation_id,id);
alter table public.events add constraint events_org_id_unique unique(organisation_id,id);
alter table public.suppliers add constraint suppliers_org_id_unique unique(organisation_id,id);
alter table public.supplier_invoices add constraint supplier_invoices_org_id_unique unique(organisation_id,id);
alter table public.products add constraint products_org_id_unique unique(organisation_id,id);
alter table public.menu_items add constraint menu_items_org_id_unique unique(organisation_id,id);
alter table public.organiser_agreements add constraint organiser_agreements_org_id_unique unique(organisation_id,id);

alter table public.closing_lines add constraint closing_lines_close_tenant_fk
  foreign key(organisation_id,closing_session_id)
  references public.closing_sessions(organisation_id,id) on delete cascade;
alter table public.cash_counts add constraint cash_counts_close_tenant_fk
  foreign key(organisation_id,closing_session_id)
  references public.closing_sessions(organisation_id,id) on delete cascade;
alter table public.close_comments add constraint close_comments_close_tenant_fk
  foreign key(organisation_id,closing_session_id)
  references public.closing_sessions(organisation_id,id) on delete cascade;
alter table public.event_revenue add constraint event_revenue_event_tenant_fk
  foreign key(organisation_id,event_id)
  references public.events(organisation_id,id) on delete cascade;
alter table public.event_costs add constraint event_costs_event_tenant_fk
  foreign key(organisation_id,event_id)
  references public.events(organisation_id,id) on delete cascade;
alter table public.event_staff_costs add constraint event_staff_event_tenant_fk
  foreign key(organisation_id,event_id)
  references public.events(organisation_id,id) on delete cascade;
alter table public.supplier_invoice_lines add constraint invoice_lines_invoice_tenant_fk
  foreign key(organisation_id,invoice_id)
  references public.supplier_invoices(organisation_id,id) on delete cascade;
alter table public.products add constraint products_supplier_tenant_fk
  foreign key(organisation_id,supplier_id)
  references public.suppliers(organisation_id,id);
alter table public.menu_item_components add constraint components_menu_tenant_fk
  foreign key(organisation_id,menu_item_id)
  references public.menu_items(organisation_id,id) on delete cascade;
alter table public.menu_item_components add constraint components_product_tenant_fk
  foreign key(organisation_id,product_id)
  references public.products(organisation_id,id);
alter table public.venue_assignments
  add constraint venue_assignments_venue_tenant_fk
  foreign key(organisation_id,venue_id)
  references public.venues(organisation_id,id) on delete cascade;

insert into public.capability_permissions(capability,description) values
('organisation.manage','Manage organisation configuration'),
('venues.manage','Manage venue configuration'),
('members.manage','Invite members and assign access'),
('billing.manage','Manage subscription and billing'),
('close.create','Create and edit nightly closes'),
('close.submit','Submit nightly closes'),
('close.approve','Approve or reject nightly closes'),
('close.reopen','Create a successor for an approved close'),
('bookings.manage','Manage group inquiries, quotes and bookings'),
('bookings.discount','Approve group-booking discounts'),
('suppliers.manage','Manage suppliers, invoices and contracts'),
('invoices.confirm','Confirm reviewed supplier invoices'),
('events.manage','Manage events and yield forecasts'),
('compliance.manage','Manage restricted staff compliance records'),
('reports.view','View operational reports'),
('exports.create','Create organisation exports'),
('evidence.view','View source evidence')
on conflict(capability) do update set description=excluded.description;

insert into public.role_capabilities(role,capability)
select 'owner'::public.member_role, capability from public.capability_permissions
on conflict do nothing;
insert into public.role_capabilities(role,capability) values
('administrator','organisation.manage'),('administrator','venues.manage'),('administrator','members.manage'),
('administrator','close.create'),('administrator','close.submit'),('administrator','close.approve'),
('administrator','close.reopen'),('administrator','bookings.manage'),('administrator','bookings.discount'),
('administrator','suppliers.manage'),('administrator','invoices.confirm'),('administrator','events.manage'),
('administrator','compliance.manage'),('administrator','reports.view'),('administrator','exports.create'),
('administrator','evidence.view'),
('manager','close.create'),('manager','close.submit'),('manager','events.manage'),('manager','reports.view'),
('manager','evidence.view'),
('venue_manager','close.create'),('venue_manager','close.submit'),('venue_manager','events.manage'),
('venue_manager','reports.view'),('venue_manager','evidence.view'),
('bookkeeper','close.create'),('bookkeeper','close.submit'),('bookkeeper','suppliers.manage'),
('bookkeeper','invoices.confirm'),('bookkeeper','reports.view'),('bookkeeper','exports.create'),
('bookkeeper','evidence.view'),
('finance','close.create'),('finance','close.submit'),('finance','suppliers.manage'),
('finance','invoices.confirm'),('finance','reports.view'),('finance','exports.create'),('finance','evidence.view'),
('bookings','bookings.manage'),('bookings','reports.view'),('bookings','evidence.view'),
('procurement','suppliers.manage'),('procurement','invoices.confirm'),('procurement','reports.view'),
('procurement','evidence.view'),
('compliance_manager','compliance.manage'),('compliance_manager','reports.view'),
('compliance_manager','evidence.view'),
('viewer','reports.view'),('viewer','evidence.view')
on conflict do nothing;

create or replace function public.has_capability(
  target_organisation_id uuid,
  target_venue_id uuid,
  required_capability text
) returns boolean
language sql stable security definer set search_path=''
as $$
  select exists (
    select 1
    from public.organisation_members member
    where member.organisation_id=target_organisation_id
      and member.user_id=auth.uid()
      and (
        target_venue_id is null
        or not exists (
          select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id
            and scoped.user_id=auth.uid()
        )
        or exists (
          select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id
            and scoped.user_id=auth.uid()
            and scoped.venue_id=target_venue_id
        )
      )
      and coalesce(
        (
          select override.allowed
          from public.member_capability_overrides override
          where override.organisation_id=target_organisation_id
            and override.user_id=auth.uid()
            and override.capability=required_capability
        ),
        exists (
          select 1 from public.role_capabilities role_capability
          where role_capability.role=member.role
            and role_capability.capability=required_capability
        )
      )
  )
$$;

-- Shared source/evidence model.
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  connector_key text not null,
  lifecycle_status text not null check(lifecycle_status in ('available','pilot','configuration_required','planned')),
  connection_status text not null check(connection_status in ('disconnected','connecting','connected','degraded','error')),
  capabilities text[] not null default '{}',
  credential_reference text,
  last_attempted_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  webhook_status text,
  credential_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,venue_id,connector_key),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  cursor_before text,
  cursor_after text,
  status text not null check(status in ('queued','running','succeeded','partial','failed')),
  records_processed integer not null default 0 check(records_processed>=0),
  records_rejected integer not null default 0 check(records_rejected>=0),
  attempt integer not null default 1 check(attempt>0),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  source_system text not null,
  source_type text not null,
  external_id text,
  source_hash text not null,
  occurred_at timestamptz,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique(organisation_id,source_system,source_type,source_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.normalized_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  source_record_id uuid not null references public.source_records(id) on delete restrict,
  record_type text not null,
  schema_version text not null,
  normalized_data jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.evidence_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  source_record_id uuid references public.source_records(id) on delete restrict,
  normalized_record_id uuid references public.normalized_records(id) on delete restrict,
  evidence_type text not null,
  transformation text,
  calculation_version text,
  configuration_version text,
  correction jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique(organisation_id,content_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.evidence_relationships (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  evidence_id uuid not null references public.evidence_records(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  relationship text not null,
  created_at timestamptz not null default now(),
  primary key(evidence_id,entity_type,entity_id,relationship)
);

create table public.profit_recovery_ledger (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  module text not null,
  issue text not null,
  detected_exposure_minor bigint not null default 0,
  estimated_recoverable_minor bigint not null default 0,
  verified_recovered_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  evidence_id uuid not null references public.evidence_records(id) on delete restrict,
  owner_id uuid references auth.users(id),
  deadline date,
  recommended_action text not null,
  action_taken text,
  status text not null check(status in ('detected','assigned','in_progress','resolved','verified','dismissed')),
  verification_evidence_id uuid references public.evidence_records(id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(verified_recovered_minor>=0),
  check(estimated_recoverable_minor>=0),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

-- Group Booking Revenue Agent.
create table public.booking_packages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  name text not null,
  version integer not null default 1 check(version>0),
  description text not null,
  inclusions jsonb not null default '[]',
  exclusions jsonb not null default '[]',
  price_per_person_minor bigint,
  fixed_price_minor bigint,
  minimum_spend_minor bigint,
  min_group_size integer,
  max_group_size integer,
  availability_rules jsonb not null default '{}',
  deposit_rules jsonb not null default '{}',
  cancellation_rules jsonb not null default '{}',
  vat_basis_points integer not null default 2100 check(vat_basis_points between 0 and 10000),
  active_from date not null,
  active_until date,
  created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,name,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.booking_inquiries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  status text not null check(status in ('new','qualified','proposal','awaiting_deposit','confirmed','completed','lost','cancelled','expired')),
  source text not null,
  preferred_start timestamptz not null,
  flexible boolean not null default false,
  group_size integer not null check(group_size>0),
  occasion text,
  budget_minor bigint,
  package_interest text,
  preferences jsonb not null default '{}',
  accessibility_notes text,
  contact_name text not null,
  contact_email citext not null,
  contact_phone text,
  consent_at timestamptz,
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.booking_quotes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  inquiry_id uuid not null references public.booking_inquiries(id) on delete cascade,
  version integer not null check(version>0),
  status text not null check(status in ('draft','approved','sent','accepted','expired','superseded')),
  currency char(3) not null default 'EUR',
  subtotal_minor bigint not null,
  vat_minor bigint not null,
  total_minor bigint not null,
  deposit_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  line_snapshot jsonb not null,
  terms_snapshot jsonb not null,
  expires_at timestamptz not null,
  approved_by uuid references auth.users(id),
  content_hash text not null unique,
  created_at timestamptz not null default now(),
  unique(inquiry_id,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.booking_deposits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  inquiry_id uuid not null references public.booking_inquiries(id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null default 'EUR',
  status text not null check(status in ('created','pending','paid','failed','refunded','partially_refunded')),
  paid_at timestamptz,
  refunded_minor bigint not null default 0 check(refunded_minor>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.diagnostic_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text unique,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null default 'EUR',
  payment_status text not null,
  fulfilment_status text not null check(fulfilment_status in ('pending','scheduled','in_progress','delivered','cancelled','refunded')),
  assigned_to uuid references auth.users(id),
  scheduled_for timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supplier Contract Guard.
create table public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  status text not null check(status in ('draft','active','notice_due','renewing','terminated','expired')),
  start_date date not null,
  end_date date,
  notice_deadline date,
  automatic_renewal boolean not null default false,
  responsible_owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.supplier_contract_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  contract_id uuid not null references public.supplier_contracts(id) on delete restrict,
  version integer not null check(version>0),
  terms jsonb not null,
  price_list jsonb not null default '[]',
  discounts jsonb not null default '[]',
  rebates jsonb not null default '[]',
  content_hash text not null unique,
  effective_from date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(contract_id,version)
);

create table public.contract_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  contract_id uuid not null references public.supplier_contracts(id) on delete restrict,
  invoice_line_id uuid references public.supplier_invoice_lines(id) on delete restrict,
  evidence_id uuid not null references public.evidence_records(id) on delete restrict,
  discrepancy_type text not null,
  expected_minor bigint,
  invoiced_minor bigint,
  difference_minor bigint,
  financial_impact_minor bigint not null default 0,
  possible_explanation text,
  recommended_check text not null,
  owner_id uuid references auth.users(id),
  status text not null check(status in ('open','reviewing','accepted','disputed','resolved','dismissed')),
  resolution text,
  credit_received_minor bigint not null default 0,
  verified_recovered_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

-- Explainable event forecasts and backtesting.
create table public.event_yield_scenarios (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  event_id uuid not null references public.events(id) on delete cascade,
  scenario text not null check(scenario in ('worst','base','best','manual')),
  model_version text not null,
  calculation_version text not null,
  formula_version text not null,
  input_snapshot jsonb not null,
  configuration_snapshot jsonb not null,
  assumptions jsonb not null,
  comparable_event_ids uuid[] not null default '{}',
  attendance_low integer check(attendance_low>=0),
  attendance_high integer check(attendance_high>=attendance_low),
  revenue_low_minor bigint,
  revenue_high_minor bigint,
  staff_cost_minor bigint,
  stock_requirement jsonb not null default '{}',
  organiser_payout_minor bigint,
  contribution_minor bigint,
  break_even_revenue_minor bigint,
  break_even_attendance integer,
  confidence_basis_points integer not null check(confidence_basis_points between 0 and 10000),
  missing_data text[] not null default '{}',
  content_hash text not null unique,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.event_forecast_outcomes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  scenario_id uuid not null unique references public.event_yield_scenarios(id) on delete restrict,
  actual_attendance integer check(actual_attendance>=0),
  actual_revenue_minor bigint,
  actual_contribution_minor bigint,
  attendance_error integer,
  revenue_error_minor bigint,
  contribution_error_minor bigint,
  evaluated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

-- Restricted Staff Compliance OS.
create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  contact_email citext,
  contact_phone text,
  preferred_language text not null default 'nl',
  engagement_type text not null,
  role_name text not null,
  start_date date,
  end_date date,
  onboarding_status text not null check(onboarding_status in ('invited','in_progress','review_required','cleared','expired','suspended','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_venue_assignments (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  venue_id uuid not null,
  primary key(staff_id,venue_id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.compliance_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  jurisdiction text not null,
  policy_key text not null,
  version integer not null check(version>0),
  title_nl text not null,
  title_en text not null,
  body_nl text not null,
  body_en text not null,
  effective_date date not null,
  source_url text,
  source_document_path text,
  responsible_owner_id uuid not null references auth.users(id),
  required_roles text[] not null default '{}',
  expires_at date,
  replacement_policy_id uuid references public.compliance_policies(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,policy_key,version)
);

create table public.staff_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  policy_id uuid not null references public.compliance_policies(id) on delete restrict,
  acknowledged_at timestamptz not null,
  signature_evidence_id uuid not null references public.evidence_records(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(staff_id,policy_id)
);

create table public.staff_incidents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  staff_id uuid references public.staff_profiles(id) on delete restrict,
  occurred_at timestamptz not null,
  factual_record text not null check(length(factual_record) between 1 and 10000),
  status text not null check(status in ('draft','finalized')),
  finalized_by uuid references auth.users(id),
  finalized_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  check((status='draft' and finalized_at is null) or (status='finalized' and finalized_at is not null))
);

create trigger immutable_evidence before update or delete on public.evidence_records
for each row execute function public.prevent_mutation();
create trigger immutable_quote_versions before update or delete on public.booking_quotes
for each row execute function public.prevent_mutation();
create trigger immutable_contract_versions before update or delete on public.supplier_contract_versions
for each row execute function public.prevent_mutation();
create trigger immutable_forecast_snapshots before update or delete on public.event_yield_scenarios
for each row execute function public.prevent_mutation();

create or replace function public.prevent_finalized_incident_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='finalized' and current_setting('request.jwt.claim.role',true)<>'service_role'
  then raise exception 'finalized_incident_is_immutable'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger finalized_incident_immutable
before update or delete on public.staff_incidents
for each row execute function public.prevent_finalized_incident_mutation();

-- Protected close transition: financial totals are recomputed in PostgreSQL.
create or replace function public.transition_close(
  target_close_id uuid,
  target_status public.close_status,
  reason text default null
) returns public.closing_sessions
language plpgsql security definer set search_path=''
as $$
declare
  current_close public.closing_sessions;
  successor_close public.closing_sessions;
  expected_sum bigint;
  actual_sum bigint;
  snapshot_data jsonb;
begin
  select * into current_close from public.closing_sessions where id=target_close_id for update;
  if current_close.id is null then raise exception 'close_not_found'; end if;
  if not public.has_capability(current_close.organisation_id,current_close.venue_id,
    case when target_status in ('approved','locked') then 'close.approve'
         when target_status='reopened' then 'close.reopen'
         else 'close.submit' end)
  then raise exception 'forbidden'; end if;

  if target_status not in ('submitted','approved','locked','reopened') then raise exception 'invalid_target_status'; end if;
  if target_status='submitted' and current_close.status not in ('draft','reopened') then raise exception 'invalid_transition'; end if;
  if target_status='approved' and current_close.status<>'submitted' then raise exception 'invalid_transition'; end if;
  if target_status='locked' and current_close.status<>'approved' then raise exception 'invalid_transition'; end if;
  if target_status='reopened' and current_close.status not in ('approved','locked') then raise exception 'invalid_transition'; end if;
  if target_status='reopened' and length(trim(coalesce(reason,'')))<10 then raise exception 'reopen_reason_required'; end if;

  select coalesce(sum(expected_minor),0),coalesce(sum(actual_minor),0)
  into expected_sum,actual_sum
  from public.closing_lines where closing_session_id=target_close_id;

  if target_status='reopened' then
    insert into public.closing_sessions(
      organisation_id,venue_id,trading_date,event_id,status,version,created_by,reopened_reason
    ) values (
      current_close.organisation_id,current_close.venue_id,current_close.trading_date,
      current_close.event_id,'reopened',current_close.version+1,auth.uid(),reason
    ) returning * into successor_close;
    insert into public.closing_lines(
      organisation_id,closing_session_id,line_type,source_id,expected_minor,actual_minor,quantity,metadata
    )
    select organisation_id,successor_close.id,line_type,source_id,expected_minor,actual_minor,quantity,
      metadata||jsonb_build_object('copied_from_close_id',current_close.id)
    from public.closing_lines where closing_session_id=current_close.id;
    return successor_close;
  end if;

  update public.closing_sessions set
    status=target_status,
    expected_total_minor=expected_sum,
    accounted_total_minor=actual_sum,
    submitted_by=case when target_status='submitted' then auth.uid() else submitted_by end,
    submitted_at=case when target_status='submitted' then now() else submitted_at end,
    approved_by=case when target_status='approved' then auth.uid() else approved_by end,
    approved_at=case when target_status='approved' then now() else approved_at end,
    locked_at=case when target_status='locked' then now() else locked_at end
  where id=target_close_id returning * into current_close;

  if target_status='approved' then
    snapshot_data=jsonb_build_object(
      'schema_version','1',
      'closing_session',to_jsonb(current_close),
      'lines',coalesce((
        select jsonb_agg(to_jsonb(line) order by line.created_at,line.id)
        from public.closing_lines line
        where line.closing_session_id=target_close_id
      ),'[]'::jsonb)
    );
    insert into public.close_snapshots(
      organisation_id,closing_session_id,snapshot,content_hash,created_by
    ) values (
      current_close.organisation_id,current_close.id,snapshot_data,
      encode(digest(convert_to(snapshot_data::text,'UTF8'),'sha256'),'hex'),auth.uid()
    ) on conflict(closing_session_id) do nothing;
  end if;
  return current_close;
end $$;

-- Replace broad write policies on the highest-risk existing financial tables.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'closing_sessions','closing_lines','cash_counts','close_comments',
    'events','event_forecasts','event_revenue','event_costs','event_staff_costs',
    'suppliers','supplier_invoices','supplier_invoice_lines','products',
    'product_cost_history','menu_items','menu_item_components','menu_price_history'
  ] loop
    execute format('drop policy if exists %I_staff_insert on public.%I',table_name,table_name);
    execute format('drop policy if exists %I_staff_update on public.%I',table_name,table_name);
    execute format('drop policy if exists %I_admin_delete on public.%I',table_name,table_name);
  end loop;
end $$;

create policy closing_sessions_cap_insert on public.closing_sessions for insert
with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy closing_sessions_cap_update on public.closing_sessions for update
using(public.has_capability(organisation_id,venue_id,'close.create'))
with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy closing_lines_cap_all on public.closing_lines for all
using(public.has_capability(organisation_id,null,'close.create'))
with check(public.has_capability(organisation_id,null,'close.create'));

-- Apply a consistent member-read / capability-write boundary to new tables.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'member_capability_overrides','venue_assignments','integration_connections','sync_runs',
    'source_records','normalized_records','evidence_records','evidence_relationships',
    'profit_recovery_ledger','booking_packages','booking_inquiries','booking_quotes',
    'booking_deposits','diagnostic_orders','supplier_contracts','supplier_contract_versions',
    'contract_discrepancies','event_yield_scenarios','event_forecast_outcomes'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I_member_read on public.%I for select using(public.is_member(organisation_id))',table_name,table_name);
  end loop;
end $$;

alter table public.capability_permissions enable row level security;
alter table public.role_capabilities enable row level security;
create policy capability_catalog_read on public.capability_permissions for select to authenticated using(true);
create policy role_capability_catalog_read on public.role_capabilities for select to authenticated using(true);

create policy access_owner_write on public.member_capability_overrides for all
using(public.has_capability(organisation_id,null,'members.manage'))
with check(public.has_capability(organisation_id,null,'members.manage'));
create policy venue_assignment_owner_write on public.venue_assignments for all
using(public.has_capability(organisation_id,venue_id,'members.manage'))
with check(public.has_capability(organisation_id,venue_id,'members.manage'));
create policy booking_write on public.booking_inquiries for all
using(public.has_capability(organisation_id,venue_id,'bookings.manage'))
with check(public.has_capability(organisation_id,venue_id,'bookings.manage'));
create policy booking_package_write on public.booking_packages for all
using(public.has_capability(organisation_id,venue_id,'bookings.manage'))
with check(public.has_capability(organisation_id,venue_id,'bookings.manage'));
create policy supplier_contract_write on public.supplier_contracts for all
using(public.has_capability(organisation_id,venue_id,'suppliers.manage'))
with check(public.has_capability(organisation_id,venue_id,'suppliers.manage'));
create policy compliance_staff_write on public.staff_profiles for all
using(public.has_capability(organisation_id,null,'compliance.manage'))
with check(public.has_capability(organisation_id,null,'compliance.manage'));
create policy compliance_incident_write on public.staff_incidents for all
using(public.has_capability(organisation_id,venue_id,'compliance.manage'))
with check(public.has_capability(organisation_id,venue_id,'compliance.manage'));
create policy compliance_staff_read on public.staff_profiles for select
using(public.has_capability(organisation_id,null,'compliance.manage'));
create policy compliance_assignment_read on public.staff_venue_assignments for select
using(public.has_capability(organisation_id,venue_id,'compliance.manage'));
create policy compliance_policy_read on public.compliance_policies for select
using(public.has_capability(organisation_id,null,'compliance.manage'));
create policy compliance_ack_read on public.staff_policy_acknowledgements for select
using(public.has_capability(organisation_id,null,'compliance.manage'));
create policy compliance_incident_read on public.staff_incidents for select
using(public.has_capability(organisation_id,venue_id,'compliance.manage'));
create policy compliance_assignment_write on public.staff_venue_assignments for all
using(public.has_capability(organisation_id,venue_id,'compliance.manage'))
with check(public.has_capability(organisation_id,venue_id,'compliance.manage'));
create policy compliance_policy_write on public.compliance_policies for all
using(public.has_capability(organisation_id,null,'compliance.manage'))
with check(public.has_capability(organisation_id,null,'compliance.manage'));
create policy compliance_ack_write on public.staff_policy_acknowledgements for all
using(public.has_capability(organisation_id,null,'compliance.manage'))
with check(public.has_capability(organisation_id,null,'compliance.manage'));

alter table public.staff_profiles enable row level security;
alter table public.staff_venue_assignments enable row level security;
alter table public.compliance_policies enable row level security;
alter table public.staff_policy_acknowledgements enable row level security;
alter table public.staff_incidents enable row level security;

create policy booking_quote_write on public.booking_quotes for insert
with check(public.has_capability(organisation_id,venue_id,'bookings.manage'));
create policy booking_deposit_write on public.booking_deposits for all
using(public.has_capability(organisation_id,venue_id,'bookings.manage'))
with check(public.has_capability(organisation_id,venue_id,'bookings.manage'));
create policy supplier_contract_version_write on public.supplier_contract_versions for insert
with check(public.has_capability(organisation_id,null,'suppliers.manage'));
create policy discrepancy_write on public.contract_discrepancies for all
using(public.has_capability(organisation_id,venue_id,'suppliers.manage'))
with check(public.has_capability(organisation_id,venue_id,'suppliers.manage'));
create policy event_yield_write on public.event_yield_scenarios for insert
with check(public.has_capability(organisation_id,venue_id,'events.manage'));
create policy event_outcome_write on public.event_forecast_outcomes for all
using(public.has_capability(organisation_id,venue_id,'events.manage'))
with check(public.has_capability(organisation_id,venue_id,'events.manage'));

grant select on public.capability_permissions,public.role_capabilities to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function public.has_capability(uuid,uuid,text) to authenticated;
grant execute on function public.transition_close(uuid,public.close_status,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('contracts','contracts',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp']),
('staff-certificates','staff-certificates',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']),
('staff-documents','staff-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']),
('exports','exports',false,52428800,array['text/csv','application/pdf','application/zip'])
on conflict(id) do update set public=false;

create policy storage_os_member_read on storage.objects for select
using (
  bucket_id in ('contracts','staff-certificates','staff-documents','exports')
  and public.is_member((storage.foldername(name))[1]::uuid)
  and (
    bucket_id not in ('staff-certificates','staff-documents')
    or public.has_capability((storage.foldername(name))[1]::uuid,null,'compliance.manage')
  )
);
create policy storage_os_write on storage.objects for insert
with check (
  bucket_id in ('contracts','staff-certificates','staff-documents','exports')
  and (
    (bucket_id='contracts' and public.has_capability((storage.foldername(name))[1]::uuid,null,'suppliers.manage'))
    or (bucket_id in ('staff-certificates','staff-documents') and public.has_capability((storage.foldername(name))[1]::uuid,null,'compliance.manage'))
    or (bucket_id='exports' and public.has_capability((storage.foldername(name))[1]::uuid,null,'exports.create'))
  )
);

commit;
