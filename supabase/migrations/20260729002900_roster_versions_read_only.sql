-- Published roster versions are evidence. The workforce_manager_rosters policy was
-- FOR ALL, letting any workforce manager rewrite or delete published versions
-- (e.g. change cost_minor) through the API. All legitimate writes go through
-- security-definer functions (publish_roster_v2, decide_shift_swap,
-- claim_open_shift_v2, replace_published_shift_segments), which only ever move a
-- version from 'published' to 'superseded'.
-- Applied to production (ytqejzrjfwirpxpxedxb) on 2026-10-17. The policy itself
-- was left in place there (privileges revoked instead); this file also narrows it.
begin;
revoke insert, update, delete, truncate on public.roster_versions from anon, authenticated;
grant select on public.roster_versions to authenticated;

drop policy if exists workforce_manager_rosters on public.roster_versions;
drop policy if exists workforce_manager_rosters_read on public.roster_versions;
create policy workforce_manager_rosters_read on public.roster_versions for select
  using (public.has_capability(organisation_id, venue_id, 'workforce.manage'));

create or replace function public.prevent_published_roster_version_rewrite() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'roster_version_is_immutable'; end if;
  if old.status='published' and new.status='superseded'
     and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
    return new;
  end if;
  raise exception 'roster_version_is_immutable';
end $$;
drop trigger if exists roster_versions_immutable on public.roster_versions;
create trigger roster_versions_immutable before update or delete on public.roster_versions
for each row execute function public.prevent_published_roster_version_rewrite();
commit;
