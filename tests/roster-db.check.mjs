// Roster database contract check: applies every migration to an in-process
// PostgreSQL (PGlite) with Supabase auth/storage stubs and asserts RLS,
// double-booking, publication immutability and audit behaviour.
// Run: npm i --no-save @electric-sql/pglite && node tests/roster-db.check.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite({ extensions: { pgcrypto, citext, btree_gist } });
const dir = new URL("../supabase/migrations/", import.meta.url).pathname;
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema auth; create schema storage;
  create extension pgcrypto with schema extensions; create extension citext with schema extensions;
  alter database template1 set search_path = public, extensions;
  set search_path = public, extensions;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
  grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
  grant usage on schema extensions to authenticated, anon;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
`);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  try { await db.exec(`set search_path = public, extensions; ${readFileSync(`${dir}${file}`, "utf8")}`); console.log("applied", file); }
  catch (e) { console.log("FAILED", file, e.message); process.exit(1); }
}
await db.exec("set search_path = public, extensions");

const U = { A: "00000000-0000-0000-0000-00000000000a", V: "00000000-0000-0000-0000-00000000000b", F: "00000000-0000-0000-0000-00000000000c", B: "00000000-0000-0000-0000-00000000000d" };
await db.exec(`insert into auth.users(id,email) values ('${U.A}','a@x'),('${U.V}','v@x'),('${U.F}','f@x'),('${U.B}','b@x')`);
await db.exec(`select set_config('request.jwt.claim.sub','${U.A}',false)`);
const orgA = (await db.query(`select public.create_organisation('Cliniq Group','Cliniq Maastricht') as id`)).rows[0].id;
await db.exec(`select set_config('request.jwt.claim.sub','${U.B}',false)`);
const orgB = (await db.query(`select public.create_organisation('Other Org','Other Venue') as id`)).rows[0].id;
await db.exec(`insert into public.organisation_members(organisation_id,user_id,role) values ('${orgA}','${U.V}','viewer'),('${orgA}','${U.F}','finance')`);
const venueA = (await db.query(`select id from public.venues where organisation_id='${orgA}'`)).rows[0].id;

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => { if (cond) { pass++; console.log("  ✓", label); } else { fail++; console.log("  ✗", label, extra); } };
async function as(user, sql, params = []) {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`);
  try { const r = await db.query(sql, params); await db.exec("commit"); return { rows: r.rows, affected: r.affectedRows }; }
  catch (e) { await db.exec("rollback"); return { error: e.message, code: e.code }; }
}

console.log("\nEmployees & shifts");
const e1 = (await as(U.A, `insert into roster_employees(organisation_id,full_name,phone,hourly_cost_minor,contract_minutes_week) values ($1,'Sanne de Vries','06 12345678',1850,1440) returning id`, [orgA])).rows?.[0]?.id;
const e2 = (await as(U.A, `insert into roster_employees(organisation_id,full_name,hourly_cost_minor) values ($1,'Milan Jansen',1500) returning id`, [orgA])).rows?.[0]?.id;
ok(e1 && e2, "owner creates employees");
const s1 = await as(U.A, `insert into roster_shifts(organisation_id,venue_id,service_date,employee_id,starts_at,ends_at,break_minutes,hourly_cost_minor) values ($1,$2,'2026-10-16',$3,'2026-10-16T20:00:00Z','2026-10-17T02:00:00Z',30,0) returning id,hourly_cost_minor`, [orgA, venueA, e1]);
ok(s1.rows?.[0]?.hourly_cost_minor == 1850, "rate snapshot is taken from employee, client value ignored", JSON.stringify(s1));
const dbl = await as(U.A, `insert into roster_shifts(organisation_id,venue_id,service_date,employee_id,starts_at,ends_at) values ($1,$2,'2026-10-16',$3,'2026-10-17T01:00:00Z','2026-10-17T03:00:00Z')`, [orgA, venueA, e1]);
ok(dbl.code === "23P01", "double booking is blocked by the database", JSON.stringify(dbl));
const open = await as(U.A, `insert into roster_shifts(organisation_id,venue_id,service_date,role,starts_at,ends_at) values ($1,$2,'2026-10-17','security','2026-10-17T21:00:00Z','2026-10-18T03:00:00Z') returning id`, [orgA, venueA]);
ok(open.rows?.length === 1, "open shift (no employee) allowed");
const wrongDay = await as(U.A, `insert into roster_shifts(organisation_id,venue_id,service_date,employee_id,starts_at,ends_at) values ($1,$2,'2026-10-14',$3,'2026-10-18T20:00:00Z','2026-10-18T22:00:00Z')`, [orgA, venueA, e2]);
ok(wrongDay.error?.includes("SHIFT_OUTSIDE_SERVICE_DATE"), "shift must belong to its service date", JSON.stringify(wrongDay));
const longShift = await as(U.A, `insert into roster_shifts(organisation_id,venue_id,service_date,employee_id,starts_at,ends_at) values ($1,$2,'2026-10-18',$3,'2026-10-18T08:00:00Z','2026-10-19T02:00:00Z')`, [orgA, venueA, e2]);
ok(longShift.code === "23514", "shifts longer than 16h are rejected");

console.log("\nPermissions & tenant isolation");
ok((await as(U.V, `select * from roster_shifts`)).rows.length === 0, "viewer cannot read rosters / labour cost");
ok((await as(U.F, `select * from roster_shifts`)).rows.length === 2, "finance can read rosters");
const finIns = await as(U.F, `insert into roster_shifts(organisation_id,venue_id,service_date,starts_at,ends_at) values ($1,$2,'2026-10-15','2026-10-15T20:00:00Z','2026-10-15T23:00:00Z')`, [orgA, venueA]);
ok(!!finIns.error, "finance cannot edit rosters", JSON.stringify(finIns));
ok((await as(U.B, `select * from roster_shifts`)).rows.length === 0 && (await as(U.B, `select * from roster_employees`)).rows.length === 0, "other organisation sees nothing");
const crossIns = await as(U.B, `insert into roster_employees(organisation_id,full_name) values ($1,'Intruder')`, [orgA]);
ok(!!crossIns.error, "other organisation cannot write into this tenant");
const crossUpd = await as(U.B, `update roster_employees set hourly_cost_minor=1 where organisation_id=$1`, [orgA]);
ok(crossUpd.affected === 0, "other organisation cannot update this tenant");

console.log("\nPublication");
const finPub = await as(U.F, `select * from publish_roster_week($1,'2026-10-12')`, [venueA]);
ok(finPub.error?.includes("FORBIDDEN"), "finance cannot publish");
const p1 = await as(U.A, `select * from publish_roster_week($1,'2026-10-12','eerste versie')`, [venueA]);
const pub1 = p1.rows?.[0];
ok(pub1?.version === 1 && pub1.shift_count === 2 && pub1.open_shift_count === 1, "owner publishes version 1", JSON.stringify(p1));
// 6h - 30m = 330 min x 18.50/h = 101.75 ; open shift 6h unpaid-cost
ok(Number(pub1?.labour_cost_minor) === 10175 && Number(pub1?.paid_minutes) === 690, "labour cost computed in integer cents (€101,75; 11u30)", JSON.stringify({ c: pub1?.labour_cost_minor, m: pub1?.paid_minutes }));
const recomputed = (await db.query(`select encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex') as h from roster_publications where id=$1`, [pub1.id])).rows[0].h;
ok(recomputed === pub1.content_hash, "content hash verifies against snapshot");
ok((await as(U.A, `select count(*)::int as n from roster_shifts where changed_since_publish`)).rows[0].n === 0, "shifts marked as published");
const again = await as(U.A, `select * from publish_roster_week($1,'2026-10-12')`, [venueA]);
ok(again.error?.includes("NO_CHANGES_TO_PUBLISH"), "republishing without changes is refused");
const delPub = await as(U.A, `delete from roster_shifts where id=$1`, [s1.rows[0].id]);
ok(delPub.error?.includes("PUBLISHED_SHIFT_CANNOT_BE_DELETED"), "published shift cannot be deleted");
const forge = await as(U.A, `update roster_shifts set published_version=99, changed_since_publish=false where id=$1`, [s1.rows[0].id]);
ok(forge.error?.includes("PUBLICATION_STATE_IS_SYSTEM_MANAGED"), "publication state cannot be forged by the client");
const silent = await as(U.A, `update roster_shifts set changed_since_publish=false, break_minutes=45 where id=$1 returning changed_since_publish`, [s1.rows[0].id]);
ok(silent.rows?.[0]?.changed_since_publish === true, "edits after publication are always flagged");
await as(U.A, `update roster_shifts set status='cancelled' where id=$1`, [s1.rows[0].id]);
const p2 = (await as(U.A, `select * from publish_roster_week($1,'2026-10-12')`, [venueA])).rows?.[0];
ok(p2?.version === 2 && p2.shift_count === 1 && Number(p2.labour_cost_minor) === 0, "cancellation republished as version 2");
const tamper = await as(U.A, `update roster_publications set labour_cost_minor=0`);
ok(tamper.affected === 0 || !!tamper.error, "client cannot alter publications");
let immutable = false; try { await db.query(`update roster_publications set note='x'`); } catch (e) { immutable = e.message.includes("immutable_record"); }
ok(immutable, "publications are immutable even for the database owner");
ok((await as(U.F, `select count(*)::int n from roster_publications`)).rows[0].n === 2, "finance can read publication history");

console.log("\nAvailability & leave");
const av = await as(U.A, `insert into roster_availability(organisation_id,employee_id,service_date,status,source) values ($1,$2,'2026-10-16','available','whatsapp') on conflict(employee_id,service_date) do update set status=excluded.status returning status`, [orgA, e2]);
const av2 = await as(U.A, `insert into roster_availability(organisation_id,employee_id,service_date,status,source) values ($1,$2,'2026-10-16','unavailable','whatsapp') on conflict(employee_id,service_date) do update set status=excluded.status returning status`, [orgA, e2]);
ok(av.rows?.[0]?.status === "available" && av2.rows?.[0]?.status === "unavailable", "availability upsert (one answer per person per day)");
const sick = await as(U.A, `insert into roster_leave(organisation_id,employee_id,kind,starts_on,ends_on) values ($1,$2,'sick','2026-10-16','2026-10-17') returning status,decided_by`, [orgA, e1]);
ok(sick.rows?.[0]?.status === "approved" && sick.rows[0].decided_by === U.A, "sick report is effective immediately and attributed");
const req = await as(U.A, `insert into roster_leave(organisation_id,employee_id,kind,starts_on,ends_on) values ($1,$2,'leave','2026-11-01','2026-11-03') returning id,status`, [orgA, e2]);
ok(req.rows?.[0]?.status === "requested", "leave starts as a request");
const appr = await as(U.A, `update roster_leave set status='approved' where id=$1 returning decided_by,decided_at`, [req.rows[0].id]);
ok(appr.rows?.[0]?.decided_by === U.A && appr.rows[0].decided_at, "approval records who decided and when");
const finLeave = await as(U.F, `insert into roster_leave(organisation_id,employee_id,kind,starts_on,ends_on) values ($1,$2,'leave','2026-11-05','2026-11-05')`, [orgA, e2]);
ok(!!finLeave.error, "finance cannot register leave");

console.log("\nAudit");
const audit = (await db.query(`select action, count(*)::int n from audit_logs where organisation_id=$1 group by 1 order by 1`, [orgA])).rows;
console.log("   ", audit.map((r) => `${r.action}:${r.n}`).join("  "));
ok(audit.some((r) => r.action === "roster.published" && r.n === 2) && audit.some((r) => r.action === "roster_shifts.insert"), "every mutation and publication is in the append-only audit log");
const leaked = (await db.query(`select count(*)::int n from audit_logs where after_summary ? 'hourly_cost_minor' or after_summary ? 'phone'`)).rows[0].n;
ok(leaked === 0, "wages and phone numbers are kept out of the audit log");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
