begin;

do $$
declare
  function_definition text;
  repaired_definition text;
begin
  select pg_get_functiondef(
    'public.begin_reconciliation(uuid,uuid,date,text,bigint)'::regprocedure
  ) into function_definition;

  repaired_definition := replace(
    function_definition,
    'join public.menu_item_components c on c.organisation_id=s.organisation_id and c.menu_item_id=product_map.target_id',
    'join public.menu_item_components c on c.organisation_id=s.organisation_id and c.menu_item_id=product_map.target_id
      join public.products component_product on component_product.organisation_id=c.organisation_id and component_product.id=c.product_id'
  );
  repaired_definition := replace(
    repaired_definition,
    'sum(case when s.void_minor=0 then s.quantity*c.quantity else 0 end)::numeric(20,6) theoretical',
    'sum(case when s.void_minor=0 then s.quantity*case
          when lower(c.unit) in (''ml'',''milliliter'',''milliliters'') then c.quantity/nullif(component_product.unit_volume_ml,0)
          when lower(c.unit) in (''cl'',''centiliter'',''centiliters'') then c.quantity*10/nullif(component_product.unit_volume_ml,0)
          when lower(c.unit) in (''l'',''liter'',''liters'') then c.quantity*1000/nullif(component_product.unit_volume_ml,0)
          else c.quantity
        end else 0 end)::numeric(20,6) theoretical'
  );

  if repaired_definition = function_definition
    or repaired_definition not like '%component_product.unit_volume_ml%'
  then
    raise exception 'begin_reconciliation recipe-unit expression did not match reviewed repair preconditions';
  end if;

  execute repaired_definition;
end $$;

revoke all privileges on function public.begin_reconciliation(uuid,uuid,date,text,bigint)
  from public, anon;
grant execute on function public.begin_reconciliation(uuid,uuid,date,text,bigint)
  to authenticated;

commit;
