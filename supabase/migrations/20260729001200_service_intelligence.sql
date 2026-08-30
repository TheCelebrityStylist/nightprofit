begin;

alter table public.products add column if not exists par_level_quantity numeric(20,6) not null default 0 check(par_level_quantity>=0);
alter table public.products add column if not exists preferred_stock_location_id uuid;
alter table public.stock_locations add constraint stock_locations_org_id_unique unique(organisation_id,id);
alter table public.products add constraint products_preferred_location_tenant_fk foreign key(organisation_id,preferred_stock_location_id) references public.stock_locations(organisation_id,id);

create table public.service_learning_results(
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  venue_id uuid not null, service_operation_id uuid not null, comparison_basis jsonb not null,
  lessons jsonb not null, evidence_refs jsonb not null, calculation_version text not null,
  created_at timestamptz not null default now(), unique(organisation_id,id), unique(service_operation_id),
  foreign key(organisation_id,venue_id) references public.venues(organisation_id,id),
  foreign key(organisation_id,service_operation_id) references public.service_operations(organisation_id,id) on delete restrict
);
alter table public.service_learning_results enable row level security;
create policy service_learning_read on public.service_learning_results for select using(public.has_venue_access(organisation_id,venue_id));
create policy service_learning_manage on public.service_learning_results for insert with check(public.has_capability(organisation_id,venue_id,'actions.manage'));
create trigger service_learning_append_only before update or delete on public.service_learning_results for each row execute function public.prevent_append_only_mutation();

create or replace function public.refresh_service_intelligence(target_organisation_id uuid,target_service_operation_id uuid)
returns public.service_operations language plpgsql security definer set search_path='' as $$
declare op public.service_operations; avg_revenue numeric:=0; scale numeric:=1; requirements jsonb:='[]'; purchase_lines jsonb:='[]';
  missing_recipes integer:=0; missing_costs integer:=0; actual_revenue bigint:=0; worked_minutes integer:=0;
  actual_labor bigint:=0; shortage_count integer:=0; expected_spend bigint:=0; purchase public.service_purchase_plans;
  recon_summary public.reconciliation_summaries; close_row public.closing_sessions; learning jsonb:='{}';
begin
  select * into op from public.service_operations where organisation_id=target_organisation_id and id=target_service_operation_id for update;
  if op.id is null or not public.has_capability(target_organisation_id,op.venue_id,'actions.manage') then raise exception 'forbidden'; end if;
  if op.status='locked' then return op; end if;

  select coalesce(avg(day_revenue),0) into avg_revenue from (
    select trading_date,sum(gross_minor)::numeric day_revenue from public.normalized_sales
    where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date<op.service_date
    group by trading_date order by trading_date desc limit 8
  ) history;
  if avg_revenue>0 and coalesce((op.demand_snapshot->>'expected_revenue_minor')::numeric,0)>0 then scale:=(op.demand_snapshot->>'expected_revenue_minor')::numeric/avg_revenue; end if;

  with historical_mix as (
    select m.target_id menu_item_id,avg(daily_quantity) forecast_units,count(*) evidence_services from (
      select mapping_id,trading_date,sum(quantity) daily_quantity from public.normalized_sales
      where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date<op.service_date and mapping_id is not null
      group by mapping_id,trading_date
    ) sales join public.source_mappings m on m.id=sales.mapping_id and m.organisation_id=target_organisation_id and m.venue_id=op.venue_id and m.target_type='menu_item' and m.status='confirmed' and m.effective_from<=op.service_date
    group by m.target_id
  ), product_need as (
    select c.product_id,sum(h.forecast_units*scale*c.quantity*(10000+c.waste_basis_points)/10000) required_quantity,
      sum(h.forecast_units*scale) forecast_sales,sum(h.evidence_services) evidence_services
    from historical_mix h join public.menu_item_components c on c.menu_item_id=h.menu_item_id
    group by c.product_id
  ), product_facts as (
    select n.product_id,p.name,p.supplier_id,p.par_level_quantity,n.required_quantity,n.forecast_sales,n.evidence_services,
      coalesce((select sum(sm.quantity) from public.stock_movements sm where sm.organisation_id=target_organisation_id and sm.venue_id=op.venue_id and sm.product_id=n.product_id and sm.trading_date<=op.service_date),0) available_quantity,
      coalesce((select h.net_cost_minor from public.product_cost_history h where h.organisation_id=target_organisation_id and h.product_id=n.product_id and h.effective_at<=op.service_end order by h.effective_at desc limit 1),0) unit_cost_minor
    from product_need n join public.products p on p.id=n.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'product_name',name,'forecast_sales',round(forecast_sales,3),'required_quantity',round(required_quantity,3),'available_quantity',round(available_quantity,3),'outstanding_quantity',0,'par_quantity',par_level_quantity,'suggested_order_quantity',round(greatest(required_quantity+par_level_quantity-available_quantity,0),3),'effective_unit_cost_minor',unit_cost_minor,'expected_purchase_cost_minor',round(greatest(required_quantity+par_level_quantity-available_quantity,0)*unit_cost_minor),'evidence_completeness_basis_points',case when evidence_services>0 and unit_cost_minor>0 then 9000 when evidence_services>0 then 6500 else 3000 end) order by greatest(required_quantity+par_level_quantity-available_quantity,0)*unit_cost_minor desc),'[]'::jsonb),
    count(*) filter(where required_quantity+par_level_quantity>available_quantity),coalesce(sum(round(greatest(required_quantity+par_level_quantity-available_quantity,0)*unit_cost_minor)),0),count(*) filter(where unit_cost_minor=0)
  into requirements,shortage_count,expected_spend,missing_costs from product_facts;
  purchase_lines:=requirements;

  select count(*) into missing_recipes from public.source_mappings m left join public.menu_item_components c on c.menu_item_id=m.target_id
    where m.organisation_id=target_organisation_id and m.venue_id=op.venue_id and m.connector_key='pos_csv' and m.source_type='product' and m.status='confirmed' and c.id is null;
  select coalesce(sum(gross_minor),0) into actual_revenue from public.normalized_sales where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date=op.service_date;
  select coalesce(sum(greatest(0,(extract(epoch from (coalesce(t.clocked_out_at,least(now(),op.service_end))-t.clocked_in_at))/60)::integer-t.break_minutes)),0),
    coalesce(sum((s.hourly_cost_minor*greatest(0,(extract(epoch from (coalesce(t.clocked_out_at,least(now(),op.service_end))-t.clocked_in_at))/60)::integer-t.break_minutes)+30)/60),0)
  into worked_minutes,actual_labor from public.time_records t left join public.shifts s on s.id=t.shift_id
  where t.organisation_id=target_organisation_id and t.venue_id=op.venue_id and t.clocked_in_at::date=op.service_date;

  select * into purchase from public.service_purchase_plans where organisation_id=target_organisation_id and service_operation_id=op.id and status<>'superseded' order by version desc limit 1;
  if shortage_count>0 then
    if purchase.id is null then insert into public.service_purchase_plans(organisation_id,venue_id,service_operation_id,version,status,lines,expected_cost_minor,evidence_refs,created_by)
      values(target_organisation_id,op.venue_id,op.id,coalesce((select max(version)+1 from public.service_purchase_plans where service_operation_id=op.id),1),'ready_for_review',purchase_lines,expected_spend,jsonb_build_array(jsonb_build_object('source','forecast_recipe_stock_cost')),auth.uid()) returning * into purchase;
    elsif purchase.status in ('approved','ordered','received') and purchase.lines<>purchase_lines then
      insert into public.service_purchase_plans(organisation_id,venue_id,service_operation_id,version,status,lines,expected_cost_minor,evidence_refs,created_by)
      values(target_organisation_id,op.venue_id,op.id,(select max(version)+1 from public.service_purchase_plans where service_operation_id=op.id),'ready_for_review',purchase_lines,expected_spend,jsonb_build_array(jsonb_build_object('source','forecast_recipe_stock_cost'),jsonb_build_object('supersedes_plan_id',purchase.id)),auth.uid()) returning * into purchase;
    elsif purchase.status not in ('approved','ordered','received') then update public.service_purchase_plans set lines=purchase_lines,expected_cost_minor=expected_spend,status='ready_for_review' where id=purchase.id returning * into purchase; end if;
  end if;

  select rs.* into recon_summary from public.reconciliation_summaries rs join public.reconciliation_runs rr on rr.id=rs.reconciliation_id where rr.organisation_id=target_organisation_id and rr.venue_id=op.venue_id and rr.trading_date=op.service_date order by rr.version desc limit 1;
  select * into close_row from public.closing_sessions where organisation_id=target_organisation_id and venue_id=op.venue_id and trading_date=op.service_date order by version desc limit 1;
  if close_row.status='locked' and recon_summary.id is not null then
    learning:=jsonb_build_object('forecast_revenue_minor',coalesce((op.demand_snapshot->>'expected_revenue_minor')::bigint,0),'actual_revenue_minor',recon_summary.recorded_gross_revenue_minor,'revenue_variance_minor',recon_summary.revenue_variance_minor,'planned_labor_minor',coalesce((op.staffing_snapshot->>'planned_labor_minor')::bigint,0),'actual_labor_minor',actual_labor,'beverage_cost_variance_minor',recon_summary.beverage_cost_variance_minor,'margin_impact_minor',recon_summary.margin_impact_minor,'lesson',case when recon_summary.revenue_variance_minor<0 then 'Use the verified lower revenue outcome in the next comparable-service baseline.' else 'Preserve the verified demand assumptions and review mix-level variances.' end);
    insert into public.service_learning_results(organisation_id,venue_id,service_operation_id,comparison_basis,lessons,evidence_refs,calculation_version)
      values(target_organisation_id,op.venue_id,op.id,jsonb_build_object('forecast_id',op.forecast_id,'reconciliation_id',op.reconciliation_id,'close_id',close_row.id),learning,jsonb_build_array(jsonb_build_object('result_hash',recon_summary.result_hash)),'deterministic-v1') on conflict(service_operation_id) do nothing;
  end if;

  update public.service_operations set purchase_plan_id=purchase.id,consumption_snapshot=jsonb_build_object('requirements',requirements,'historical_revenue_minor',round(avg_revenue),'scale_basis_points',round(scale*10000),'missing_recipe_count',missing_recipes),
    purchasing_snapshot=jsonb_build_object('plan_id',purchase.id,'status',purchase.status,'shortage_count',shortage_count,'expected_spend_minor',expected_spend,'missing_cost_count',missing_costs,'lines',purchase_lines),
    live_snapshot=jsonb_build_object('recorded_revenue_minor',actual_revenue,'forecast_revenue_minor',coalesce((op.demand_snapshot->>'expected_revenue_minor')::bigint,0),'worked_minutes',worked_minutes,'actual_labor_minor',actual_labor,'source_updated_at',now()),
    outcome_snapshot=case when learning<>'{}'::jsonb then learning else outcome_snapshot end,
    stage=case when close_row.status='locked' then 'learn' when recon_summary.id is not null then 'close' when now() between service_start and service_end then 'run' when now()<service_start then 'prepare' else 'close' end,
    status=case when close_row.status='locked' and learning<>'{}'::jsonb then 'locked' else status end,locked_at=case when close_row.status='locked' then coalesce(locked_at,now()) else locked_at end,updated_at=now() where id=op.id returning * into op;

  if missing_recipes>0 then insert into public.operating_actions(organisation_id,venue_id,service_operation_id,action_key,action_type,title,rationale,why_it_matters,recommended_response,severity,status,expected_impact_minor,evidence_refs,evidence_completeness_basis_points,effort_points,rank_score)
    values(target_organisation_id,op.venue_id,op.id,'recipes:'||op.id,'recipe_gap','Complete product recipes',missing_recipes||' mapped sales products have no effective recipe.','Purchasing and depletion estimates exclude these sales until their product usage is known.','Connect the affected selling products to ingredients or beverages.','high','open',null,jsonb_build_array(jsonb_build_object('missing_recipe_count',missing_recipes)),7000,3,720000)
    on conflict(organisation_id,action_key) do update set rationale=excluded.rationale,evidence_refs=excluded.evidence_refs,updated_at=now(); end if;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload) values(target_organisation_id,op.venue_id,'service_operation',op.id,'service_intelligence.refreshed',auth.uid(),jsonb_build_object('shortage_count',shortage_count,'actual_revenue_minor',actual_revenue,'worked_minutes',worked_minutes,'learning_ready',learning<>'{}'::jsonb));
  return op;
end $$;

create or replace function public.decide_purchase_plan(target_organisation_id uuid,target_plan_id uuid,target_decision text,target_reason text)
returns public.service_purchase_plans language plpgsql security definer set search_path='' as $$
declare plan public.service_purchase_plans;
begin
  select * into plan from public.service_purchase_plans where organisation_id=target_organisation_id and id=target_plan_id for update;
  if plan.id is null or not public.has_capability(target_organisation_id,plan.venue_id,'actions.manage') then raise exception 'forbidden'; end if;
  if target_decision not in ('approved','rejected') or length(trim(target_reason))<5 then raise exception 'invalid_decision'; end if;
  if target_decision='approved' then update public.service_purchase_plans set status='approved',approved_by=auth.uid(),approved_at=now() where id=plan.id returning * into plan;
  else update public.service_purchase_plans set status='draft' where id=plan.id returning * into plan; end if;
  insert into public.service_operation_decisions(organisation_id,venue_id,service_operation_id,decision_type,decision,reason,actor_id,evidence_refs)
    values(target_organisation_id,plan.venue_id,plan.service_operation_id,'purchasing_plan',target_decision,target_reason,auth.uid(),jsonb_build_array(jsonb_build_object('purchase_plan_id',plan.id,'version',plan.version,'expected_cost_minor',plan.expected_cost_minor)));
  return plan;
end $$;

grant select on public.service_learning_results to authenticated;
grant execute on function public.refresh_service_intelligence(uuid,uuid) to authenticated;
grant execute on function public.decide_purchase_plan(uuid,uuid,text,text) to authenticated;

commit;
