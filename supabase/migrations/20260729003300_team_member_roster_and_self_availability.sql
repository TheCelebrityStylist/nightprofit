-- Team members see only published rosters, read their own week with the
-- colleagues they work with. Availability answers live in 20260729003400.

-- Drafts are the planner's workspace; the team only sees what was published.
alter policy shifts_read on public.shifts using (
  public.has_capability(organisation_id, venue_id, 'planning.manage')
  or (public.is_venue_member(organisation_id, venue_id) and status in ('published','accepted','completed'))
);

-- Own published shifts in a window, each with the colleagues on the same night.
create or replace function public.get_my_roster(
  target_organisation_id uuid, target_from timestamptz, target_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare me public.staff_profiles; result jsonb;
begin
  select * into me from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid();
  if me.id is null then return jsonb_build_object('staff',null,'shifts','[]'::jsonb); end if;
  if target_to<=target_from or target_to-target_from>interval '120 days' then raise exception 'invalid_window'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'venue_id',s.venue_id,'starts_at',s.starts_at,'ends_at',s.ends_at,'break_minutes',s.break_minutes,
      'status',s.status,'role_name',r.name,'department_kind',d.kind,
      'colleagues',coalesce((
        select jsonb_agg(jsonb_build_object('name',split_part(p.full_name,' ',1),'role_name',r2.name,'starts_at',o.starts_at,'ends_at',o.ends_at) order by o.starts_at,p.full_name)
        from public.shifts o
        join public.staff_profiles p on p.organisation_id=o.organisation_id and p.id=o.staff_id
        join public.operational_roles r2 on r2.organisation_id=o.organisation_id and r2.id=o.role_id
        where o.organisation_id=s.organisation_id and o.venue_id=s.venue_id and o.id<>s.id and o.staff_id is not null
          and o.status in ('published','accepted','completed') and o.starts_at<s.ends_at and o.ends_at>s.starts_at
      ),'[]'::jsonb)
    ) order by s.starts_at),'[]'::jsonb)
  into result
  from public.shifts s
  join public.operational_roles r on r.organisation_id=s.organisation_id and r.id=s.role_id
  join public.departments d on d.organisation_id=s.organisation_id and d.id=s.department_id
  where s.organisation_id=target_organisation_id and s.staff_id=me.id
    and s.status in ('published','accepted','completed') and s.starts_at>=target_from and s.starts_at<target_to;
  return jsonb_build_object('staff',jsonb_build_object('id',me.id,'full_name',me.full_name),'shifts',result);
end $$;

revoke execute on function public.get_my_roster(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_my_roster(uuid,timestamptz,timestamptz) to authenticated;
