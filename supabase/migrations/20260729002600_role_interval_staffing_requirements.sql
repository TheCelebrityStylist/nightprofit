begin;

create or replace view public.current_demand_forecast_intervals with(security_invoker=true,security_barrier=true) as
select i.* from public.demand_forecast_intervals i join public.demand_forecasts f on f.organisation_id=i.organisation_id and f.id=i.forecast_id
where f.status in('draft','approved') and not exists(
  select 1 from public.demand_forecasts newer where newer.organisation_id=f.organisation_id and newer.venue_id=f.venue_id and newer.trading_date=f.trading_date and newer.status in('draft','approved') and(newer.created_at>f.created_at or(newer.created_at=f.created_at and newer.id>f.id))
);
grant select on public.current_demand_forecast_intervals to authenticated,service_role;

create or replace function public.refresh_staffing_requirements(
  target_organisation_id uuid,target_venue_id uuid,target_window_start timestamptz,target_window_end timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare service_date date; venue_timezone text; next_version integer; version_id uuid; version_ids jsonb:='[]'; interval_count integer; evidence jsonb;
begin
  if not public.has_capability(target_organisation_id,target_venue_id,'planning.manage') then raise exception 'forbidden'; end if;
  if target_window_end<=target_window_start or target_window_end-target_window_start>interval '35 days' then raise exception 'invalid_requirement_window'; end if;
  select timezone into venue_timezone from public.venues where organisation_id=target_organisation_id and id=target_venue_id;
  if venue_timezone is null then raise exception 'venue_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||target_venue_id::text||target_window_start::text||target_window_end::text,0));
  for service_date in
    select distinct (i.starts_at at time zone venue_timezone)::date
    from public.current_demand_forecast_intervals i
    where i.organisation_id=target_organisation_id and i.venue_id=target_venue_id and i.starts_at>=target_window_start and i.starts_at<target_window_end
    order by 1
  loop
    select coalesce(max(version),0)+1 into next_version from public.staffing_requirement_versions where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=service_date;
    update public.staffing_requirement_versions set status='superseded' where organisation_id=target_organisation_id and venue_id=target_venue_id and trading_date=service_date and status='current';
    select jsonb_build_object(
      'demand_interval_ids',coalesce(jsonb_agg(i.id order by i.starts_at),'[]'::jsonb),
      'role_ids',(select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb) from public.operational_roles r join public.departments d on d.organisation_id=r.organisation_id and d.id=r.department_id where r.organisation_id=target_organisation_id and d.venue_id=target_venue_id and r.active),
      'method','role_minimum_or_guest_ratio_v1'
    ) into evidence
    from public.current_demand_forecast_intervals i where i.organisation_id=target_organisation_id and i.venue_id=target_venue_id and (i.starts_at at time zone venue_timezone)::date=service_date;
    insert into public.staffing_requirement_versions(organisation_id,venue_id,trading_date,version,interval_minutes,status,input_evidence,calculation_version,created_by)
    values(target_organisation_id,target_venue_id,service_date,next_version,30,'current',evidence,'role-requirements-v1',auth.uid()) returning id into version_id;
    insert into public.staffing_requirement_intervals(organisation_id,venue_id,requirement_version_id,department_id,role_id,starts_at,ends_at,required_staff,expected_revenue_minor)
    select target_organisation_id,target_venue_id,version_id,r.department_id,r.id,i.starts_at,i.ends_at,
      greatest(r.minimum_staff,case when i.expected_guests=0 then 0 else (i.expected_guests+r.guests_per_staff-1)/r.guests_per_staff end),i.expected_revenue_minor
    from public.current_demand_forecast_intervals i
    join public.departments d on d.organisation_id=i.organisation_id and d.venue_id=i.venue_id
    join public.operational_roles r on r.organisation_id=d.organisation_id and r.department_id=d.id and r.active
    where i.organisation_id=target_organisation_id and i.venue_id=target_venue_id and (i.starts_at at time zone venue_timezone)::date=service_date;
    get diagnostics interval_count=row_count;
    version_ids=version_ids||jsonb_build_array(jsonb_build_object('id',version_id,'trading_date',service_date,'version',next_version,'interval_count',interval_count));
    perform public.append_operational_event(target_organisation_id,target_venue_id,'staffing_requirement_version',version_id,'staffing.requirements_refreshed',jsonb_build_object('trading_date',service_date,'version',next_version,'interval_count',interval_count,'calculation_version','role-requirements-v1'),gen_random_uuid());
  end loop;
  if jsonb_array_length(version_ids)=0 then raise exception 'forecast_required'; end if;
  return jsonb_build_object('versions',version_ids,'calculation_version','role-requirements-v1');
end $$;

revoke all on function public.refresh_staffing_requirements(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.refresh_staffing_requirements(uuid,uuid,timestamptz,timestamptz) to authenticated;

commit;
