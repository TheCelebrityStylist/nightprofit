-- Republishing a week superseded the previous version but snapshotted and costed
-- only the shifts that were still 'draft', so already-published shifts vanished from
-- the current roster evidence and labour cost was understated (verified: v1 €101.75,
-- v2 showed €129.50 instead of €231.25). Snapshot, cost and version linkage now cover
-- every draft or published shift in the window. Patches three exact clauses and
-- aborts unless each is found exactly once.
-- Applied to production (ytqejzrjfwirpxpxedxb) on 2026-10-17.
begin;
do $$
declare fn oid; def text; fixed text;
  snap_old text := 'into snapshot from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status=''draft'';';
  snap_new text := 'into snapshot from public.shifts where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status in (''draft'',''published'');';
  cost_old text := 'starts_at<target_window_end and status=''draft'' returning * into result;';
  cost_new text := 'starts_at<target_window_end and status in (''draft'',''published'') returning * into result;';
  link_old text := 'starts_at<target_window_end and status=''draft'';
  insert into public.operational_events';
  link_new text := 'starts_at<target_window_end and status=''draft'';
  update public.shifts set roster_version_id=result.id,updated_at=now()
    where organisation_id=target_organisation_id and venue_id=target_venue_id and starts_at>=target_window_start and starts_at<target_window_end and status=''published'' and roster_version_id is distinct from result.id;
  insert into public.operational_events';
begin
  select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='publish_roster_v2';
  def := pg_get_functiondef(fn);
  if position(snap_new in def)>0 then return; end if; -- already applied
  if (length(def)-length(replace(def,snap_old,'')))/length(snap_old) <> 1 then raise exception 'snapshot clause not found exactly once'; end if;
  if (length(def)-length(replace(def,cost_old,'')))/length(cost_old) <> 1 then raise exception 'cost clause not found exactly once'; end if;
  if (length(def)-length(replace(def,link_old,'')))/length(link_old) <> 1 then raise exception 'link clause not found exactly once'; end if;
  fixed := replace(replace(replace(def,snap_old,snap_new),cost_old,cost_new),link_old,link_new);
  execute fixed;
end $$;
commit;
