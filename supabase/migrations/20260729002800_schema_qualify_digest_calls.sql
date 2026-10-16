-- publish_roster_v2 and calculate_approved_labour_result run with search_path=''
-- but called pgcrypto's digest() unqualified, so every roster publication and every
-- labour approval failed with "function digest(text, unknown) does not exist".
-- Rewrites only the unqualified call sites; idempotent.
-- Applied to production (ytqejzrjfwirpxpxedxb) on 2026-10-17.
begin;
do $$
declare fn oid; def text; fixed text;
begin
  for fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosrc ~ '(?<![.a-z_])digest\s*\('
  loop
    def := pg_get_functiondef(fn);
    fixed := regexp_replace(def, '(?<![.a-z_])digest\s*\(', 'extensions.digest(', 'g');
    if fixed <> def then execute fixed; end if;
  end loop;
end $$;
commit;
