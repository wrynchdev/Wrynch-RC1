-- Permission and inspection-rule tests. Run with scripts/test-db.sh (or in CI).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema if not exists t;
-- Act as a signed-in user (or anon / service_role) for the following statements.
create or replace function t.act(p_role text, p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user)::text, '{}'), false);
  execute format('set role %I', p_role);
end $$;
create or replace function t.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error matching "%" from: %', p_like, p_sql;
exception when others then
  if sqlerrm like 'expected an error%' then raise; end if;
  if sqlerrm not ilike p_like then raise exception 'wrong error for %: got "%", wanted "%"', p_sql, sqlerrm, p_like; end if;
end $$;
create or replace function t.eq(a anyelement, b anyelement, what text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception '% : got %, expected %', what, a, b; end if; end $$;
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;
create table t.ids (k text primary key, v text);
grant all on t.ids to anon, authenticated, service_role;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'owner@shop.test'),
  ('00000000-0000-0000-0000-00000000000b', 'tech@shop.test'), ('00000000-0000-0000-0000-00000000000c', 'stranger@other.test');

-- 1. Owner creates a shop with a small template.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
insert into t.ids select 'shop', public.create_shop('Demo Auto', 'Jordan L.',
  '{"id":"shop-mpi","name":"Shop MPI","sections":[{"id":"under_car","name":"Under car","points":[{"id":"S24","name":"Visual brake system condition","note":null,
    "components":[{"classId":73,"position":"left_front","required":true,"when":"always"},{"classId":71,"position":"left_front","required":true,"when":"always"}]}]}]}'::jsonb);
select t.expect_error($$ select public.create_shop('Bad', 'X', '{"sections":[{"id":"a","name":"A","points":[{"id":"p","name":"P","components":[{"classId":99999}]}]}]}') $$, '%Unknown part ids%');

-- 2. Invite a technician; they accept.
insert into t.ids select 'invite', public.invite_member((select v::uuid from t.ids where k = 'shop'), 'tech@shop.test', 'technician');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select public.accept_invite((select v from t.ids where k = 'invite'), 'Marcus T.');
select t.expect_error($$ select public.accept_invite((select v from t.ids where k = 'invite'), 'Again') $$, '%no longer valid%');

-- 3. Technician starts an inspection for a new vehicle.
insert into t.ids select 'insp', public.create_inspection((select v::uuid from t.ids where k = 'shop'), 'JTEBU5JR4B5012345', 2011, 'Toyota', '4Runner', 'SR5', '4.0L V6',
  '{"rearBrakes":"disc"}', 'Dana Reyes', '555-0100', 'dana@example.test', '48213', 164210, array['Check engine light on']);
select t.eq(public.set_check((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'brake_pad.lining_thickness', 1.5, null), 'immediate', 'pad 1.5 mm');
select t.eq(public.set_check((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'brake_pad.lining_thickness', 4, 'ok'), 'monitor', 'pad 4 mm ignores picked rating');
select t.eq((select status from public.inspection), 'in_progress', 'first edit starts the inspection');
select t.expect_error($$ select public.set_check((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'tire.tread_depth', 5, null) $$, '%doesn''t apply%');
select t.expect_error($$ select public.add_finding((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'dent', 'minor') $$, '%isn''t used for this part%');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), '{}') $$, '%permission%');

-- 4. Nobody writes tables directly.
select t.expect_error($$ insert into public.finding (inspection_id, component_id, finding_key, severity, source, status, reviewed_at)
  select (select v::uuid from t.ids where k = 'insp'), id, 'worn', 'minor', 'technician', 'confirmed', now() from public.component_instance limit 1 $$, '%permission denied%');
select t.expect_error($$ update public.inspection set status = 'sent' $$, '%permission denied%');
select t.expect_error($$ delete from public.check_result $$, '%permission denied%');
-- ...and browsers can't write AI output or read the customer report function.
select t.expect_error($$ select public.ai_record_sort((select v::uuid from t.ids where k = 'insp'), '[]') $$, '%permission denied%');
select t.expect_error($$ select public.customer_report('x') $$, '%permission denied%');

-- 5. A stranger sees nothing.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.eq((select count(*) from public.inspection), 0::bigint, 'stranger reads no inspections');
select t.eq((select count(*) from public.vehicle), 0::bigint, 'stranger reads no vehicles');
select t.expect_error($$ select public.get_inspection((select v::uuid from t.ids where k = 'insp')) $$, '%permission%');
select t.expect_error($$ insert into storage.objects (bucket_id, name) values ('inspection-media', (select v from t.ids where k = 'shop') || '/x/y.jpg') $$, '%row-level security%');

-- 6. Photo upload + AI proposals (server) + review gate.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
insert into storage.objects (bucket_id, name) values ('inspection-media', (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m1.jpg');
select public.add_media((select v::uuid from t.ids where k = 'insp'), '00000000-0000-0000-0000-0000000000f1', 'under_car',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m1.jpg', 'IMG_1.jpg');
select t.expect_error($$ select public.add_media((select v::uuid from t.ids where k = 'insp'), gen_random_uuid(), 'under_car', 'elsewhere/x.jpg', 'x') $$, '%wrong folder%');

select t.act('service_role', null);
select public.ai_record_sort((select v::uuid from t.ids where k = 'insp'),
  '[{"mediaId":"00000000-0000-0000-0000-0000000000f1","pointId":"S24","key":"71@left_front","confidence":0.9,
     "finding":{"key":"grooved","severity":"moderate","confidence":0.8,"rationale":"grooves visible"}},
    {"mediaId":"00000000-0000-0000-0000-0000000000f1","pointId":"S24","key":"71@left_front","confidence":0.9,"finding":{"key":"dent","severity":"minor"}}]');
select t.eq((select count(*) from public.finding where source = 'ai'), 1::bigint, 'disallowed AI finding dropped; duplicate placement ignored');
select t.eq((select status from public.finding where source = 'ai'), 'pending', 'AI finding starts pending');

select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{}') $$, '%Resolve 1 AI findings, 1 photos%');
select public.review_finding((select id from public.finding where source = 'ai'), 'confirm');
select t.expect_error($$ select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{}') $$, '%Resolve 0 AI findings, 1 photos%');
select t.eq(public.confirm_placements((select v::uuid from t.ids where k = 'insp'), 'under_car'), 1, 'one placement confirmed');
select public.set_note((select v::uuid from t.ids where k = 'insp'), 'S24', 'fronts 4mm rotors grooved');
select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{"immediate":0,"monitor":2,"ok":0}');
select t.expect_error($$ select public.set_check((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'brake_pad.lining_thickness', 9, null) $$, '%submitted and can''t be changed%');
select t.expect_error($$ select public.mark_sent((select v::uuid from t.ids where k = 'insp'), 'link', null, 'sent', null) $$, '%permission%');

-- 7. Customer report only has confirmed content; approvals work once sent.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.save_estimate_line((select v::uuid from t.ids where k = 'insp'), null, '71@left_front', 'Replace front rotors', 180, 120);
select public.mark_sent((select v::uuid from t.ids where k = 'insp'), 'link', null, 'sent', null);
select t.act('service_role', null);
select t.eq(jsonb_array_length(public.customer_report((select report_token from public.inspection)) -> 'inspection' -> 'findings'), 1, 'report findings');
select t.eq(public.customer_report((select report_token from public.inspection)) -> 'inspection' -> 'notes' -> 0 ->> 'techText', '', 'tech note text hidden from customer');
select t.eq(public.customer_report((select report_token from public.inspection)) -> 'vehicle' ? 'customerPhone', false, 'no phone in report');
select public.customer_set_approval((select report_token from public.inspection), '71@left_front', true);
select t.eq((select count(*) from public.customer_approval), 1::bigint, 'approval saved');
select t.expect_error($$ select public.customer_report('not-a-token') $$, '%isn''t valid%');

-- 8. Rating rules are versioned; new inspections use the new version, old results keep theirs.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.save_thresholds((select v::uuid from t.ids where k = 'shop'), '[{"checkKey":"brake_pad.lining_thickness","ok":[">=",6],"immediate":["<=",3]}]');
insert into t.ids select 'insp2', public.create_inspection((select v::uuid from t.ids where k = 'shop'), 'JTEBU5JR4B5012345', null, null, null, null, null, null, '', '', '', '48300', 170000, '{}');
select t.eq(public.set_check((select v::uuid from t.ids where k = 'insp2'), '73@left_front', 'brake_pad.lining_thickness', 3, null), 'immediate', 'new rules: 3 mm is immediate');
select t.eq((select rating from public.check_result where inspection_id = (select v::uuid from t.ids where k = 'insp')), 'monitor', 'old result unchanged');
select t.eq((select count(*) from public.vehicle), 1::bigint, 'same VIN reuses the vehicle');
select t.eq((select count(distinct component_id) from public.check_result), 1::bigint, 'same part, same component row across visits');
select t.eq(jsonb_array_length(public.get_vehicle_history((select id from public.vehicle)) -> 'inspections'), 2, 'history has both visits');
select t.eq(jsonb_array_length(public.get_workspace() -> 'jobs'), 2, 'workspace lists jobs');

reset role;
\echo ALL DATABASE TESTS PASSED
