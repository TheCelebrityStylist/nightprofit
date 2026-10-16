-- Open shifts could never be offered: create_open_shift_offer only accepts published
-- shifts, but validate_roster_version_constraints refused to publish a week containing
-- any open shift. Open shifts now publish as vacancies (offer -> claim -> successor
-- version); availability and qualification checks apply only to assigned shifts.
-- Rest time, overlap, absence and maximum-hours rules are unchanged.
-- Applied to production (ytqejzrjfwirpxpxedxb) on 2026-10-17 and verified end to end:
-- publish with vacancy -> offer -> employee sees 1 eligible offer -> claim -> v2.
begin;
do $$
declare fn oid; def text; fixed text;
  open_rule text := 'if exists(select 1 from public.shifts s where s.organisation_id=new.organisation_id and s.venue_id=new.venue_id and s.status=''draft'' and s.starts_at>=new.window_start and s.starts_at<new.window_end and s.staff_id is null) then raise exception ''open_shift_unresolved''; end if;';
  avail_old text := 'and s.starts_at<new.window_end and not exists(select 1 from public.staff_availability a';
  avail_new text := 'and s.starts_at<new.window_end and s.staff_id is not null and not exists(select 1 from public.staff_availability a';
  qual_old text := 'and s.starts_at<new.window_end and not exists(select 1 from public.staff_role_qualifications q';
  qual_new text := 'and s.starts_at<new.window_end and s.staff_id is not null and not exists(select 1 from public.staff_role_qualifications q';
begin
  select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='validate_roster_version_constraints';
  def := pg_get_functiondef(fn);
  if position(open_rule in def)=0 and position(avail_new in def)>0 then return; end if;
  if (length(def)-length(replace(def,open_rule,'')))/length(open_rule) <> 1 then raise exception 'open-shift rule not found exactly once'; end if;
  if (length(def)-length(replace(def,avail_old,'')))/length(avail_old) <> 1 then raise exception 'availability rule not found exactly once'; end if;
  if (length(def)-length(replace(def,qual_old,'')))/length(qual_old) <> 1 then raise exception 'qualification rule not found exactly once'; end if;
  fixed := replace(replace(replace(def,open_rule,''),avail_old,avail_new),qual_old,qual_new);
  execute fixed;
end $$;
commit;
