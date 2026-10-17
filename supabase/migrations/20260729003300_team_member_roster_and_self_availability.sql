-- Team members see only published rosters, read their own week with the
-- colleagues they work with, and give availability per night themselves.

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

-- Availability per night, given by the employee or DJ themselves.
-- entries = [{date "YYYY-MM-DD", availability}] ; a night runs 18:00 -> 05:00 local,
-- the same window the WhatsApp availability link uses. The latest answer for a night wins;
-- an empty availability clears the night.
create or replace function public.set_my_availability(
  target_organisation_id uuid, target_venue_id uuid, target_entries jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare me public.staff_profiles; item jsonb; venue_tz text; night date; start_at timestamptz; end_at timestamptz; saved integer:=0;
begin
  select * into me from public.staff_profiles where organisation_id=target_organisation_id and auth_user_id=auth.uid();
  if me.id is null or me.employment_status='deactivated' then raise exception 'no_staff_profile'; end if;
  if not exists(select 1 from public.staff_venue_assignments a where a.organisation_id=target_organisation_id and a.staff_id=me.id and a.venue_id=target_venue_id) then raise exception 'not_assigned_to_venue'; end if;
  select coalesce(nullif(timezone,''),'Europe/Amsterdam') into venue_tz from public.venues where organisation_id=target_organisation_id and id=target_venue_id;
  if jsonb_typeof(target_entries)<>'array' or jsonb_array_length(target_entries)>120 then raise exception 'invalid_entries'; end if;
  for item in select value from jsonb_array_elements(target_entries) loop
    night=(item->>'date')::date;
    if night<current_date-1 or night>current_date+180 then raise exception 'date_out_of_range'; end if;
    if coalesce(item->>'availability','') not in ('','available','preferred','preferably_not','unavailable') then raise exception 'invalid_availability'; end if;
    start_at=(night+time '18:00') at time zone venue_tz;
    end_at=((night+1)+time '05:00') at time zone venue_tz;
    delete from public.staff_availability
      where organisation_id=target_organisation_id and venue_id=target_venue_id and staff_id=me.id
        and source in ('employee','availability_link')
        and starts_at>=(night+time '00:00') at time zone venue_tz and starts_at<((night+1)+time '00:00') at time zone venue_tz;
    if coalesce(item->>'availability','')<>'' then
      insert into public.staff_availability(organisation_id,venue_id,staff_id,starts_at,ends_at,availability,note,source,created_by,submitted_at,provenance)
      values(target_organisation_id,target_venue_id,me.id,start_at,end_at,item->>'availability',nullif(left(item->>'note',300),''),'employee',auth.uid(),now(),jsonb_build_object('source','my_roster'));
    end if;
    saved=saved+1;
  end loop;
  update public.roster_proposals set status='stale' where organisation_id=target_organisation_id and venue_id=target_venue_id and status='current';
  return jsonb_build_object('saved',saved);
end $$;

revoke execute on function public.get_my_roster(uuid,timestamptz,timestamptz) from public, anon;
revoke execute on function public.set_my_availability(uuid,uuid,jsonb) from public, anon;
grant execute on function public.get_my_roster(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.set_my_availability(uuid,uuid,jsonb) to authenticated;
