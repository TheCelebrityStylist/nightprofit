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
    'select min(id) id from public.stock_locations',
    'select (array_agg(id order by id))[1] id from public.stock_locations'
  );

  if repaired_definition = function_definition then
    raise exception 'begin_reconciliation UUID minimum expression not found; inspect function before repair';
  end if;

  execute repaired_definition;
end $$;

revoke all privileges on function public.begin_reconciliation(uuid,uuid,date,text,bigint)
  from public, anon;
grant execute on function public.begin_reconciliation(uuid,uuid,date,text,bigint)
  to authenticated;

commit;
