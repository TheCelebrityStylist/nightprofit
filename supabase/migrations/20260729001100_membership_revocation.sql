begin;

alter table public.organisation_members
  add column active boolean not null default true,
  add column disabled_at timestamptz,
  add constraint organisation_members_disabled_state_check
    check((active and disabled_at is null) or (not active and disabled_at is not null));

create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organisation_members member
    where member.organisation_id=org and member.user_id=auth.uid() and member.active)
$$;

create or replace function public.has_role(org uuid,allowed public.member_role[]) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organisation_members member
    where member.organisation_id=org and member.user_id=auth.uid()
      and member.active and member.role=any(allowed))
$$;

create or replace function public.is_venue_member(org uuid,venue uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organisation_members member
    where member.organisation_id=org and member.user_id=auth.uid() and member.active
      and(member.venue_ids is null or venue=any(member.venue_ids)))
$$;

create or replace function public.has_venue_access(
  target_organisation_id uuid,target_venue_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organisation_members member
    where member.organisation_id=target_organisation_id and member.user_id=auth.uid() and member.active
      and(target_venue_id is null
        or not exists(select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id and scoped.user_id=auth.uid())
        or exists(select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id and scoped.user_id=auth.uid()
            and scoped.venue_id=target_venue_id)))
$$;

create or replace function public.has_capability(
  target_organisation_id uuid,target_venue_id uuid,required_capability text
) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organisation_members member
    where member.organisation_id=target_organisation_id and member.user_id=auth.uid() and member.active
      and(target_venue_id is null
        or not exists(select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id and scoped.user_id=auth.uid())
        or exists(select 1 from public.venue_assignments scoped
          where scoped.organisation_id=target_organisation_id and scoped.user_id=auth.uid()
            and scoped.venue_id=target_venue_id))
      and coalesce(
        (select override.allowed from public.member_capability_overrides override
          where override.organisation_id=target_organisation_id and override.user_id=auth.uid()
            and override.capability=required_capability),
        exists(select 1 from public.role_capabilities role_capability
          where role_capability.role=member.role and role_capability.capability=required_capability)))
$$;

revoke all on function public.is_member(uuid) from public;
revoke all on function public.has_role(uuid,public.member_role[]) from public;
revoke all on function public.is_venue_member(uuid,uuid) from public;
revoke all on function public.has_venue_access(uuid,uuid) from public;
revoke all on function public.has_capability(uuid,uuid,text) from public;
grant execute on function public.is_member(uuid) to authenticated,service_role;
grant execute on function public.has_role(uuid,public.member_role[]) to authenticated,service_role;
grant execute on function public.is_venue_member(uuid,uuid) to authenticated,service_role;
grant execute on function public.has_venue_access(uuid,uuid) to authenticated,service_role;
grant execute on function public.has_capability(uuid,uuid,text) to authenticated,service_role;

create or replace function public.record_stock_movement(
  target_organisation_id uuid,target_venue_id uuid,target_location_id uuid,target_product_id uuid,
  target_trading_date date,target_movement_type text,target_quantity numeric,target_source_type text,
  target_source_id uuid,target_idempotency_key text,target_evidence jsonb,target_correction_of_id uuid default null
) returns public.stock_movements language plpgsql security definer set search_path=public as $$
declare result public.stock_movements;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'inventory.post') then raise exception 'forbidden'; end if;
  if target_movement_type not in ('receipt','supplier_return','transfer_in','transfer_out','waste','breakage','complimentary','staff_consumption','sampling','preparation','approved_correction')
    or target_quantity=0
    or (target_movement_type<>'approved_correction' and target_quantity<0) then raise exception 'invalid_movement'; end if;
  if not exists(select 1 from public.stock_locations where organisation_id=target_organisation_id and venue_id=target_venue_id and id=target_location_id) then raise exception 'location_scope_mismatch'; end if;
  if not exists(select 1 from public.products where organisation_id=target_organisation_id and id=target_product_id) then raise exception 'product_scope_mismatch'; end if;
  if target_movement_type='approved_correction' and not exists(
    select 1 from public.stock_movements original
    where original.id=target_correction_of_id
      and original.organisation_id=target_organisation_id
      and original.venue_id=target_venue_id
      and original.location_id=target_location_id
      and original.product_id=target_product_id
      and original.movement_type<>'approved_correction'
  ) then raise exception 'correction_scope_mismatch'; end if;
  if target_movement_type<>'approved_correction' and target_correction_of_id is not null then raise exception 'unexpected_correction_reference'; end if;
  insert into public.stock_movements(organisation_id,venue_id,location_id,product_id,trading_date,movement_type,quantity,source_type,source_id,idempotency_key,evidence,correction_of_id,posted_by)
  values(target_organisation_id,target_venue_id,target_location_id,target_product_id,target_trading_date,target_movement_type,target_quantity,target_source_type,target_source_id,target_idempotency_key,target_evidence,target_correction_of_id,auth.uid())
  on conflict(organisation_id,idempotency_key) do nothing returning * into result;
  if result.id is null then
    select * into result from public.stock_movements where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  end if;
  return result;
end $$;

revoke all on function public.record_stock_movement(uuid,uuid,uuid,uuid,date,text,numeric,text,uuid,text,jsonb,uuid) from public;
grant execute on function public.record_stock_movement(uuid,uuid,uuid,uuid,date,text,numeric,text,uuid,text,jsonb,uuid) to authenticated,service_role;

commit;
