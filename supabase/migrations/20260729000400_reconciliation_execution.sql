begin;

insert into public.capability_permissions(capability,description) values
('reconciliation.run','Generate and review deterministic nightly reconciliation')
on conflict(capability) do nothing;
insert into public.role_capabilities(role,capability)
select role,'reconciliation.run' from unnest(array['owner','administrator','manager','venue_manager','bookkeeper','finance']::public.member_role[]) role
on conflict do nothing;

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  trading_date date not null,
  version integer not null check(version>0),
  calculation_policy_version text not null,
  input_hash text not null check(input_hash~'^[0-9a-f]{64}$'),
  status text not null check(status in ('checking','blocked','ready','calculated','stale','approved')),
  materiality_threshold_minor bigint not null check(materiality_threshold_minor>=0),
  input_snapshot jsonb not null,
  source_freshness jsonb not null default '{}'::jsonb,
  data_completeness_basis_points integer not null default 0 check(data_completeness_basis_points between 0 and 10000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  calculated_at timestamptz,
  stale_at timestamptz,
  approved_close_id uuid references public.closing_sessions(id),
  unique(organisation_id,venue_id,trading_date,version),
  unique(organisation_id,venue_id,trading_date,calculation_policy_version,input_hash),
  unique(organisation_id,id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id)
);

create table public.reconciliation_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  reconciliation_id uuid not null,
  classification text not null check(classification in ('blocking','requires_confirmation','warning','informational')),
  issue_code text not null,
  subject_type text not null,
  subject_id text not null,
  title_nl text not null,
  title_en text not null,
  why_it_matters_nl text not null,
  why_it_matters_en text not null,
  financial_exposure_minor bigint,
  resolution_path text not null check(resolution_path like '/app/%'),
  created_at timestamptz not null default now(),
  unique(organisation_id,reconciliation_id,issue_code,subject_type,subject_id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,reconciliation_id) references public.reconciliation_runs(organisation_id,id) on delete restrict
);

create table public.reconciliation_product_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  reconciliation_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  category text not null,
  opening_quantity numeric(20,6) not null,
  delivered_quantity numeric(20,6) not null,
  transferred_in_quantity numeric(20,6) not null,
  transferred_out_quantity numeric(20,6) not null,
  closing_quantity numeric(20,6) not null,
  waste_quantity numeric(20,6) not null,
  breakage_quantity numeric(20,6) not null,
  complimentary_quantity numeric(20,6) not null,
  correction_quantity numeric(20,6) not null,
  actual_consumption numeric(20,6) not null,
  theoretical_consumption numeric(20,6) not null,
  variance_quantity numeric(20,6) not null,
  variance_basis_points integer,
  historical_unit_cost_minor bigint,
  cost_variance_minor bigint,
  data_completeness_basis_points integer not null check(data_completeness_basis_points between 0 and 10000),
  evidence_confidence text not null check(evidence_confidence in ('complete','partial','insufficient')),
  explanation_codes text[] not null default '{}',
  input_hash text not null,
  calculation_policy_version text not null,
  created_at timestamptz not null default now(),
  unique(organisation_id,reconciliation_id,location_id,product_id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,reconciliation_id) references public.reconciliation_runs(organisation_id,id) on delete restrict,
  foreign key(organisation_id,venue_id,location_id) references public.stock_locations(organisation_id,venue_id,id),
  foreign key(organisation_id,product_id) references public.products(organisation_id,id)
);

create table public.reconciliation_summaries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  reconciliation_id uuid not null,
  expected_gross_revenue_minor bigint not null,
  expected_net_revenue_minor bigint not null,
  recorded_gross_revenue_minor bigint not null,
  recorded_net_revenue_minor bigint not null,
  revenue_variance_minor bigint not null,
  beverage_cost_variance_minor bigint not null,
  margin_impact_minor bigint not null,
  result_hash text not null check(result_hash~'^[0-9a-f]{64}$'),
  calculation_policy_version text not null,
  created_at timestamptz not null default now(),
  unique(organisation_id,reconciliation_id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,reconciliation_id) references public.reconciliation_runs(organisation_id,id) on delete restrict
);

alter table public.reconciliation_exceptions
  add column reconciliation_id uuid,
  add column product_id uuid,
  add column location_id uuid,
  add column category text,
  add column quantity_impact numeric(20,6),
  add column materiality_threshold_minor bigint,
  add column evidence_completeness_basis_points integer check(evidence_completeness_basis_points between 0 and 10000),
  add column deterministic_explanation jsonb not null default '{}'::jsonb,
  add column source_references jsonb not null default '[]'::jsonb,
  add column suggested_actions text[] not null default '{}',
  add column responsible_role text,
  add column acknowledged_at timestamptz,
  add column reopened_at timestamptz,
  add constraint reconciliation_exceptions_org_id_unique unique(organisation_id,id),
  add constraint reconciliation_exceptions_run_fk foreign key(organisation_id,reconciliation_id) references public.reconciliation_runs(organisation_id,id),
  add constraint reconciliation_exceptions_product_fk foreign key(organisation_id,product_id) references public.products(organisation_id,id),
  add constraint reconciliation_exceptions_location_fk foreign key(organisation_id,venue_id,location_id) references public.stock_locations(organisation_id,venue_id,id);

create table public.reconciliation_exception_decisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null,
  exception_id uuid not null,
  action text not null check(action in ('investigate','request_recount','correct_mapping','add_delivery','record_waste','record_breakage','record_complimentary','create_correction','accept_within_tolerance','escalate','resolve','reopen')),
  previous_status text not null,
  next_status text not null,
  reason text not null check(length(trim(reason))>=5),
  evidence jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,exception_id) references public.reconciliation_exceptions(organisation_id,id) on delete restrict
);

do $$
declare table_name text;
begin
  foreach table_name in array array['reconciliation_runs','reconciliation_readiness_checks','reconciliation_product_results','reconciliation_summaries','reconciliation_exception_decisions'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I_member_read on public.%I for select using(public.has_venue_access(organisation_id,venue_id))',table_name,table_name);
  end loop;
end $$;

create or replace function public.begin_reconciliation(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_trading_date date,
  target_policy_version text default 'beverage-reconciliation-v1',
  target_materiality_threshold_minor bigint default 5000
) returns public.reconciliation_runs
language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; snapshot_hash text; existing_run public.reconciliation_runs; created_run public.reconciliation_runs;
  next_version integer; blocking_count integer; total_checks integer; passed_checks integer;
  expected_gross bigint; expected_net bigint; recorded_gross bigint; recorded_net bigint; total_cost_variance bigint; calculated_hash text;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'reconciliation.run') then raise exception 'forbidden'; end if;
  if target_materiality_threshold_minor<0 then raise exception 'invalid_materiality'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||target_venue_id::text||':'||target_trading_date::text||':reconciliation',0));
  snapshot=jsonb_build_object(
    'movements',coalesce((select jsonb_agg(jsonb_build_object('id',id,'location_id',location_id,'product_id',product_id,'type',movement_type,'quantity',quantity,'source_type',source_type,'source_id',source_id,'posted_at',posted_at) order by id)
      from public.stock_movements where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'row',source_row_number,'at',transaction_at,'name',pos_product_name,'quantity',quantity,'gross_minor',gross_minor,'net_minor',net_minor,'vat_minor',vat_minor,'discount_minor',discount_minor,'void_minor',void_minor,'refund_minor',refund_minor,'complimentary_minor',complimentary_minor,'terminal',terminal) order by id)
      from public.normalized_sales where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date),'[]'::jsonb),
    'mappings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source_type',source_type,'source_value',source_value,'target_type',target_type,'target_id',target_id,'version',version,'effective_from',effective_from) order by id)
      from public.source_mappings where organisation_id=target_organisation_id and venue_id=target_venue_id and connector_key='pos_csv' and status='confirmed' and effective_from<=target_trading_date),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'menu_item_id',c.menu_item_id,'product_id',c.product_id,'quantity',c.quantity,'unit',c.unit,'waste_basis_points',c.waste_basis_points,'created_at',c.created_at) order by c.id)
      from public.menu_item_components c join public.menu_items m on m.id=c.menu_item_id and m.organisation_id=c.organisation_id
      where c.organisation_id=target_organisation_id and m.venue_id=target_venue_id and m.active_from<=target_trading_date and (m.active_until is null or m.active_until>=target_trading_date)),'[]'::jsonb),
    'costs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'effective_at',effective_at,'net_cost_minor',net_cost_minor) order by id)
      from public.product_cost_history where organisation_id=target_organisation_id and effective_at<(target_trading_date+1)::timestamptz),'[]'::jsonb),
    'prices',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'menu_item_id',p.menu_item_id,'effective_at',p.effective_at,'gross_price_minor',p.gross_price_minor,'vat_basis_points',p.vat_basis_points) order by p.id)
      from public.menu_price_history p join public.menu_items m on m.id=p.menu_item_id and m.organisation_id=p.organisation_id
      where p.organisation_id=target_organisation_id and m.venue_id=target_venue_id and p.effective_at<(target_trading_date+1)::timestamptz),'[]'::jsonb)
  );
  snapshot_hash=encode(extensions.digest(convert_to(jsonb_build_object('policy',target_policy_version,'inputs',snapshot)::text,'UTF8'),'sha256'),'hex');
  select * into existing_run from public.reconciliation_runs where organisation_id=target_organisation_id and venue_id=target_venue_id
    and trading_date=target_trading_date and calculation_policy_version=target_policy_version and input_hash=snapshot_hash;
  if found then return existing_run; end if;
  update public.reconciliation_runs set status='stale',stale_at=now()
    where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date and status in ('ready','calculated');
  select coalesce(max(version),0)+1 into next_version from public.reconciliation_runs
    where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date;
  insert into public.reconciliation_runs(organisation_id,venue_id,trading_date,version,calculation_policy_version,input_hash,status,materiality_threshold_minor,input_snapshot,created_by)
  values(target_organisation_id,target_venue_id,target_trading_date,next_version,target_policy_version,snapshot_hash,'checking',target_materiality_threshold_minor,snapshot,auth.uid())
  returning * into created_run;

  insert into public.reconciliation_readiness_checks(organisation_id,venue_id,reconciliation_id,classification,issue_code,subject_type,subject_id,title_nl,title_en,why_it_matters_nl,why_it_matters_en,resolution_path)
  select target_organisation_id,target_venue_id,created_run.id,'blocking','missing_opening_count','stock_location',l.id::text,
    'Geboekte openingstelling ontbreekt','Posted opening count is missing','Werkelijk verbruik kan zonder beginvoorraad niet worden berekend.','Actual usage cannot be calculated without opening stock.','/app/inventory'
  from public.stock_locations l where l.organisation_id=target_organisation_id and l.venue_id=target_venue_id and l.active
    and not exists(select 1 from public.stock_counts c where c.organisation_id=l.organisation_id and c.venue_id=l.venue_id and c.location_id=l.id and c.trading_date=target_trading_date and c.count_type='opening' and c.status='posted');
  insert into public.reconciliation_readiness_checks(organisation_id,venue_id,reconciliation_id,classification,issue_code,subject_type,subject_id,title_nl,title_en,why_it_matters_nl,why_it_matters_en,resolution_path)
  select target_organisation_id,target_venue_id,created_run.id,'blocking','missing_closing_count','stock_location',l.id::text,
    'Geboekte sluitingstelling ontbreekt','Posted closing count is missing','Werkelijk verbruik kan zonder eindvoorraad niet worden berekend.','Actual usage cannot be calculated without closing stock.','/app/inventory'
  from public.stock_locations l where l.organisation_id=target_organisation_id and l.venue_id=target_venue_id and l.active
    and not exists(select 1 from public.stock_counts c where c.organisation_id=l.organisation_id and c.venue_id=l.venue_id and c.location_id=l.id and c.trading_date=target_trading_date and c.count_type='closing' and c.status='posted');
  insert into public.reconciliation_readiness_checks(organisation_id,venue_id,reconciliation_id,classification,issue_code,subject_type,subject_id,title_nl,title_en,why_it_matters_nl,why_it_matters_en,financial_exposure_minor,resolution_path)
  select target_organisation_id,target_venue_id,created_run.id,
    case when sum(s.gross_minor)>=target_materiality_threshold_minor then 'blocking' else 'warning' end,
    'missing_pos_mapping','pos_product',s.pos_product_name,
    'POS-product is niet gekoppeld','POS product is not mapped','Theoretisch verbruik en receptkosten zijn onvolledig.','Theoretical usage and recipe cost are incomplete.',sum(s.gross_minor),'/app/mappings/pos'
  from public.normalized_sales s where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.trading_date=target_trading_date
    and not exists(select 1 from public.source_mappings m where m.organisation_id=s.organisation_id and m.venue_id=s.venue_id and m.connector_key='pos_csv' and m.source_type='product' and m.source_value=s.pos_product_name and m.status='confirmed' and m.effective_from<=target_trading_date)
  group by s.pos_product_name;
  insert into public.reconciliation_readiness_checks(organisation_id,venue_id,reconciliation_id,classification,issue_code,subject_type,subject_id,title_nl,title_en,why_it_matters_nl,why_it_matters_en,resolution_path)
  select target_organisation_id,target_venue_id,created_run.id,'blocking','incomplete_recipe','menu_item',m.target_id::text,
    'Recept bevat geen voorraadcomponenten','Recipe has no stock components','Theoretisch verbruik kan voor dit verkochte artikel niet worden berekend.','Theoretical usage cannot be calculated for this sold item.','/app/products'
  from public.source_mappings m
  where m.organisation_id=target_organisation_id and m.venue_id=target_venue_id and m.connector_key='pos_csv' and m.source_type='product' and m.status='confirmed'
    and exists(select 1 from public.normalized_sales s where s.organisation_id=m.organisation_id and s.venue_id=m.venue_id and s.trading_date=target_trading_date and s.pos_product_name=m.source_value)
    and not exists(select 1 from public.menu_item_components c where c.organisation_id=m.organisation_id and c.menu_item_id=m.target_id);
  insert into public.reconciliation_readiness_checks(organisation_id,venue_id,reconciliation_id,classification,issue_code,subject_type,subject_id,title_nl,title_en,why_it_matters_nl,why_it_matters_en,resolution_path)
  select target_organisation_id,target_venue_id,created_run.id,'blocking','missing_terminal_mapping','terminal',s.terminal,
    'Verkoopgebied is niet aan een bar gekoppeld','Sales area is not linked to a bar','Verbruik kan niet betrouwbaar aan een locatie worden toegewezen.','Usage cannot be allocated reliably to a stock location.','/app/mappings/pos'
  from public.normalized_sales s
  where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.trading_date=target_trading_date and s.terminal is not null
    and (select count(*) from public.stock_locations l where l.organisation_id=target_organisation_id and l.venue_id=target_venue_id and l.active)>1
    and not exists(select 1 from public.source_mappings m where m.organisation_id=s.organisation_id and m.venue_id=s.venue_id and m.connector_key='pos_csv' and m.source_type='terminal' and m.source_value=s.terminal and m.status='confirmed' and m.effective_from<=target_trading_date)
  group by s.terminal;
  select count(*) filter(where classification='blocking'),count(*) into blocking_count,total_checks
    from public.reconciliation_readiness_checks where organisation_id=target_organisation_id and reconciliation_id=created_run.id;
  passed_checks=greatest(0,(select count(*)*2 from public.stock_locations where organisation_id=target_organisation_id and venue_id=target_venue_id and active)-blocking_count);
  update public.reconciliation_runs set status=case when blocking_count>0 then 'blocked' else 'ready' end,
    data_completeness_basis_points=case when passed_checks+total_checks=0 then 10000 else (passed_checks*10000/(passed_checks+total_checks))::integer end
    where id=created_run.id returning * into created_run;
  if blocking_count=0 then
    with sole_location as (
      select min(id) id from public.stock_locations where organisation_id=target_organisation_id and venue_id=target_venue_id and active
    ), stock as (
      select location_id,product_id,
        coalesce(sum(quantity) filter(where movement_type='opening'),0) opening,
        coalesce(sum(quantity) filter(where movement_type='receipt'),0) delivered,
        coalesce(sum(quantity) filter(where movement_type='supplier_return'),0) returned,
        coalesce(sum(quantity) filter(where movement_type='transfer_in'),0) transfer_in,
        coalesce(sum(quantity) filter(where movement_type='transfer_out'),0) transfer_out,
        coalesce(sum(quantity) filter(where movement_type='closing'),0) closing,
        coalesce(sum(quantity) filter(where movement_type='waste'),0) waste,
        coalesce(sum(quantity) filter(where movement_type='breakage'),0) breakage,
        coalesce(sum(quantity) filter(where movement_type='complimentary'),0) complimentary,
        coalesce(sum(quantity) filter(where movement_type='staff_consumption'),0)+coalesce(sum(quantity) filter(where movement_type='sampling'),0)+coalesce(sum(quantity) filter(where movement_type='preparation'),0) other_non_sale,
        coalesce(sum(quantity) filter(where movement_type='approved_correction'),0) correction
      from public.stock_movements where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=target_trading_date
      group by location_id,product_id
    ), theory as (
      select coalesce(terminal_map.target_id,sole_location.id) location_id,c.product_id,
        sum(case when s.void_minor=0 then s.quantity*c.quantity else 0 end)::numeric(20,6) theoretical
      from public.normalized_sales s
      join public.source_mappings product_map on product_map.organisation_id=s.organisation_id and product_map.venue_id=s.venue_id
        and product_map.connector_key='pos_csv' and product_map.source_type='product' and product_map.source_value=s.pos_product_name
        and product_map.status='confirmed' and product_map.effective_from<=target_trading_date
      join public.menu_item_components c on c.organisation_id=s.organisation_id and c.menu_item_id=product_map.target_id
      cross join sole_location
      left join public.source_mappings terminal_map on terminal_map.organisation_id=s.organisation_id and terminal_map.venue_id=s.venue_id
        and terminal_map.connector_key='pos_csv' and terminal_map.source_type='terminal' and terminal_map.source_value=s.terminal
        and terminal_map.status='confirmed' and terminal_map.effective_from<=target_trading_date
      where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.trading_date=target_trading_date
      group by coalesce(terminal_map.target_id,sole_location.id),c.product_id
    ), keys as (
      select location_id,product_id from stock union select location_id,product_id from theory
    ), amounts as (
      select k.location_id,k.product_id,p.category,p.package_quantity,
        coalesce(st.opening,0) opening,coalesce(st.delivered,0) delivered,coalesce(st.returned,0) returned,
        coalesce(st.transfer_in,0) transfer_in,coalesce(st.transfer_out,0) transfer_out,coalesce(st.closing,0) closing,
        coalesce(st.waste,0) waste,coalesce(st.breakage,0) breakage,coalesce(st.complimentary,0) complimentary,
        coalesce(st.other_non_sale,0) other_non_sale,coalesce(st.correction,0) correction,coalesce(th.theoretical,0) theoretical,
        cost.net_cost_minor
      from keys k join public.products p on p.organisation_id=target_organisation_id and p.id=k.product_id
      left join stock st on st.location_id=k.location_id and st.product_id=k.product_id
      left join theory th on th.location_id=k.location_id and th.product_id=k.product_id
      left join lateral(select net_cost_minor from public.product_cost_history h where h.organisation_id=target_organisation_id and h.product_id=k.product_id and h.effective_at<(target_trading_date+1)::timestamptz order by h.effective_at desc,h.id desc limit 1) cost on true
    )
    insert into public.reconciliation_product_results(
      organisation_id,venue_id,reconciliation_id,location_id,product_id,category,opening_quantity,delivered_quantity,
      transferred_in_quantity,transferred_out_quantity,closing_quantity,waste_quantity,breakage_quantity,complimentary_quantity,
      correction_quantity,actual_consumption,theoretical_consumption,variance_quantity,variance_basis_points,historical_unit_cost_minor,
      cost_variance_minor,data_completeness_basis_points,evidence_confidence,explanation_codes,input_hash,calculation_policy_version
    )
    select target_organisation_id,target_venue_id,created_run.id,location_id,product_id,category,opening,delivered-returned,
      transfer_in,transfer_out,closing,waste,breakage,complimentary,correction,
      opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction,
      theoretical,
      (opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction)-theoretical,
      case when theoretical=0 then null else round(((opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction)-theoretical)*10000/theoretical)::integer end,
      case when net_cost_minor is null then null else round(net_cost_minor/package_quantity)::bigint end,
      case when net_cost_minor is null then null else round(((opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction)-theoretical)*net_cost_minor/package_quantity)::bigint end,
      created_run.data_completeness_basis_points,case when net_cost_minor is null then 'partial' else 'complete' end,
      array_remove(array[case when theoretical=0 then 'ZERO_THEORETICAL' end,case when (opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction)-theoretical>0 then 'OVER_CONSUMPTION' when (opening+delivered-returned+transfer_in-transfer_out-closing-waste-breakage-complimentary-other_non_sale+correction)-theoretical<0 then 'UNDER_CONSUMPTION' end],null),
      snapshot_hash,target_policy_version from amounts;

    with priced_sales as (
      select s.quantity,s.gross_minor,s.net_minor,s.discount_minor,s.void_minor,s.refund_minor,s.complimentary_minor,
        price.gross_price_minor,price.vat_basis_points
      from public.normalized_sales s
      join public.source_mappings m on m.organisation_id=s.organisation_id and m.venue_id=s.venue_id and m.connector_key='pos_csv' and m.source_type='product' and m.source_value=s.pos_product_name and m.status='confirmed' and m.effective_from<=target_trading_date
      left join lateral(select gross_price_minor,vat_basis_points from public.menu_price_history p where p.organisation_id=s.organisation_id and p.menu_item_id=m.target_id and p.effective_at<=s.transaction_at order by p.effective_at desc,p.id desc limit 1) price on true
      where s.organisation_id=target_organisation_id and s.venue_id=target_venue_id and s.trading_date=target_trading_date
    )
    select coalesce(sum(case when void_minor=0 then round(quantity*gross_price_minor) else 0 end),0)::bigint,
      coalesce(sum(case when void_minor=0 then round(quantity*gross_price_minor*10000/(10000+vat_basis_points)) else 0 end),0)::bigint,
      coalesce(sum(gross_minor-discount_minor-void_minor-refund_minor-complimentary_minor),0)::bigint,
      coalesce(sum(net_minor-discount_minor-void_minor-refund_minor-complimentary_minor),0)::bigint
    into expected_gross,expected_net,recorded_gross,recorded_net from priced_sales;
    select coalesce(sum(cost_variance_minor),0) into total_cost_variance from public.reconciliation_product_results where organisation_id=target_organisation_id and reconciliation_id=created_run.id;
    calculated_hash=encode(extensions.digest(convert_to(jsonb_build_object('input_hash',snapshot_hash,'expected_gross',expected_gross,'expected_net',expected_net,'recorded_gross',recorded_gross,'recorded_net',recorded_net,'cost_variance',total_cost_variance,'products',
      (select jsonb_agg(to_jsonb(r)-'created_at' order by r.location_id,r.product_id) from public.reconciliation_product_results r where r.organisation_id=target_organisation_id and r.reconciliation_id=created_run.id))::text,'UTF8'),'sha256'),'hex');
    insert into public.reconciliation_summaries(organisation_id,venue_id,reconciliation_id,expected_gross_revenue_minor,expected_net_revenue_minor,recorded_gross_revenue_minor,recorded_net_revenue_minor,revenue_variance_minor,beverage_cost_variance_minor,margin_impact_minor,result_hash,calculation_policy_version)
    values(target_organisation_id,target_venue_id,created_run.id,expected_gross,expected_net,recorded_gross,recorded_net,recorded_gross-expected_gross,total_cost_variance,(recorded_net-expected_net)-total_cost_variance,calculated_hash,target_policy_version);
    insert into public.reconciliation_exceptions(
      organisation_id,venue_id,trading_date,reconciliation_id,exception_type,subject_id,product_id,location_id,category,dedupe_key,status,severity,
      financial_impact_minor,quantity_impact,materiality_threshold_minor,evidence_completeness_basis_points,factual_description,
      deterministic_explanation,source_references,suggested_actions,responsible_role
    )
    select organisation_id,venue_id,target_trading_date,reconciliation_id,
      case when variance_quantity>0 then 'over_consumption' else 'under_consumption' end,product_id,product_id,location_id,category,
      created_run.id::text||':'||location_id::text||':'||product_id::text||':consumption_variance','open',
      case when abs(cost_variance_minor)>=target_materiality_threshold_minor*2 then 'material' else 'warning' end,
      abs(cost_variance_minor),variance_quantity,target_materiality_threshold_minor,data_completeness_basis_points,
      case when variance_quantity>0 then 'Werkelijk verbruik is hoger dan theoretisch verbruik.' else 'Werkelijk verbruik is lager dan theoretisch verbruik.' end,
      jsonb_build_object('actual_quantity',actual_consumption,'theoretical_quantity',theoretical_consumption,'variance_quantity',variance_quantity,'unit_cost_minor',historical_unit_cost_minor),
      jsonb_build_array(jsonb_build_object('reconciliation_id',reconciliation_id,'input_hash',input_hash)),
      array['investigate','request_recount','record_waste','record_breakage','record_complimentary','accept_within_tolerance'],'manager'
    from public.reconciliation_product_results
    where organisation_id=target_organisation_id and reconciliation_id=created_run.id and cost_variance_minor is not null and abs(cost_variance_minor)>=target_materiality_threshold_minor
    on conflict(organisation_id,dedupe_key) do nothing;
    if abs(recorded_gross-expected_gross)>=target_materiality_threshold_minor then
      insert into public.reconciliation_exceptions(
        organisation_id,venue_id,trading_date,reconciliation_id,exception_type,subject_id,dedupe_key,status,severity,financial_impact_minor,
        materiality_threshold_minor,evidence_completeness_basis_points,factual_description,deterministic_explanation,source_references,suggested_actions,responsible_role
      ) values (
        target_organisation_id,target_venue_id,target_trading_date,created_run.id,'revenue_leakage',created_run.id,
        created_run.id::text||':venue:revenue_variance','open',
        case when abs(recorded_gross-expected_gross)>=target_materiality_threshold_minor*2 then 'material' else 'warning' end,
        abs(recorded_gross-expected_gross),target_materiality_threshold_minor,created_run.data_completeness_basis_points,
        'Geregistreerde bruto-omzet wijkt af van de omzet op basis van verkochte aantallen en historische prijzen.',
        jsonb_build_object('expected_gross_minor',expected_gross,'recorded_gross_minor',recorded_gross,'variance_minor',recorded_gross-expected_gross),
        jsonb_build_array(jsonb_build_object('reconciliation_id',created_run.id,'result_hash',calculated_hash)),
        array['investigate','correct_mapping','accept_within_tolerance','escalate'],'manager'
      ) on conflict(organisation_id,dedupe_key) do nothing;
    end if;
    update public.reconciliation_runs set status='calculated',calculated_at=now() where id=created_run.id returning * into created_run;
  end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(target_organisation_id,target_venue_id,'reconciliation',created_run.id,'reconciliation.checked',auth.uid(),jsonb_build_object('input_hash',snapshot_hash,'status',created_run.status,'version',created_run.version));
  return created_run;
end $$;

create or replace function public.decide_reconciliation_exception(
  target_organisation_id uuid,target_exception_id uuid,target_action text,target_reason text,
  target_idempotency_key text,target_evidence jsonb default '[]'::jsonb
) returns public.reconciliation_exceptions
language plpgsql security definer set search_path=public as $$
declare current_exception public.reconciliation_exceptions; next_status text; existing_decision uuid; previous_status_value text;
begin
  if length(trim(coalesce(target_reason,'')))<5 then raise exception 'decision_reason_required'; end if;
  select * into current_exception from public.reconciliation_exceptions
    where organisation_id=target_organisation_id and id=target_exception_id for update;
  if not found then raise exception 'exception_not_found'; end if;
  if not public.has_capability(current_exception.organisation_id,current_exception.venue_id,'reconciliation.run') then raise exception 'forbidden'; end if;
  select id into existing_decision from public.reconciliation_exception_decisions
    where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if existing_decision is not null then return current_exception; end if;
  if target_action not in ('investigate','request_recount','correct_mapping','add_delivery','record_waste','record_breakage','record_complimentary','create_correction','accept_within_tolerance','escalate','resolve','reopen') then raise exception 'invalid_exception_action'; end if;
  if target_action='reopen' then
    if current_exception.status not in ('resolved','dismissed') then raise exception 'invalid_exception_state'; end if;
    next_status='open';
  elsif target_action in ('accept_within_tolerance','resolve') then next_status='resolved';
  else next_status='in_review';
  end if;
  previous_status_value=current_exception.status;
  insert into public.reconciliation_exception_decisions(
    organisation_id,venue_id,exception_id,action,previous_status,next_status,reason,evidence,idempotency_key,actor_id
  ) values (
    current_exception.organisation_id,current_exception.venue_id,current_exception.id,target_action,current_exception.status,next_status,
    trim(target_reason),target_evidence,target_idempotency_key,auth.uid()
  );
  update public.reconciliation_exceptions set status=next_status,
    acknowledged_at=case when acknowledged_at is null then now() else acknowledged_at end,
    resolved_by=case when next_status='resolved' then auth.uid() else resolved_by end,
    resolved_at=case when next_status='resolved' then now() when target_action='reopen' then null else resolved_at end,
    reopened_at=case when target_action='reopen' then now() else reopened_at end,
    resolution_note=case when next_status='resolved' then trim(target_reason) else resolution_note end,
    resolution_action=target_action
  where id=current_exception.id returning * into current_exception;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(current_exception.organisation_id,current_exception.venue_id,'reconciliation_exception',current_exception.id,'reconciliation_exception.'||target_action,auth.uid(),
    jsonb_build_object('reconciliation_id',current_exception.reconciliation_id,'previous_status',previous_status_value,'next_status',next_status));
  return current_exception;
end $$;

grant select on public.reconciliation_runs,public.reconciliation_readiness_checks,public.reconciliation_product_results,public.reconciliation_summaries,public.reconciliation_exception_decisions to authenticated;
grant all privileges on public.reconciliation_runs,public.reconciliation_readiness_checks,public.reconciliation_product_results,public.reconciliation_summaries,public.reconciliation_exception_decisions to service_role;
grant execute on function public.begin_reconciliation(uuid,uuid,date,text,bigint) to authenticated;
grant execute on function public.decide_reconciliation_exception(uuid,uuid,text,text,text,jsonb) to authenticated;

commit;
