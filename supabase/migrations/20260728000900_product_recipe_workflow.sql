begin;

create or replace function public.create_product_with_cost(
  target_organisation_id uuid,
  target_supplier_id uuid,
  target_name text,
  target_brand text,
  target_category text,
  target_sku text,
  target_barcode text,
  target_package_quantity numeric,
  target_unit_volume_ml numeric,
  target_purchase_unit text,
  target_serving_unit text,
  target_net_cost_minor bigint,
  target_vat_basis_points integer,
  target_deposit_minor bigint
) returns public.products
language plpgsql security invoker set search_path=public as $$
declare created_product public.products;
begin
  if not public.has_capability(target_organisation_id,null,'suppliers.manage') then
    raise exception 'forbidden';
  end if;
  if length(trim(target_name))<2 or length(trim(target_category))<2 then raise exception 'invalid_product'; end if;
  if target_package_quantity<=0 or target_net_cost_minor<0 or target_deposit_minor<0 then raise exception 'invalid_amount'; end if;
  if target_vat_basis_points not in (0,900,2100) then raise exception 'invalid_vat'; end if;
  if target_supplier_id is not null and not exists(
    select 1 from public.suppliers where id=target_supplier_id and organisation_id=target_organisation_id
  ) then raise exception 'supplier_scope_mismatch'; end if;

  insert into public.products(
    organisation_id,supplier_id,name,brand,category,sku,barcode,package_quantity,
    unit_volume_ml,deposit_minor,purchase_unit,serving_unit
  ) values (
    target_organisation_id,target_supplier_id,trim(target_name),nullif(trim(target_brand),''),
    trim(target_category),nullif(trim(target_sku),''),nullif(trim(target_barcode),''),
    target_package_quantity,target_unit_volume_ml,target_deposit_minor,
    trim(target_purchase_unit),trim(target_serving_unit)
  ) returning * into created_product;

  insert into public.product_cost_history(
    organisation_id,product_id,effective_at,net_cost_minor,vat_basis_points,deposit_minor
  ) values (
    target_organisation_id,created_product.id,now(),target_net_cost_minor,
    target_vat_basis_points,target_deposit_minor
  );
  insert into public.operational_events(
    organisation_id,aggregate_type,aggregate_id,event_type,actor_id,payload
  ) values (
    target_organisation_id,'product',created_product.id,'product.created',auth.uid(),
    jsonb_build_object('net_cost_minor',target_net_cost_minor,'vat_basis_points',target_vat_basis_points)
  );
  return created_product;
end $$;

create or replace function public.create_menu_item_with_component(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_name text,
  target_category text,
  target_product_id uuid,
  target_quantity numeric,
  target_unit text,
  target_waste_basis_points integer,
  target_gross_price_minor bigint,
  target_vat_basis_points integer,
  target_margin_basis_points integer
) returns public.menu_items
language plpgsql security invoker set search_path=public as $$
declare created_item public.menu_items; product_row public.products; latest_cost bigint; direct_cost bigint; net_price bigint; actual_margin integer;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'suppliers.manage') then raise exception 'forbidden'; end if;
  if target_quantity<=0 or target_gross_price_minor<=0 or target_waste_basis_points not between 0 and 10000 then raise exception 'invalid_amount'; end if;
  select * into product_row from public.products where id=target_product_id and organisation_id=target_organisation_id;
  if not found then raise exception 'product_scope_mismatch'; end if;
  if lower(trim(target_unit))<>lower(trim(product_row.serving_unit)) then raise exception 'unit_mismatch'; end if;
  select net_cost_minor into latest_cost from public.product_cost_history
    where organisation_id=target_organisation_id and product_id=target_product_id
    order by effective_at desc,id desc limit 1;
  if latest_cost is null then raise exception 'missing_cost'; end if;
  direct_cost=round((latest_cost::numeric/ product_row.package_quantity)*target_quantity*(10000+target_waste_basis_points)/10000);
  net_price=round(target_gross_price_minor::numeric*10000/(10000+target_vat_basis_points));
  actual_margin=case when net_price=0 then 0 else ((net_price-direct_cost)*10000/net_price)::integer end;

  insert into public.menu_items(organisation_id,venue_id,name,category,target_margin_basis_points)
  values(target_organisation_id,target_venue_id,trim(target_name),trim(target_category),target_margin_basis_points)
  returning * into created_item;
  insert into public.menu_item_components(organisation_id,menu_item_id,product_id,quantity,unit,waste_basis_points)
  values(target_organisation_id,created_item.id,target_product_id,target_quantity,trim(target_unit),target_waste_basis_points);
  insert into public.menu_price_history(
    organisation_id,menu_item_id,effective_at,gross_price_minor,vat_basis_points,
    direct_cost_snapshot_minor,margin_snapshot_basis_points
  ) values (
    target_organisation_id,created_item.id,now(),target_gross_price_minor,target_vat_basis_points,
    direct_cost,actual_margin
  );
  insert into public.operational_events(
    organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload
  ) values (
    target_organisation_id,target_venue_id,'menu_item',created_item.id,'menu_item.created',auth.uid(),
    jsonb_build_object('direct_cost_minor',direct_cost,'gross_price_minor',target_gross_price_minor,'margin_basis_points',actual_margin)
  );
  return created_item;
end $$;

grant execute on function public.create_product_with_cost(uuid,uuid,text,text,text,text,text,numeric,numeric,text,text,bigint,integer,bigint) to authenticated;
grant execute on function public.create_menu_item_with_component(uuid,uuid,text,text,uuid,numeric,text,integer,bigint,integer,integer) to authenticated;

commit;
