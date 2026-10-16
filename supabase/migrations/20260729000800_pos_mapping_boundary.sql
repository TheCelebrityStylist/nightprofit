begin;

do $$
declare
  function_definition text;
  repaired_definition text;
begin
  if exists(
    select 1
    from public.source_mappings
    where status = 'confirmed'
    group by organisation_id, venue_id, connector_key, source_type, source_value
    having count(*) > 1
  ) then
    raise exception 'duplicate confirmed venue mapping exists; inspect and repair explicitly';
  end if;

  select pg_get_functiondef(
    'public.confirm_pos_mapping(uuid,uuid,text,uuid,integer,jsonb,date)'::regprocedure
  ) into function_definition;

  repaired_definition := replace(
    function_definition,
    'target_organisation_id::text||'':pos_csv:product:''||target_source_value',
    'target_organisation_id::text||'':''||target_venue_id::text||'':pos_csv:product:''||target_source_value'
  );
  repaired_definition := replace(
    repaired_definition,
    'where organisation_id=target_organisation_id and connector_key=''pos_csv''',
    'where organisation_id=target_organisation_id and venue_id is not distinct from target_venue_id and connector_key=''pos_csv'''
  );

  if repaired_definition = function_definition
    or repaired_definition not like '%venue_id is not distinct from target_venue_id%'
  then
    raise exception 'confirm_pos_mapping definition did not match the reviewed repair preconditions';
  end if;

  execute repaired_definition;
end $$;

alter function public.confirm_pos_mapping(uuid,uuid,text,uuid,integer,jsonb,date)
  security definer;
revoke all privileges on function public.confirm_pos_mapping(uuid,uuid,text,uuid,integer,jsonb,date)
  from public, anon;
grant execute on function public.confirm_pos_mapping(uuid,uuid,text,uuid,integer,jsonb,date)
  to authenticated;

create unique index source_mappings_confirmed_venue_unique
  on public.source_mappings(
    organisation_id,
    coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
    connector_key,
    source_type,
    source_value
  )
  where status = 'confirmed';

drop index public.source_mappings_confirmed_unique;

commit;
