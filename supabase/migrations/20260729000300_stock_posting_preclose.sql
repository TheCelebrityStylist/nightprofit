begin;

insert into public.capability_permissions(capability,description) values
('inventory.count','Create and submit venue stock counts'),
('inventory.post','Post submitted stock counts and compensating movements')
on conflict(capability) do nothing;
insert into public.role_capabilities(role,capability)
select role,'inventory.count' from unnest(array['owner','administrator','manager','venue_manager','employee']::public.member_role[]) role
on conflict do nothing;
insert into public.role_capabilities(role,capability)
select role,'inventory.post' from unnest(array['owner','administrator','manager','venue_manager']::public.member_role[]) role
on conflict do nothing;

create policy stock_counts_counter_insert on public.stock_counts for insert
  with check(public.has_capability(organisation_id,venue_id,'inventory.count') and counter_id=auth.uid());
create policy stock_counts_counter_update on public.stock_counts for update
  using(public.has_capability(organisation_id,venue_id,'inventory.count') and status='draft')
  with check(public.has_capability(organisation_id,venue_id,'inventory.count') and counter_id=auth.uid());
create policy stock_count_lines_counter_manage on public.stock_count_lines for all
  using(exists(select 1 from public.stock_counts c where c.id=count_id and c.organisation_id=organisation_id and c.status='draft' and c.counter_id=auth.uid()))
  with check(exists(select 1 from public.stock_counts c where c.id=count_id and c.organisation_id=organisation_id and c.status='draft' and c.counter_id=auth.uid()));

create or replace function public.create_stock_count(
  target_organisation_id uuid,
  target_venue_id uuid,
  target_location_id uuid,
  target_trading_date date,
  target_count_type text,
  target_counted_at timestamptz,
  target_notes text,
  target_idempotency_key text,
  line_inputs jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare count_id uuid; line jsonb; product_row public.products; exact_value numeric;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'inventory.count') then raise exception 'forbidden'; end if;
  if target_count_type not in ('opening','closing','delivery_verification','spot_check','full_location') then raise exception 'invalid_count_type'; end if;
  if not exists(select 1 from public.stock_locations where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_location_id and active) then raise exception 'location_scope_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||target_idempotency_key,0));
  select id into count_id from public.stock_counts
    where organisation_id=target_organisation_id and immutable_evidence->>'creation_idempotency_key'=target_idempotency_key;
  if count_id is not null then return count_id; end if;
  insert into public.stock_counts(organisation_id,venue_id,location_id,trading_date,count_type,status,counted_at,counter_id,notes,immutable_evidence)
  values(target_organisation_id,target_venue_id,target_location_id,target_trading_date,target_count_type,'draft',target_counted_at,auth.uid(),nullif(trim(target_notes),''),
    jsonb_build_object('creation_idempotency_key',target_idempotency_key))
  returning id into count_id;
  for line in select * from jsonb_array_elements(line_inputs) loop
    select * into product_row from public.products where organisation_id=target_organisation_id and id=(line->>'product_id')::uuid;
    if not found then raise exception 'product_scope_mismatch'; end if;
    if (line->>'packages')::numeric<0 or (line->>'complete_units')::numeric<0 or (line->>'partial_basis_points')::integer not between 0 and 10000 then raise exception 'invalid_count_quantity'; end if;
    exact_value=(line->>'packages')::numeric*product_row.package_quantity+(line->>'complete_units')::numeric+(line->>'partial_basis_points')::numeric/10000;
    insert into public.stock_count_lines(organisation_id,count_id,product_id,packages,complete_units,partial_basis_points,exact_quantity)
    values(target_organisation_id,count_id,product_row.id,(line->>'packages')::numeric,(line->>'complete_units')::numeric,(line->>'partial_basis_points')::integer,exact_value);
  end loop;
  return count_id;
end $$;

create or replace function public.submit_stock_count(target_organisation_id uuid,target_count_id uuid)
returns public.stock_counts language plpgsql security definer set search_path=public as $$
declare result public.stock_counts;
begin
  select * into result from public.stock_counts where organisation_id=target_organisation_id and id=target_count_id for update;
  if not found then raise exception 'count_not_found'; end if;
  if not public.has_capability(result.organisation_id,result.venue_id,'inventory.count') then raise exception 'forbidden'; end if;
  if result.status='submitted' or result.status='posted' then return result; end if;
  if result.status<>'draft' then raise exception 'invalid_count_state'; end if;
  if not exists(select 1 from public.stock_count_lines where organisation_id=target_organisation_id and count_id=target_count_id) then raise exception 'empty_count'; end if;
  update public.stock_counts set status='submitted',submitted_at=now(),updated_at=now() where id=target_count_id returning * into result;
  return result;
end $$;

create or replace function public.post_stock_count(
  target_organisation_id uuid,target_count_id uuid,target_idempotency_key text
) returns public.stock_counts language plpgsql security definer set search_path=public as $$
declare result public.stock_counts; line public.stock_count_lines; movement_kind text; snapshot jsonb;
begin
  select * into result from public.stock_counts where organisation_id=target_organisation_id and id=target_count_id for update;
  if not found then raise exception 'count_not_found'; end if;
  if not public.has_capability(result.organisation_id,result.venue_id,'inventory.post') then raise exception 'forbidden'; end if;
  if result.status='posted' then return result; end if;
  if result.status<>'submitted' then raise exception 'count_not_submitted'; end if;
  movement_kind=case result.count_type when 'opening' then 'opening' when 'closing' then 'closing' else 'approved_correction' end;
  for line in select * from public.stock_count_lines where organisation_id=target_organisation_id and count_id=target_count_id order by product_id loop
    insert into public.stock_movements(organisation_id,venue_id,location_id,product_id,trading_date,movement_type,quantity,source_type,source_id,idempotency_key,evidence,posted_by)
    values(result.organisation_id,result.venue_id,result.location_id,line.product_id,result.trading_date,movement_kind,line.exact_quantity,'stock_count',result.id,
      target_idempotency_key||':'||line.product_id::text,jsonb_build_object('count_id',result.id,'count_line_id',line.id,'count_version',result.version),auth.uid())
    on conflict(organisation_id,idempotency_key) do nothing;
  end loop;
  snapshot=jsonb_build_object('count_id',result.id,'version',result.version,'type',result.count_type,'trading_date',result.trading_date,
    'lines',(select jsonb_agg(jsonb_build_object('line_id',id,'product_id',product_id,'quantity',exact_quantity) order by product_id)
      from public.stock_count_lines where organisation_id=target_organisation_id and count_id=target_count_id),
    'posted_by',auth.uid(),'posted_at',now());
  update public.stock_counts set status='posted',posted_at=now(),posted_by=auth.uid(),
    immutable_evidence=immutable_evidence||jsonb_build_object('posted_snapshot',snapshot,'content_hash',encode(extensions.digest(snapshot::text,'sha256'),'hex')),updated_at=now()
  where id=target_count_id returning * into result;
  insert into public.operational_events(organisation_id,venue_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
  values(result.organisation_id,result.venue_id,'stock_count',result.id,'stock_count.posted',auth.uid(),jsonb_build_object('version',result.version,'content_hash',result.immutable_evidence->>'content_hash'));
  return result;
end $$;

create or replace function public.record_stock_movement(
  target_organisation_id uuid,target_venue_id uuid,target_location_id uuid,target_product_id uuid,
  target_trading_date date,target_movement_type text,target_quantity numeric,target_source_type text,
  target_source_id uuid,target_idempotency_key text,target_evidence jsonb,target_correction_of_id uuid default null
) returns public.stock_movements language plpgsql security definer set search_path=public as $$
declare result public.stock_movements;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'inventory.post') then raise exception 'forbidden'; end if;
  if target_movement_type not in ('receipt','supplier_return','transfer_in','transfer_out','waste','breakage','complimentary','staff_consumption','sampling','preparation','approved_correction')
    or (target_movement_type='approved_correction' and target_quantity=0)
    or (target_movement_type<>'approved_correction' and target_quantity<=0) then raise exception 'invalid_movement'; end if;
  if not exists(select 1 from public.stock_locations where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_location_id) then raise exception 'location_scope_mismatch'; end if;
  if not exists(select 1 from public.products where organisation_id=target_organisation_id and id=target_product_id) then raise exception 'product_scope_mismatch'; end if;
  insert into public.stock_movements(organisation_id,venue_id,location_id,product_id,trading_date,movement_type,quantity,source_type,source_id,idempotency_key,evidence,correction_of_id,posted_by)
  values(target_organisation_id,target_venue_id,target_location_id,target_product_id,target_trading_date,target_movement_type,target_quantity,target_source_type,target_source_id,target_idempotency_key,target_evidence,target_correction_of_id,auth.uid())
  on conflict(organisation_id,idempotency_key) do nothing returning * into result;
  if result.id is null then
    select * into result from public.stock_movements where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  end if;
  return result;
end $$;

revoke insert,update,delete on public.stock_counts,public.stock_count_lines,public.stock_movements from authenticated;
grant select on public.stock_counts,public.stock_count_lines,public.stock_movements to authenticated;
grant execute on function public.create_stock_count(uuid,uuid,uuid,date,text,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.submit_stock_count(uuid,uuid) to authenticated;
grant execute on function public.post_stock_count(uuid,uuid,text) to authenticated;
grant execute on function public.record_stock_movement(uuid,uuid,uuid,uuid,date,text,numeric,text,uuid,text,jsonb,uuid) to authenticated;

commit;
