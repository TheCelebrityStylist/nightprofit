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
