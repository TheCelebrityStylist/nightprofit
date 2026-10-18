-- Scenario test for 20260729003400. Run against a scratch database with all migrations applied.
\set ON_ERROR_STOP 1
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000a','owner@example.test'),('00000000-0000-0000-0000-00000000000b','sam@example.test');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select set_config('request.jwt.claim.role','authenticated',false);
select public.create_organisation('Cliniq','Cliniq') as org \gset
select id as venue from public.venues where organisation_id=:'org' \gset
insert into public.departments(organisation_id,venue_id,name) values (:'org',:'venue','Bar') returning id as dept \gset
insert into public.operational_roles(organisation_id,department_id,name,hourly_cost_minor,minimum_staff,guests_per_staff) values (:'org',:'dept','Barmedewerker',0,1,60) returning id as role \gset
select public.create_invited_staff(:'org',:'venue',:'dept',:'role','Sam de Vries','','+31612345678','nl','employee',repeat('a',64),now()+interval '7 days')->>'staff_id' as sam \gset
select public.create_invited_staff(:'org',:'venue',:'dept',:'role','Noor Jansen','','+31612345679','nl','employee',repeat('b',64),now()+interval '7 days')->>'staff_id' as noor \gset
select (current_date+((4-extract(isodow from current_date)::int+7)%7)+7) as thu \gset
select public.save_service_pattern(:'org',:'venue',4,true,jsonb_build_array(jsonb_build_object('role_id',:'role','count',2,'start','21:30','end','02:00'))) is not null as pattern_saved;
select public.plan_service_night(:'org',:'venue',:'thu'::date,null)->>'created' as slots_created;

select public.create_availability_request_v4(:'org',:'venue',array[:'thu'::date,:'thu'::date+1,:'thu'::date],now()+interval '2 days',
  jsonb_build_array(
    jsonb_build_object('staff_id',:'sam','token_hash',repeat('c',64),'response_url','https://x/a','language','nl','phone_state','valid','destination_e164','+31612345678'),
    jsonb_build_object('staff_id',:'noor','token_hash',repeat('d',64),'response_url','https://x/b','language','nl','phone_state','valid','destination_e164','+31612345679')),
  'idempotency-key-0001')->>'request_id' as req \gset
select requested_dates from public.availability_request_periods where id=:'req';

-- link: only requested nights are shown and accepted
select public.inspect_availability_request_v3(repeat('c',64))->'nights' as link_nights, public.inspect_availability_request_v3(repeat('c',64))->>'employee_name' as greeting;
select public.submit_availability_request_v3(repeat('c',64),jsonb_build_array(jsonb_build_object('date',:'thu','availability','available'),jsonb_build_object('date',(:'thu'::date+1)::text,'availability','unavailable')))->>'state' as sam_link_state;
do $$ begin perform public.submit_availability_request_v3(repeat('d',64),jsonb_build_array(jsonb_build_object('date',(current_date+60)::text,'availability','available'))); raise exception 'expected night_not_requested'; exception when others then if sqlerrm<>'night_not_requested' then raise; end if; end $$;
select 'ok: unrequested night rejected' as check;
select public.inspect_availability_request_v3(repeat('c',64))->'answers' as sam_answers;

-- app: Noor answers one of two nights in "Mijn rooster"
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000c','noor@example.test');
update public.staff_profiles set auth_user_id='00000000-0000-0000-0000-00000000000c' where id=:'noor';
insert into public.organisation_members(organisation_id,user_id,role,venue_ids,active) values (:'org','00000000-0000-0000-0000-00000000000c','employee',array[:'venue'::uuid],true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select public.set_my_availability(:'org',:'req',jsonb_build_array(jsonb_build_object('date',:'thu','availability','preferably_not')))->>'state' as noor_app_state;
select jsonb_array_length(r->'requests') as open_requests, r->'requests'->0->'answers' as noor_answers, r->'staff'->>'first_name' as first_name
  from (select public.get_my_roster(:'org',now()-interval '1 day',now()+interval '30 days') r) x;
do $$ begin perform public.plan_assign_shifts((select organisation_id from public.venues limit 1),(select id from public.venues limit 1),'[]'::jsonb); raise exception 'expected forbidden'; exception when others then if sqlerrm<>'forbidden' then raise; end if; end $$;
select 'ok: team member cannot plan' as check;

-- planner fills the night
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select array_agg(id order by id) as slots from public.shifts where organisation_id=:'org' and status='draft' \gset
select public.plan_assign_shifts(:'org',:'venue',jsonb_build_array(
  jsonb_build_object('shift_id',(:'slots'::uuid[])[1],'staff_id',:'sam'),
  jsonb_build_object('shift_id',(:'slots'::uuid[])[2],'staff_id',:'noor')))->>'changed' as assigned;
do $$ declare s uuid[]; begin select array_agg(id order by id) into s from public.shifts where status='draft';
  perform public.plan_assign_shifts((select organisation_id from public.venues limit 1),(select id from public.venues limit 1),jsonb_build_array(jsonb_build_object('shift_id',s[2],'staff_id',(select staff_id from public.shifts where id=s[1]))));
  raise exception 'expected shift_overlap'; exception when others then if sqlerrm<>'shift_overlap' then raise; end if; end $$;
select 'ok: double booking rejected' as check;
select (public.publish_roster_v2(:'org',:'venue',(:'thu'::date)::timestamptz-interval '1 day',(:'thu'::date)::timestamptz+interval '7 days',
  (select max(revision) from public.shifts where organisation_id=:'org' and status='draft'),'publish-key-000001','[]'::jsonb)).version as published_version;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select jsonb_array_length(public.get_my_roster(:'org',now()-interval '1 day',now()+interval '30 days')->'shifts') as noor_shifts_after_publish;

-- change after publish: slot goes back to draft, then can be removed and re-added
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select public.plan_assign_shifts(:'org',:'venue',jsonb_build_array(jsonb_build_object('shift_id',(:'slots'::uuid[])[2],'staff_id',null)))->>'changed' as cleared;
select status, staff_id is null as open from public.shifts where id=(:'slots'::uuid[])[2];
select public.plan_remove_open_shifts(:'org',:'venue',array[(:'slots'::uuid[])[2]])->>'removed' as removed;
select public.plan_add_open_shift(:'org',:'venue',:'role',(select starts_at from public.shifts where id=(:'slots'::uuid[])[1]),(select ends_at from public.shifts where id=(:'slots'::uuid[])[1])) is not null as slot_added;
select public.reissue_staff_invitation(:'org',:'sam',repeat('e',64),now()+interval '14 days')->>'invitation_id' is not null as reinvited;
select count(*) filter (where revoked_at is null) as live_invites, count(*) as all_invites from public.staff_onboarding_invitations where staff_id=:'sam';
select has_function_privilege('authenticated','public.create_organisation(text,text)','execute') as self_signup_can_create_org;
-- changing an answer overwrites the night instead of adding a second row
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select public.set_my_availability(:'org',:'req',jsonb_build_array(jsonb_build_object('date',:'thu','availability','available'),jsonb_build_object('date',(:'thu'::date+1)::text,'availability','unavailable')))->>'state' as noor_complete_state;
select count(*) as noor_rows from public.staff_availability a join public.availability_request_recipients r on r.id=a.request_recipient_id where r.staff_id=:'noor';
