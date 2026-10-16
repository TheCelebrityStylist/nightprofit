begin;

create table public.pos_imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  connector_key text not null default 'pos_csv',
  trading_date date not null,
  status text not null check(status in ('uploaded','previewed','dry_run','confirmed','processed','rejected','superseded')),
  file_hash text not null check(file_hash~'^[0-9a-f]{64}$'),
  storage_object_id uuid,
  original_filename text not null,
  delimiter text check(delimiter in (',',';',E'\t')),
  number_locale text check(number_locale in ('nl-NL','en-US')),
  column_mapping jsonb not null default '{}'::jsonb,
  accepted_rows integer not null default 0 check(accepted_rows>=0),
  rejected_rows integer not null default 0 check(rejected_rows>=0),
  replacement_for_id uuid references public.pos_imports(id),
  immutable_evidence jsonb,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create unique index pos_imports_active_hash_unique
  on public.pos_imports(organisation_id,connector_key,file_hash)
  where status<>'superseded';

create table public.pos_rejected_rows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  import_id uuid not null,
  source_row_number integer not null check(source_row_number>1),
  error_code text not null,
  safe_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,import_id) references public.pos_imports(organisation_id,id) on delete restrict
);

create table public.normalized_sales (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  import_id uuid not null,
  source_row_number integer not null check(source_row_number>1),
  external_transaction_id text,
  external_line_id text,
  transaction_at timestamptz not null,
  trading_date date not null,
  terminal text,
  pos_product_name text not null,
  pos_product_id text,
  pos_category text,
  quantity numeric(20,6) not null,
  gross_minor bigint not null,
  net_minor bigint not null,
  vat_minor bigint not null,
  discount_minor bigint not null default 0,
  void_minor bigint not null default 0,
  refund_minor bigint not null default 0,
  complimentary_minor bigint not null default 0,
  payment_method text,
  event_reference text,
  mapping_id uuid references public.source_mappings(id),
  mapping_version integer,
  created_at timestamptz not null default now(),
  unique(organisation_id,import_id,source_row_number),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,import_id) references public.pos_imports(organisation_id,id) on delete restrict
);

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  name text not null,
  location_type text not null check(location_type in ('bar','stockroom','cellar','kitchen','other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  location_id uuid not null,
  trading_date date not null,
  count_type text not null check(count_type in ('opening','closing','delivery_verification','spot_check','full_location')),
  status text not null default 'draft' check(status in ('draft','submitted','under_review','posted','cancelled')),
  counted_at timestamptz not null,
  counter_id uuid not null references auth.users(id),
  submitted_at timestamptz,
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  notes text,
  version integer not null default 1 check(version>0),
  corrects_count_id uuid references public.stock_counts(id),
  immutable_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,id),
  unique(organisation_id,venue_id,location_id,trading_date,count_type,version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,venue_id,location_id) references public.stock_locations(organisation_id,venue_id,id)
);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  count_id uuid not null,
  product_id uuid not null,
  packages numeric(20,6) not null default 0 check(packages>=0),
  complete_units numeric(20,6) not null default 0 check(complete_units>=0),
  partial_basis_points integer not null default 0 check(partial_basis_points between 0 and 10000),
  exact_quantity numeric(20,6) not null check(exact_quantity>=0),
  expected_quantity numeric(20,6),
  missing_expected boolean not null default false,
  correction_reason text,
  created_at timestamptz not null default now(),
  unique(organisation_id,count_id,product_id),
  foreign key(organisation_id,count_id) references public.stock_counts(organisation_id,id) on delete restrict,
  foreign key(organisation_id,product_id) references public.products(organisation_id,id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  trading_date date not null,
  movement_type text not null check(movement_type in ('opening','receipt','supplier_return','transfer_in','transfer_out','closing','waste','breakage','complimentary','staff_consumption','sampling','preparation','approved_correction')),
  quantity numeric(20,6) not null,
  source_type text not null,
  source_id uuid not null,
  idempotency_key text not null,
  correction_of_id uuid references public.stock_movements(id),
  evidence jsonb not null default '{}'::jsonb,
  posted_by uuid not null references auth.users(id),
  posted_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,venue_id,location_id) references public.stock_locations(organisation_id,venue_id,id),
  foreign key(organisation_id,product_id) references public.products(organisation_id,id)
);

create table public.bottle_scan_images (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  count_id uuid not null,
  storage_object_id uuid not null,
  file_hash text not null check(file_hash~'^[0-9a-f]{64}$'),
  sanitized_content_type text not null check(sanitized_content_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check(byte_size between 1 and 15728640),
  analysis_status text not null default 'configuration_required' check(analysis_status in ('queued','processing','completed','failed','configuration_required')),
  retention_until timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,id),
  unique(organisation_id,file_hash),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,count_id) references public.stock_counts(organisation_id,id) on delete restrict
);

create table public.bottle_detections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  image_id uuid not null,
  bounding_region jsonb not null,
  product_candidate_ids uuid[] not null default '{}',
  selected_product_id uuid,
  bottle_state text not null check(bottle_state in ('sealed','open','unknown')),
  fill_basis_points integer check(fill_basis_points between 0 and 10000),
  recognition_confidence_basis_points integer not null check(recognition_confidence_basis_points between 0 and 10000),
  fill_confidence_basis_points integer check(fill_confidence_basis_points between 0 and 10000),
  occlusion_warning boolean not null default false,
  reflection_warning boolean not null default false,
  opaque_container_warning boolean not null default false,
  duplicate_group text,
  model text not null,
  model_version text not null,
  schema_version text not null,
  human_correction jsonb,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,image_id) references public.bottle_scan_images(organisation_id,id) on delete restrict,
  foreign key(organisation_id,selected_product_id) references public.products(organisation_id,id)
);

create table public.beverage_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  trading_date date not null,
  calculation_version text not null,
  opening_quantity numeric(20,6) not null,
  receipts_quantity numeric(20,6) not null,
  transfers_in_quantity numeric(20,6) not null,
  transfers_out_quantity numeric(20,6) not null,
  closing_quantity numeric(20,6) not null,
  explained_quantity numeric(20,6) not null,
  actual_usage numeric(20,6) not null,
  theoretical_usage numeric(20,6) not null,
  unexplained_quantity numeric(20,6) not null,
  unexplained_cost_minor bigint not null,
  expected_revenue_minor bigint not null,
  pos_revenue_minor bigint not null,
  payment_revenue_minor bigint,
  revenue_difference_minor bigint not null,
  cost_snapshot_id uuid references public.product_cost_history(id),
  price_snapshot_ids uuid[] not null default '{}',
  mapping_ids uuid[] not null default '{}',
  source_completeness_basis_points integer not null check(source_completeness_basis_points between 0 and 10000),
  source_freshness jsonb not null,
  evidence jsonb not null,
  status text not null default 'draft' check(status in ('draft','reviewed','approved','superseded')),
  approved_close_id uuid references public.closing_sessions(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,venue_id,location_id,product_id,trading_date,calculation_version),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,venue_id,location_id) references public.stock_locations(organisation_id,venue_id,id),
  foreign key(organisation_id,product_id) references public.products(organisation_id,id)
);

create table public.reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  trading_date date not null,
  exception_type text not null,
  subject_id uuid not null,
  dedupe_key text not null,
  status text not null default 'open' check(status in ('open','in_review','resolved','dismissed')),
  severity text not null check(severity in ('info','warning','material','critical')),
  financial_impact_minor bigint,
  factual_description text not null,
  resolution_note text,
  resolution_action text,
  assigned_to uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,dedupe_key),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create or replace function public.prevent_append_only_mutation()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'append_only_record'; end $$;
create trigger stock_movements_append_only before update or delete on public.stock_movements
for each row execute function public.prevent_append_only_mutation();
create trigger normalized_sales_append_only before update or delete on public.normalized_sales
for each row execute function public.prevent_append_only_mutation();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'pos_imports','pos_rejected_rows','normalized_sales','stock_locations','stock_counts',
    'stock_movements','bottle_scan_images','bottle_detections',
    'beverage_reconciliations','reconciliation_exceptions'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I_member_read on public.%I for select using(public.has_venue_access(organisation_id,venue_id))',table_name,table_name);
  end loop;
end $$;

alter table public.stock_count_lines enable row level security;
create policy stock_count_lines_member_read on public.stock_count_lines for select
  using(exists(
    select 1 from public.stock_counts scoped_count
    where scoped_count.organisation_id=stock_count_lines.organisation_id
      and scoped_count.id=stock_count_lines.count_id
      and public.has_venue_access(scoped_count.organisation_id,scoped_count.venue_id)
  ));

create policy pos_imports_manage on public.pos_imports for all
  using(public.has_capability(organisation_id,venue_id,'close.create'))
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy pos_rejected_rows_insert on public.pos_rejected_rows for insert
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy normalized_sales_insert on public.normalized_sales for insert
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy source_records_pos_insert on public.source_records for insert
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy stock_counts_create on public.stock_counts for insert
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy stock_counts_manage on public.stock_counts for update
  using(public.has_capability(organisation_id,venue_id,'close.create'))
  with check(public.has_capability(organisation_id,venue_id,'close.create'));
create policy stock_count_lines_manage on public.stock_count_lines for all
  using(public.has_capability(organisation_id,null,'close.create'))
  with check(public.has_capability(organisation_id,null,'close.create'));
create policy stock_locations_manage on public.stock_locations for all
  using(public.has_capability(organisation_id,venue_id,'suppliers.manage'))
  with check(public.has_capability(organisation_id,venue_id,'suppliers.manage'));
create policy reconciliation_exceptions_manage on public.reconciliation_exceptions for all
  using(public.has_capability(organisation_id,venue_id,'close.create'))
  with check(public.has_capability(organisation_id,venue_id,'close.create'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bottle-vision','bottle-vision',false,15728640,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pos-imports','pos-imports',false,5242880,array['text/csv','text/plain','application/vnd.ms-excel'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy bottle_vision_member_read on storage.objects for select to authenticated
using(
  bucket_id='bottle-vision'
  and (storage.foldername(name))[1]~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2]~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_venue_access((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid)
);
create policy pos_imports_member_read on storage.objects for select to authenticated
using(
  bucket_id='pos-imports'
  and (storage.foldername(name))[1]~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2]~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_venue_access((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid)
);
revoke all on public.pos_imports,public.pos_rejected_rows,public.normalized_sales,
  public.stock_locations,public.stock_counts,public.stock_count_lines,public.stock_movements,
  public.bottle_scan_images,public.bottle_detections,public.beverage_reconciliations,
  public.reconciliation_exceptions from anon;
grant select on public.pos_imports,public.pos_rejected_rows,public.stock_locations,
  public.stock_counts,public.stock_count_lines,public.reconciliation_exceptions to authenticated;
grant select on public.normalized_sales to authenticated;
grant select on public.stock_movements,public.bottle_scan_images,
  public.bottle_detections,public.beverage_reconciliations to authenticated;
grant all privileges on public.pos_imports,public.pos_rejected_rows,public.normalized_sales,
  public.stock_locations,public.stock_counts,public.stock_count_lines,public.stock_movements,
  public.bottle_scan_images,public.bottle_detections,public.beverage_reconciliations,
  public.reconciliation_exceptions to service_role;

commit;
