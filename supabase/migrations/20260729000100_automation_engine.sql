begin;

do $$
declare existing_definition text;
begin
  if to_regclass('public.integration_connections') is null then
    raise exception 'automation_engine_precondition_failed: public.integration_connections is missing';
  end if;

  select pg_get_constraintdef(oid) into existing_definition
  from pg_constraint
  where conrelid='public.integration_connections'::regclass
    and conname='integration_connections_connection_status_check'
    and contype='c';

  if existing_definition is null then
    raise exception 'automation_engine_precondition_failed: expected legacy connection-status constraint is missing';
  end if;
  if existing_definition not like '%disconnected%'
     or existing_definition not like '%connecting%'
     or existing_definition not like '%connected%'
     or existing_definition not like '%degraded%'
     or existing_definition not like '%error%' then
    raise exception 'automation_engine_precondition_failed: connection-status constraint does not match the reviewed legacy vocabulary';
  end if;

  if exists (
    select 1 from public.integration_connections
    where connection_status not in (
      'disconnected','connecting','connected','degraded','error',
      'not_configured','authorization_required','syncing','failed','disabled'
    )
  ) then
    raise exception 'automation_engine_precondition_failed: unknown connection status exists; inspect and migrate it explicitly';
  end if;
end $$;

alter table public.integration_connections
  add constraint integration_connections_connection_status_expanded_check
  check(connection_status in (
    'disconnected','connecting','connected','degraded','error',
    'not_configured','authorization_required','syncing','failed','disabled'
  )) not valid;

alter table public.integration_connections
  validate constraint integration_connections_connection_status_expanded_check;

alter table public.integration_connections
  drop constraint integration_connections_connection_status_check;

alter table public.integration_connections
  rename constraint integration_connections_connection_status_expanded_check
  to integration_connections_connection_status_check;

alter table public.integration_connections
  alter column lifecycle_status set default 'available',
  alter column connection_status set default 'not_configured',
  add column if not exists provider_account_id text,
  add column if not exists granted_scopes text[] not null default '{}',
  add column if not exists encrypted_credential jsonb,
  add column if not exists credential_expires_at timestamptz,
  add column if not exists sync_cursor text,
  add column if not exists freshness_seconds integer check(freshness_seconds is null or freshness_seconds>=0),
  add column if not exists provider_error_code text,
  add column if not exists provider_error_message text,
  add column if not exists consecutive_failures integer not null default 0 check(consecutive_failures>=0),
  add column if not exists disabled_at timestamptz;

comment on column public.integration_connections.encrypted_credential is
  'Server-only encrypted envelope. Never select or return this field to a browser.';

create or replace function public.has_venue_access(
  target_organisation_id uuid,
  target_venue_id uuid
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
  )
$$;

create table public.connector_registry (
  connector_key text primary key,
  connector_kind text not null check(connector_kind in ('pos','payment','ticketing','reservation','workforce','accounting','analytics','advertising','supplier','computer_vision','notification')),
  display_name text not null,
  minimum_scopes text[] not null default '{}',
  supports_oauth boolean not null default false,
  supports_webhooks boolean not null default false,
  supports_incremental_polling boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.source_mappings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  connector_key text not null references public.connector_registry(connector_key),
  source_type text not null,
  source_value text not null,
  target_type text not null,
  target_id uuid not null,
  effective_from date not null default current_date,
  confidence_basis_points integer check(confidence_basis_points between 0 and 10000),
  reasoning jsonb not null default '{}'::jsonb,
  status text not null check(status in ('proposed','confirmed','rejected','superseded')),
  version integer not null default 1 check(version>0),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  supersedes_id uuid references public.source_mappings(id),
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);
create unique index source_mappings_confirmed_unique
  on public.source_mappings(organisation_id,connector_key,source_type,source_value)
  where status='confirmed';

create table public.mapping_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  source_record_id uuid not null references public.source_records(id) on delete restrict,
  exception_code text not null,
  candidates jsonb not null default '[]'::jsonb,
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  resolved_mapping_id uuid references public.source_mappings(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  name text not null,
  trigger_key text not null,
  conditions jsonb not null,
  action_key text not null,
  approval_policy text not null check(approval_policy in ('none','manager','owner')),
  quiet_hours jsonb not null default '{}'::jsonb,
  rate_limit jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  dry_run boolean not null default true,
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  rule_id uuid references public.automation_rules(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null,
  status text not null check(status in ('queued','running','approval_required','succeeded','failed','dead_lettered','cancelled')),
  attempt integer not null default 1 check(attempt>0),
  retry_at timestamptz,
  input_references jsonb not null default '[]'::jsonb,
  result jsonb,
  normalized_error jsonb,
  token_count integer check(token_count is null or token_count>=0),
  cost_minor bigint check(cost_minor is null or cost_minor>=0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid,
  automation_run_id uuid references public.automation_runs(id) on delete restrict,
  action_type text not null,
  prepared_payload jsonb not null,
  financial_impact_minor bigint,
  required_capability text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','expired','executed')),
  requested_by uuid references auth.users(id),
  assigned_to uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  execution_evidence jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'source_mappings','mapping_exceptions','automation_rules','automation_runs','approval_requests'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I_member_read on public.%I for select using(public.has_venue_access(organisation_id,venue_id))',table_name,table_name);
  end loop;
end $$;

alter table public.connector_registry enable row level security;
create policy connector_registry_authenticated_read on public.connector_registry
  for select to authenticated using(enabled);

create policy source_mappings_manage on public.source_mappings for all
  using(public.has_capability(organisation_id,venue_id,'suppliers.manage'))
  with check(public.has_capability(organisation_id,venue_id,'suppliers.manage'));
create policy mapping_exceptions_manage on public.mapping_exceptions for all
  using(public.has_capability(organisation_id,venue_id,'suppliers.manage'))
  with check(public.has_capability(organisation_id,venue_id,'suppliers.manage'));
create policy automation_rules_manage on public.automation_rules for all
  using(public.has_capability(organisation_id,venue_id,'members.manage'))
  with check(public.has_capability(organisation_id,venue_id,'members.manage'));
create policy approval_requests_decide on public.approval_requests for update
  using(public.has_capability(organisation_id,venue_id,required_capability))
  with check(public.has_capability(organisation_id,venue_id,required_capability));

create or replace function public.confirm_pos_mapping(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_source_value text,
  target_menu_item_id uuid,
  target_confidence_basis_points integer,
  target_reasoning jsonb,
  target_effective_from date
) returns public.source_mappings
language plpgsql security invoker set search_path=public as $$
declare current_mapping public.source_mappings; created_mapping public.source_mappings; next_version integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'close.create') then raise exception 'forbidden'; end if;
  if target_confidence_basis_points not between 0 and 10000 then raise exception 'invalid_confidence'; end if;
  if not exists(
    select 1 from public.menu_items
    where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_menu_item_id
  ) then raise exception 'menu_item_scope_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':pos_csv:product:'||target_source_value,0));
  select * into current_mapping from public.source_mappings
    where organisation_id=target_organisation_id and connector_key='pos_csv'
      and source_type='product' and source_value=target_source_value and status='confirmed'
    for update;
  select coalesce(max(version),0)+1 into next_version from public.source_mappings
    where organisation_id=target_organisation_id and connector_key='pos_csv'
      and source_type='product' and source_value=target_source_value;
  if found and current_mapping.id is not null then
    update public.source_mappings set status='superseded' where id=current_mapping.id;
  end if;
  insert into public.source_mappings(
    organisation_id,venue_id,connector_key,source_type,source_value,target_type,target_id,
    confidence_basis_points,reasoning,status,version,confirmed_by,confirmed_at,supersedes_id,effective_from
  ) values (
    target_organisation_id,target_venue_id,'pos_csv','product',target_source_value,'menu_item',target_menu_item_id,
    target_confidence_basis_points,target_reasoning,'confirmed',next_version,auth.uid(),now(),current_mapping.id,target_effective_from
  ) returning * into created_mapping;
  return created_mapping;
end $$;

revoke all on public.connector_registry,public.source_mappings,public.mapping_exceptions,
  public.automation_rules,public.automation_runs,public.approval_requests from anon;
grant select on public.connector_registry,public.source_mappings,public.mapping_exceptions,
  public.automation_rules,public.automation_runs,public.approval_requests to authenticated;
grant execute on function public.confirm_pos_mapping(uuid,uuid,text,uuid,integer,jsonb,date) to authenticated;
revoke all on function public.has_venue_access(uuid,uuid) from public;
grant execute on function public.has_venue_access(uuid,uuid) to authenticated,service_role;
grant all privileges on public.connector_registry,public.source_mappings,public.mapping_exceptions,
  public.automation_rules,public.automation_runs,public.approval_requests to service_role;

commit;
