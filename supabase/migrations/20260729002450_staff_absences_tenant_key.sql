-- 20260729002500_governed_split_replacements declares a composite tenant foreign
-- key to staff_absences(organisation_id,id), but no earlier migration created that
-- unique key, so 002500 failed on every database. id is already the primary key,
-- so this constraint can never conflict with existing rows.
-- Applied to production (ytqejzrjfwirpxpxedxb) on 2026-10-17 as
-- "staff_absences_tenant_key" before 002500.
begin;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.staff_absences'::regclass and conname='staff_absences_org_id_unique'
  ) then
    alter table public.staff_absences add constraint staff_absences_org_id_unique unique(organisation_id,id);
  end if;
end $$;
commit;
