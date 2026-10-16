-- =====================================================================
-- NightProfit — complete database setup (Supabase SQL editor)
-- Paste this whole file into SQL Editor → New query → Run.
-- Runs once on an EMPTY NightProfit project. It stops immediately and
-- changes nothing if NightProfit is already installed.
-- Generated from supabase/migrations/* — do not edit by hand.
-- =====================================================================
do $guard$ begin
  if to_regclass('public.organisations') is not null then
    raise exception 'NightProfit is already installed in this project. Run nightprofit_roster_only.sql instead.';
  end if;
end $guard$;

-- ---------------------------------------------------------------------
-- 20260727000100_initial_production.sql
-- ---------------------------------------------------------------------
begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create type public.member_role as enum ('owner','administrator','manager','bookkeeper','viewer');
create type public.close_status as enum ('draft','submitted','approved','reopened','locked');
create type public.invoice_status as enum ('uploaded','extracting','needs_review','confirmed','failed','archived');
create type public.alert_status as enum ('open','reviewing','resolved');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, locale text not null default 'nl-NL', timezone text not null default 'Europe/Amsterdam',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organisations (
  id uuid primary key default gen_random_uuid(), name text not null, legal_name text, country char(2) not null default 'NL',
  currency char(3) not null default 'EUR', locale text not null default 'nl-NL', timezone text not null default 'Europe/Amsterdam',
  vat_basis_points integer not null default 2100 check(vat_basis_points between 0 and 10000),
  onboarding_step integer not null default 1 check(onboarding_step between 1 and 6), onboarding_completed_at timestamptz,
  ai_enabled boolean not null default false, document_retention_days integer not null default 2555 check(document_retention_days between 30 and 3650),
  stripe_customer_id text unique, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organisation_members (
  organisation_id uuid not null references public.organisations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null, venue_ids uuid[], approved_closes boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(organisation_id,user_id)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  email citext not null, role public.member_role not null, token_hash text not null unique, invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null, accepted_at timestamptz, created_at timestamptz not null default now(), unique(organisation_id,email)
);
create table public.venues (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, venue_type text not null, address jsonb not null default '{}', timezone text not null default 'Europe/Amsterdam',
  trading_cutoff time not null default '06:00', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,name)
);
create table public.venue_settings (
  venue_id uuid primary key references public.venues(id) on delete cascade, organisation_id uuid not null references public.organisations(id) on delete cascade,
  opening_days smallint[] not null default '{4,5,6}', approval_required boolean not null default true, enabled_sources text[] not null default '{}',
  recurring_costs jsonb not null default '{}', thresholds jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.feature_entitlements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  feature text not null, enabled boolean not null default false, source text not null, valid_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,feature)
);
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete cascade, code text not null, label text not null, kind text not null, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,venue_id,code)
);
create table public.payment_terminals (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade, name text not null, provider text, external_id text, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(venue_id,name)
);
create table public.closing_sessions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade, trading_date date not null, event_id uuid,
  status public.close_status not null default 'draft', expected_total_minor bigint not null default 0, accounted_total_minor bigint not null default 0,
  difference_minor bigint generated always as (accounted_total_minor-expected_total_minor) stored, difference_basis_points integer not null default 0,
  submitted_by uuid references auth.users(id), submitted_at timestamptz, approved_by uuid references auth.users(id), approved_at timestamptz,
  locked_at timestamptz, reopened_reason text, version integer not null default 1, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(venue_id,trading_date,version)
);
create table public.closing_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  closing_session_id uuid not null references public.closing_sessions(id) on delete cascade, line_type text not null, source_id uuid,
  expected_minor bigint not null default 0, actual_minor bigint not null default 0, quantity numeric(18,6), metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.cash_counts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  closing_session_id uuid not null references public.closing_sessions(id) on delete cascade, denomination_minor bigint not null check(denomination_minor>0),
  quantity integer not null check(quantity>=0), total_minor bigint generated always as (denomination_minor*quantity) stored, created_at timestamptz not null default now(),
  unique(closing_session_id,denomination_minor)
);
create table public.close_comments (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  closing_session_id uuid not null references public.closing_sessions(id) on delete cascade, author_id uuid not null references auth.users(id),
  kind text not null default 'comment', body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now()
);
create table public.close_snapshots (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  closing_session_id uuid not null unique references public.closing_sessions(id) on delete restrict, snapshot jsonb not null, content_hash text not null unique,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade, name text not null, concept text, event_type text not null,
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at), expected_attendance integer check(expected_attendance>=0),
  actual_attendance integer check(actual_attendance>=0), notes text, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.closing_sessions add constraint closing_sessions_event_fk foreign key(event_id) references public.events(id) on delete set null;
create table public.event_forecasts (
  event_id uuid primary key references public.events(id) on delete cascade, organisation_id uuid not null references public.organisations(id) on delete cascade,
  revenue_minor bigint not null default 0, direct_cost_minor bigint not null default 0, attendance integer check(attendance>=0),
  assumptions jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_revenue (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade, type text not null, gross_minor bigint not null, vat_minor bigint not null default 0,
  evidence_type text, evidence_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_costs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade, type text not null, amount_minor bigint not null, percentage_basis_points integer,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_staff_costs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade, role text not null, hours numeric(10,2) not null check(hours>=0),
  hourly_cost_minor bigint not null check(hourly_cost_minor>=0), total_minor bigint not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organiser_agreements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  event_id uuid not null unique references public.events(id) on delete cascade, organiser_name text not null, payout_basis text not null,
  minimum_guarantee_minor bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organiser_payout_tiers (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  agreement_id uuid not null references public.organiser_agreements(id) on delete cascade, from_minor bigint not null, to_minor bigint,
  rate_basis_points integer not null check(rate_basis_points between 0 and 10000), check(to_minor is null or to_minor>from_minor), unique(agreement_id,from_minor)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, vat_number text, email citext, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,name)
);
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id), supplier_id uuid references public.suppliers(id), invoice_number text, invoice_date date, currency char(3) not null default 'EUR',
  status public.invoice_status not null default 'uploaded', storage_path text not null, file_hash text not null, file_name text not null, mime_type text not null,
  file_size bigint not null check(file_size between 1 and 15728640), net_total_minor bigint, vat_total_minor bigint, gross_total_minor bigint,
  original_extraction jsonb, corrected_values jsonb, extraction_confidence integer check(extraction_confidence between 0 and 10000),
  created_by uuid not null references auth.users(id), confirmed_by uuid references auth.users(id), confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,file_hash)
);
create table public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade, product_id uuid, description text not null, sku text,
  quantity numeric(18,6) not null check(quantity>0), package_size numeric(18,6), unit text, net_unit_cost_minor bigint not null,
  vat_basis_points integer not null default 2100, gross_line_total_minor bigint not null, original_values jsonb, corrected boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id), name text not null, brand text, category text not null, sku text, barcode text,
  package_quantity numeric(18,6) not null default 1, unit_volume_ml numeric(18,6), deposit_minor bigint not null default 0,
  purchase_unit text not null, serving_unit text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,name)
);
alter table public.supplier_invoice_lines add constraint supplier_invoice_lines_product_fk foreign key(product_id) references public.products(id) on delete set null;
create table public.product_cost_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, effective_at timestamptz not null, net_cost_minor bigint not null,
  vat_basis_points integer not null, deposit_minor bigint not null default 0, source_invoice_line_id uuid references public.supplier_invoice_lines(id),
  created_at timestamptz not null default now(), unique(product_id,effective_at)
);
create table public.menu_items (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete cascade, name text not null, category text not null, target_margin_basis_points integer not null default 7400,
  active_from date not null default current_date, active_until date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,venue_id,name)
);
create table public.menu_item_components (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade, product_id uuid not null references public.products(id),
  quantity numeric(18,6) not null check(quantity>0), unit text not null, waste_basis_points integer not null default 0 check(waste_basis_points between 0 and 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.menu_price_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade, effective_at timestamptz not null, gross_price_minor bigint not null,
  vat_basis_points integer not null, direct_cost_snapshot_minor bigint not null, margin_snapshot_basis_points integer not null,
  created_at timestamptz not null default now(), unique(menu_item_id,effective_at)
);
create table public.data_imports (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id), type text not null, status text not null, storage_path text not null, file_hash text not null,
  file_name text not null, locale text, delimiter char(1), encoding text, row_count integer, imported_count integer, rejected_count integer,
  created_by uuid not null references auth.users(id), confirmed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organisation_id,type,file_hash)
);
create table public.data_import_mappings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  import_type text not null, provider text not null default 'generic_csv', name text not null, mapping jsonb not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organisation_id,import_type,name)
);
create table public.data_import_errors (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  import_id uuid not null references public.data_imports(id) on delete cascade, row_number integer not null, field text, code text not null, message text not null,
  rejected_row jsonb not null, created_at timestamptz not null default now()
);
create table public.alerts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id), type text not null, severity text not null check(severity in ('info','warning','critical')),
  measured jsonb not null, comparison jsonb, impact_minor bigint, evidence jsonb not null, possible_explanations text[] not null default '{}',
  recommended_checks text[] not null default '{}', status public.alert_status not null default 'open', assignee_id uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.alert_resolutions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  alert_id uuid not null references public.alerts(id) on delete cascade, actor_id uuid not null references auth.users(id), action text not null,
  note text not null, created_at timestamptz not null default now()
);
create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid references public.venues(id), trading_date date not null, metrics jsonb not null, evidence_ids jsonb not null,
  content_hash text not null unique, created_at timestamptz not null default now(), unique(venue_id,trading_date)
);
create table public.daily_briefings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null references public.venues(id), metric_snapshot_id uuid not null references public.metric_snapshots(id),
  content jsonb not null, generated_by text not null, model text, prompt_version text, confidence integer not null check(confidence between 0 and 10000),
  created_at timestamptz not null default now(), unique(venue_id,metric_snapshot_id)
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null unique references public.organisations(id) on delete cascade,
  stripe_customer_id text not null, stripe_subscription_id text unique, plan text not null, status text not null, venue_quantity integer not null default 1 check(venue_quantity>0),
  current_period_end timestamptz, cancel_at_period_end boolean not null default false, grace_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.stripe_webhook_events (
  stripe_event_id text primary key, event_type text not null, created_at_stripe timestamptz not null, payload_hash text not null,
  processing_status text not null, processed_at timestamptz, error_code text, received_at timestamptz not null default now()
);
create table public.job_runs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid references public.organisations(id) on delete cascade, venue_id uuid references public.venues(id),
  job_type text not null, idempotency_key text not null unique, status text not null, attempt integer not null default 0, next_retry_at timestamptz,
  error_code text, started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade, organisation_id uuid not null references public.organisations(id) on delete cascade,
  close_events boolean not null default true, material_alerts boolean not null default true, daily_briefing boolean not null default true,
  supplier_alerts boolean not null default true, billing_events boolean not null default true, updated_at timestamptz not null default now(), primary key(user_id,organisation_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  venue_id uuid references public.venues(id), actor_id uuid references auth.users(id), action text not null, entity_type text not null,
  entity_id uuid not null, before_summary jsonb, after_summary jsonb, correlation_id uuid not null, source text not null, created_at timestamptz not null default now()
);
create table public.data_export_requests (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  requested_by uuid not null references auth.users(id), status text not null default 'requested', storage_path text, expires_at timestamptz,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  requested_by uuid not null references auth.users(id), scope text not null, status text not null default 'requested', confirmation_hash text,
  scheduled_for timestamptz, created_at timestamptz not null default now(), completed_at timestamptz
);

create index on public.organisation_members(user_id,organisation_id);
create index on public.venues(organisation_id);
create index on public.closing_sessions(organisation_id,venue_id,trading_date desc);
create index on public.events(organisation_id,venue_id,starts_at desc);
create index on public.product_cost_history(product_id,effective_at desc);
create index on public.alerts(organisation_id,status,severity,created_at desc);
create index on public.audit_logs(organisation_id,created_at desc);

create function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['profiles','organisations','organisation_members','venues','venue_settings','feature_entitlements','payment_methods','payment_terminals','closing_sessions','closing_lines','events','event_forecasts','event_revenue','event_costs','event_staff_costs','organiser_agreements','suppliers','supplier_invoices','supplier_invoice_lines','products','menu_items','menu_item_components','data_imports','data_import_mappings','alerts','subscriptions','job_runs'] loop execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()',t,t); end loop; end $$;
create function public.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organisation_members m where m.organisation_id=org and m.user_id=auth.uid()) $$;
create function public.has_role(org uuid, allowed public.member_role[]) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organisation_members m where m.organisation_id=org and m.user_id=auth.uid() and m.role=any(allowed)) $$;
create function public.is_venue_member(org uuid, venue uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organisation_members m where m.organisation_id=org and m.user_id=auth.uid() and (m.venue_ids is null or venue=any(m.venue_ids))) $$;
create function public.prevent_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'immutable_record'; end $$;
create trigger immutable_close_snapshots before update or delete on public.close_snapshots for each row execute function public.prevent_mutation();
create trigger append_only_audit before update or delete on public.audit_logs for each row execute function public.prevent_mutation();
create function public.create_organisation(org_name text, venue_name text) returns uuid language plpgsql security definer set search_path='' as $$ declare oid uuid; begin if auth.uid() is null then raise exception 'unauthenticated'; end if; insert into public.organisations(name,created_by) values(org_name,auth.uid()) returning id into oid; insert into public.organisation_members(organisation_id,user_id,role) values(oid,auth.uid(),'owner'); if venue_name is not null and length(trim(venue_name))>0 then insert into public.venues(organisation_id,name,venue_type) values(oid,venue_name,'nightclub'); end if; return oid; end $$;

do $$ declare t text; begin foreach t in array array['organisation_members','invitations','venues','venue_settings','feature_entitlements','payment_methods','payment_terminals','closing_sessions','closing_lines','cash_counts','close_comments','close_snapshots','events','event_forecasts','event_revenue','event_costs','event_staff_costs','organiser_agreements','organiser_payout_tiers','suppliers','supplier_invoices','supplier_invoice_lines','products','product_cost_history','menu_items','menu_item_components','menu_price_history','data_imports','data_import_mappings','data_import_errors','alerts','alert_resolutions','metric_snapshots','daily_briefings','subscriptions','job_runs','notification_preferences','audit_logs','data_export_requests','data_deletion_requests'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I_member_select on public.%I for select using (public.is_member(organisation_id))',t,t); execute format('create policy %I_staff_insert on public.%I for insert with check (public.has_role(organisation_id,array[''owner'',''administrator'',''manager'',''bookkeeper'']::public.member_role[]))',t,t); execute format('create policy %I_staff_update on public.%I for update using (public.has_role(organisation_id,array[''owner'',''administrator'',''manager'',''bookkeeper'']::public.member_role[])) with check (public.has_role(organisation_id,array[''owner'',''administrator'',''manager'',''bookkeeper'']::public.member_role[]))',t,t); execute format('create policy %I_admin_delete on public.%I for delete using (public.has_role(organisation_id,array[''owner'',''administrator'']::public.member_role[]))',t,t); end loop; end $$;
alter table public.organisations enable row level security;
create policy organisations_member_select on public.organisations for select using(public.is_member(id));
create policy organisations_admin_update on public.organisations for update using(public.has_role(id,array['owner','administrator']::public.member_role[])) with check(public.has_role(id,array['owner','administrator']::public.member_role[]));
create policy organisations_owner_delete on public.organisations for delete using(public.has_role(id,array['owner']::public.member_role[]));
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for all using(id=auth.uid()) with check(id=auth.uid());
alter table public.stripe_webhook_events enable row level security;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('invoices','invoices',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp']),
('imports','imports',false,10485760,array['text/csv','text/plain','application/csv'])
on conflict(id) do update set public=false;
create policy storage_member_read on storage.objects for select using (bucket_id in ('invoices','imports') and public.is_member((storage.foldername(name))[1]::uuid));
create policy storage_staff_insert on storage.objects for insert with check (bucket_id in ('invoices','imports') and public.has_role((storage.foldername(name))[1]::uuid,array['owner','administrator','manager','bookkeeper']::public.member_role[]));
create policy storage_admin_delete on storage.objects for delete using (bucket_id in ('invoices','imports') and public.has_role((storage.foldername(name))[1]::uuid,array['owner','administrator']::public.member_role[]));

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id,full_name) values(new.id,new.raw_user_meta_data->>'full_name') on conflict(id) do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

commit;

-- ---------------------------------------------------------------------
-- 20260727000200_harden_permissions.sql
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 20260727000300_api_grants.sql
-- ---------------------------------------------------------------------
begin;
-- Explicit Data API privileges. The project intentionally has automatic
-- table exposure disabled, so grants are declared and reviewed in migrations.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 20260728000000_role_vocabulary.sql
-- ---------------------------------------------------------------------
begin;
alter type public.member_role add value if not exists 'venue_manager';
alter type public.member_role add value if not exists 'finance';
alter type public.member_role add value if not exists 'bookings';
alter type public.member_role add value if not exists 'procurement';
alter type public.member_role add value if not exists 'compliance_manager';

commit;

-- ---------------------------------------------------------------------
-- 20260728000100_nightprofit_os_foundation.sql
-- ---------------------------------------------------------------------
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
      encode(extensions.digest(convert_to(snapshot_data::text,'UTF8'),'sha256'),'hex'),auth.uid()
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

-- ---------------------------------------------------------------------
-- 20261016000100_team_roster.sql
-- ---------------------------------------------------------------------
-- Team & Roster: employees, shifts, availability, leave/sickness and
-- immutable, versioned week publications. Money in integer minor units.
begin;

create extension if not exists btree_gist with schema extensions;

insert into public.capability_permissions(capability,description) values
('roster.view','View rosters, availability and labour cost'),
('roster.manage','Edit employees, shifts, availability and leave requests'),
('roster.publish','Publish roster weeks and decide on leave')
on conflict(capability) do update set description=excluded.description;

insert into public.role_capabilities(role,capability) values
('owner','roster.view'),('owner','roster.manage'),('owner','roster.publish'),
('administrator','roster.view'),('administrator','roster.manage'),('administrator','roster.publish'),
('manager','roster.view'),('manager','roster.manage'),('manager','roster.publish'),
('venue_manager','roster.view'),('venue_manager','roster.manage'),('venue_manager','roster.publish'),
('finance','roster.view'),('bookkeeper','roster.view')
on conflict do nothing;

create table public.roster_employees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{8,20}$'),
  email citext,
  default_role text not null default 'bar' check (length(btrim(default_role)) between 1 and 40),
  hourly_cost_minor bigint not null default 0 check (hourly_cost_minor between 0 and 100000),
  contract_minutes_week integer check (contract_minutes_week is null or contract_minutes_week between 0 and 4800),
  active boolean not null default true,
  notes text check (notes is null or length(notes)<=500),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,id)
);
create index roster_employees_org_idx on public.roster_employees(organisation_id,active,full_name);

create table public.roster_shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  service_date date not null,
  employee_id uuid,
  role text not null default 'bar' check (length(btrim(role)) between 1 and 40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 180),
  hourly_cost_minor bigint not null default 0 check (hourly_cost_minor between 0 and 100000),
  notes text check (notes is null or length(notes)<=500),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  published_version integer,
  changed_since_publish boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id) on delete cascade,
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete restrict,
  constraint roster_shift_window check (ends_at > starts_at and ends_at - starts_at <= interval '16 hours'),
  constraint roster_shift_break check (break_minutes * interval '1 minute' < ends_at - starts_at),
  constraint roster_no_double_booking exclude using gist (
    employee_id with =, tstzrange(starts_at,ends_at,'[)') with &&
  ) where (employee_id is not null and status='scheduled')
);
create index roster_shifts_week_idx on public.roster_shifts(venue_id,service_date);
create index roster_shifts_employee_idx on public.roster_shifts(employee_id,service_date);

create table public.roster_availability (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null,
  service_date date not null,
  status text not null check (status in ('available','preferred','unavailable')),
  note text check (note is null or length(note)<=300),
  source text not null default 'manager' check (source in ('manager','whatsapp','phone','self')),
  recorded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id,service_date),
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete cascade
);

create table public.roster_leave (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null,
  kind text not null check (kind in ('leave','sick','other')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  note text check (note is null or length(note)<=300),
  requested_by uuid references auth.users(id) default auth.uid(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 366),
  foreign key(organisation_id,employee_id) references public.roster_employees(organisation_id,id) on delete cascade
);
create index roster_leave_range_idx on public.roster_leave(organisation_id,starts_on,ends_on);

create table public.roster_publications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  venue_id uuid not null,
  week_start date not null check (extract(isodow from week_start)=1),
  version integer not null check (version>0),
  shift_count integer not null,
  open_shift_count integer not null,
  paid_minutes bigint not null,
  labour_cost_minor bigint not null,
  snapshot jsonb not null,
  content_hash text not null,
  note text,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique(venue_id,week_start,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id) on delete restrict
);
create trigger immutable_roster_publications before update or delete on public.roster_publications
for each row execute function public.prevent_mutation();

-- Deterministic cost rule shared with lib/roster.ts: paid minutes x hourly
-- cost / 60, rounded half up, integer arithmetic only.
create or replace function public.roster_shift_cost_minor(paid_minutes bigint, hourly_cost_minor bigint)
returns bigint language sql immutable set search_path='' as $$
  select ((paid_minutes*hourly_cost_minor*2)+60)/120
$$;
create or replace function public.roster_paid_minutes(starts_at timestamptz, ends_at timestamptz, break_minutes integer)
returns bigint language sql immutable set search_path='' as $$
  select (extract(epoch from (ends_at-starts_at))::bigint/60) - break_minutes
$$;

create or replace function public.roster_shift_guard() returns trigger
language plpgsql set search_path='' as $$
declare venue_tz text; local_day date; employee_rate bigint; employee_active boolean;
begin
  if tg_op='DELETE' then
    if old.published_version is not null then
      raise exception 'PUBLISHED_SHIFT_CANNOT_BE_DELETED' using hint='Cancel the shift and republish the week.';
    end if;
    return old;
  end if;

  select timezone into venue_tz from public.venues where id=new.venue_id and organisation_id=new.organisation_id;
  if venue_tz is null then raise exception 'VENUE_NOT_FOUND'; end if;
  local_day := (new.starts_at at time zone venue_tz)::date;
  if local_day not in (new.service_date, new.service_date+1) then
    raise exception 'SHIFT_OUTSIDE_SERVICE_DATE';
  end if;

  if new.employee_id is not null and (tg_op='INSERT' or new.employee_id is distinct from old.employee_id) then
    select hourly_cost_minor, active into employee_rate, employee_active
    from public.roster_employees where id=new.employee_id and organisation_id=new.organisation_id;
    if employee_active is distinct from true then raise exception 'EMPLOYEE_INACTIVE'; end if;
    new.hourly_cost_minor := employee_rate;
  end if;

  if tg_op='INSERT' then
    new.published_version := null;
    new.changed_since_publish := true;
  elsif new.published_version is not distinct from old.published_version then
    if (new.employee_id, new.role, new.starts_at, new.ends_at, new.break_minutes, new.status, new.service_date, new.notes, new.hourly_cost_minor)
       is distinct from
       (old.employee_id, old.role, old.starts_at, old.ends_at, old.break_minutes, old.status, old.service_date, old.notes, old.hourly_cost_minor) then
      new.changed_since_publish := true;
    else
      new.changed_since_publish := old.changed_since_publish;
    end if;
  elsif current_setting('nightprofit.roster_publish', true) is distinct from 'on' then
    raise exception 'PUBLICATION_STATE_IS_SYSTEM_MANAGED';
  end if;
  return new;
end $$;
create trigger roster_shift_guard before insert or update or delete on public.roster_shifts
for each row execute function public.roster_shift_guard();

create or replace function public.roster_leave_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.kind='sick' then
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
    elsif new.status<>'requested' then
      if not public.has_capability(new.organisation_id,null,'roster.publish') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    else
      new.decided_by := null; new.decided_at := null;
    end if;
  elsif new.status is distinct from old.status then
    if old.kind<>'sick' and not public.has_capability(new.organisation_id,null,'roster.publish') then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
    new.decided_by := case when new.status='requested' then null else auth.uid() end;
    new.decided_at := case when new.status='requested' then null else now() end;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;
create trigger roster_leave_guard before insert or update on public.roster_leave
for each row execute function public.roster_leave_guard();

do $$ declare t text; begin
  foreach t in array array['roster_employees','roster_shifts','roster_availability','roster_leave'] loop
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()',t,t);
  end loop;
end $$;

-- Append-only audit of every roster mutation, written by the database itself.
create or replace function public.roster_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; before_data jsonb; after_data jsonb; venue uuid;
begin
  if tg_op='DELETE' then row_data := to_jsonb(old); else row_data := to_jsonb(new); end if;
  before_data := case when tg_op='INSERT' then null else to_jsonb(old) - 'phone' - 'email' - 'hourly_cost_minor' - 'notes' end;
  after_data := case when tg_op='DELETE' then null else to_jsonb(new) - 'phone' - 'email' - 'hourly_cost_minor' - 'notes' end;
  venue := nullif(row_data->>'venue_id','')::uuid;
  insert into public.audit_logs(organisation_id,venue_id,actor_id,action,entity_type,entity_id,before_summary,after_summary,correlation_id,source)
  values((row_data->>'organisation_id')::uuid, venue, auth.uid(), tg_table_name||'.'||lower(tg_op), tg_table_name,
         (row_data->>'id')::uuid, before_data, after_data, gen_random_uuid(), 'database');
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['roster_employees','roster_shifts','roster_leave'] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.roster_audit()',t,t);
  end loop;
end $$;

create or replace function public.publish_roster_week(target_venue_id uuid, target_week_start date, publish_note text default null)
returns public.roster_publications
language plpgsql security definer set search_path='' as $$
declare
  target_venue public.venues;
  next_version integer;
  pending integer;
  shifts_json jsonb;
  totals record;
  snapshot_data jsonb;
  result public.roster_publications;
begin
  select * into target_venue from public.venues where id=target_venue_id;
  if target_venue.id is null then raise exception 'VENUE_NOT_FOUND'; end if;
  if not public.has_capability(target_venue.organisation_id,target_venue.id,'roster.publish') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if extract(isodow from target_week_start)<>1 then raise exception 'WEEK_START_NOT_MONDAY'; end if;
  if publish_note is not null and length(publish_note)>300 then raise exception 'NOTE_TOO_LONG'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_venue_id::text||':'||target_week_start::text,0));

  select coalesce(max(version),0)+1 into next_version from public.roster_publications
  where venue_id=target_venue_id and week_start=target_week_start;

  select count(*) into pending from public.roster_shifts
  where venue_id=target_venue_id and service_date between target_week_start and target_week_start+6
    and changed_since_publish
    and (status='scheduled' or published_version is not null);
  if pending=0 then raise exception 'NO_CHANGES_TO_PUBLISH'; end if;

  select count(*)::integer as shift_count,
         count(*) filter (where s.employee_id is null)::integer as open_count,
         coalesce(sum(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes)),0)::bigint as minutes,
         coalesce(sum(public.roster_shift_cost_minor(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),s.hourly_cost_minor)),0)::bigint as cost
  into totals
  from public.roster_shifts s
  where s.venue_id=target_venue_id and s.service_date between target_week_start and target_week_start+6 and s.status='scheduled';

  select coalesce(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'service_date',s.service_date,'employee_id',s.employee_id,'employee_name',e.full_name,
    'role',s.role,'starts_at',s.starts_at,'ends_at',s.ends_at,'break_minutes',s.break_minutes,
    'hourly_cost_minor',s.hourly_cost_minor,
    'paid_minutes',public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),
    'cost_minor',public.roster_shift_cost_minor(public.roster_paid_minutes(s.starts_at,s.ends_at,s.break_minutes),s.hourly_cost_minor),
    'notes',s.notes
  ) order by s.starts_at,s.id),'[]'::jsonb)
  into shifts_json
  from public.roster_shifts s left join public.roster_employees e on e.id=s.employee_id
  where s.venue_id=target_venue_id and s.service_date between target_week_start and target_week_start+6 and s.status='scheduled';

  snapshot_data := jsonb_build_object(
    'schema_version','1','venue_id',target_venue.id,'venue_name',target_venue.name,'timezone',target_venue.timezone,
    'week_start',target_week_start,'version',next_version,'currency_minor_units',true,'shifts',shifts_json);

  insert into public.roster_publications(organisation_id,venue_id,week_start,version,shift_count,open_shift_count,
    paid_minutes,labour_cost_minor,snapshot,content_hash,note,published_by)
  values(target_venue.organisation_id,target_venue.id,target_week_start,next_version,totals.shift_count,totals.open_count,
    totals.minutes,totals.cost,snapshot_data,
    encode(extensions.digest(convert_to(snapshot_data::text,'UTF8'),'sha256'),'hex'),publish_note,auth.uid())
  returning * into result;

  perform set_config('nightprofit.roster_publish','on',true);
  update public.roster_shifts set published_version=next_version, changed_since_publish=false
  where venue_id=target_venue_id and service_date between target_week_start and target_week_start+6 and changed_since_publish;
  perform set_config('nightprofit.roster_publish','off',true);

  insert into public.audit_logs(organisation_id,venue_id,actor_id,action,entity_type,entity_id,after_summary,correlation_id,source)
  values(target_venue.organisation_id,target_venue.id,auth.uid(),'roster.published','roster_publication',result.id,
    jsonb_build_object('week_start',target_week_start,'version',next_version,'shift_count',totals.shift_count,
      'labour_cost_minor',totals.cost,'content_hash',result.content_hash),gen_random_uuid(),'database');
  return result;
end $$;

alter table public.roster_employees enable row level security;
alter table public.roster_shifts enable row level security;
alter table public.roster_availability enable row level security;
alter table public.roster_leave enable row level security;
alter table public.roster_publications enable row level security;

create policy roster_employees_read on public.roster_employees for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_employees_write on public.roster_employees for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_shifts_read on public.roster_shifts for select
using(public.has_capability(organisation_id,venue_id,'roster.view'));
create policy roster_shifts_write on public.roster_shifts for all
using(public.has_capability(organisation_id,venue_id,'roster.manage'))
with check(public.has_capability(organisation_id,venue_id,'roster.manage'));

create policy roster_availability_read on public.roster_availability for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_availability_write on public.roster_availability for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_leave_read on public.roster_leave for select
using(public.has_capability(organisation_id,null,'roster.view'));
create policy roster_leave_write on public.roster_leave for all
using(public.has_capability(organisation_id,null,'roster.manage'))
with check(public.has_capability(organisation_id,null,'roster.manage'));

create policy roster_publications_read on public.roster_publications for select
using(public.has_capability(organisation_id,venue_id,'roster.view'));

grant select, insert, update, delete on public.roster_employees, public.roster_shifts,
  public.roster_availability, public.roster_leave to authenticated;
grant select on public.roster_publications to authenticated;
revoke insert, update, delete on public.roster_publications from authenticated;
grant all privileges on public.roster_employees, public.roster_shifts, public.roster_availability,
  public.roster_leave, public.roster_publications to service_role;
revoke execute on function public.roster_shift_guard() from public, authenticated;
revoke execute on function public.roster_leave_guard() from public, authenticated;
revoke execute on function public.roster_audit() from public, authenticated;
grant execute on function public.publish_roster_week(uuid,date,text) to authenticated;
grant execute on function public.roster_paid_minutes(timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.roster_shift_cost_minor(bigint,bigint) to authenticated;

commit;

select 'NightProfit setup complete' as result;
