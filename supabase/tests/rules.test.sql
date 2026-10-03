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

-- 0. Pilot program: applications come from the server; only an approved link lets a new user create a shop.
select t.act('anon', null);
select t.expect_error($$ select public.record_pilot_request('{"shopName":"X","contactName":"Y","email":"y@x.test"}') $$, '%permission denied%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.expect_error($$ select public.record_pilot_request('{"shopName":"X","contactName":"Y","email":"y@x.test"}') $$, '%permission denied%');
select t.expect_error($$ select public.approve_pilot_request(gen_random_uuid()) $$, '%permission denied%');
select t.expect_error($$ select * from public.pilot_request $$, '%permission denied%');
select t.expect_error($$ select public.create_shop('Sneaky Auto', 'Me', '{"sections":[]}') $$, '%pilot program%');
select t.act('service_role', null);
insert into t.ids select 'pilot', public.record_pilot_request('{"shopName":"Demo Auto","contactName":"Jordan L.","email":"Owner@Shop.test","techs":"4","template":{"points":[]}}');
select t.expect_error($$ select public.record_pilot_request('{"shopName":"X","contactName":"Y","email":"not-an-email"}') $$, '%check constraint%');
reset role;
insert into t.ids select 'pilot_link', public.approve_pilot_request((select v::uuid from t.ids where k = 'pilot'));
insert into t.ids select 'pilot_token', split_part(v, '#/pilot/', 2) from t.ids where k = 'pilot_link';
select t.eq((select length(v) from t.ids where k = 'pilot_token'), 64, 'pilot link carries a 64-character token');
select t.act('anon', null);
select t.eq(public.pilot_invite((select v from t.ids where k = 'pilot_token')) ->> 'shopName', 'Demo Auto', 'pilot link shows the shop name');
select t.eq(public.pilot_invite('nope') is null, true, 'unknown pilot link');

-- 1. Owner creates a shop with a small template, using the pilot link.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
insert into t.ids select 'shop', public.create_shop('Demo Auto', 'Jordan L.',
  '{"id":"shop-mpi","name":"Shop MPI","sections":[{"id":"under_car","name":"Under car","points":[{"id":"S24","name":"Visual brake system condition","note":null,
    "components":[{"classId":73,"position":"left_front","required":true,"when":"always"},{"classId":71,"position":"left_front","required":true,"when":"always"}]}]}]}'::jsonb,
  (select v from t.ids where k = 'pilot_token'));
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.create_shop('Reuse Auto', 'Me', '{"sections":[]}', (select v from t.ids where k = 'pilot_token')) $$, '%pilot program%');
select t.eq(public.pilot_invite((select v from t.ids where k = 'pilot_token')) is null, true, 'a used pilot link is no longer valid');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.expect_error($$ select public.create_shop('Bad', 'X', '{"sections":[{"id":"a","name":"A","points":[{"id":"p","name":"P","components":[{"classId":99999}]}]}]}') $$, '%Unknown part ids%');

-- 2. Invite a technician; they accept.
insert into t.ids select 'invite', public.invite_member((select v::uuid from t.ids where k = 'shop'), 'tech@shop.test', 'technician');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select public.accept_invite((select v from t.ids where k = 'invite'), 'Marcus T.');
select t.expect_error($$ select public.accept_invite((select v from t.ids where k = 'invite'), 'Again') $$, '%no longer valid%');

-- 3. Technician starts an inspection for a new vehicle.
insert into t.ids select 'insp', public.create_inspection((select v::uuid from t.ids where k = 'shop'), 'JTEBU5JR4B5012345', 2011, 'Toyota', '4Runner', 'SR5', '4.0L V6',
  '{"rearBrakes":"disc"}', 'Dana Reyes', '555-0100', 'dana@example.test', '48213', 164210, array['Check engine light on']);
select public.set_vehicle_config((select v::uuid from t.ids where k = 'insp'), '{"rearBrakes":"disc","drivetrain":"4wd"}');
select t.eq((select status from public.inspection), 'not_started', 'vehicle setup does not start the inspection');
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
-- A photo from one point's camera button keeps its point (AI then only considers that point's parts).
select public.add_point_media((select v::uuid from t.ids where k = 'insp'), '00000000-0000-0000-0000-0000000000f9', 'under_car', 'S24',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m9.jpg', 'IMG_9.jpg');
select t.eq((select m ->> 'pointId' from jsonb_array_elements(public.get_inspection((select v::uuid from t.ids where k = 'insp')) -> 'inspection' -> 'media') m
             where m ->> 'id' = '00000000-0000-0000-0000-0000000000f9'), 'S24', 'point photo keeps its point');
select t.expect_error($$ select public.add_point_media((select v::uuid from t.ids where k = 'insp'), gen_random_uuid(), 'under_car', 'S24', 'elsewhere/x.jpg', 'x') $$, '%wrong folder%');
select public.exclude_photo('00000000-0000-0000-0000-0000000000f9');
select public.add_captured_media((select v::uuid from t.ids where k = 'insp'), '00000000-0000-0000-0000-0000000000fa', 'under_car', null, 'left_front',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/ma.jpg', 'IMG_10.jpg');
select t.eq((select m ->> 'corner' from jsonb_array_elements(public.get_inspection((select v::uuid from t.ids where k = 'insp')) -> 'inspection' -> 'media') m
             where m ->> 'id' = '00000000-0000-0000-0000-0000000000fa'), 'left_front', 'camera photo keeps its corner');
select t.expect_error($$ select public.add_captured_media((select v::uuid from t.ids where k = 'insp'), gen_random_uuid(), 'under_car', null, 'upside_down',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/mb.jpg', 'x') $$, '%Unknown corner%');
select public.exclude_photo('00000000-0000-0000-0000-0000000000fa');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.add_point_media((select v::uuid from t.ids where k = 'insp'), gen_random_uuid(), 'under_car', 'S24', 'x/y.jpg', 'x') $$, '%permission%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');

select t.act('service_role', null);
-- One photo shows three parts: rotor (problem), caliper (looks OK), tire (looks OK). A finding the rotor can't have is dropped.
select public.ai_record_sort((select v::uuid from t.ids where k = 'insp'),
  '[{"mediaId":"00000000-0000-0000-0000-0000000000f1","parts":[
     {"key":"71@left_front","confidence":0.9,"condition":"concern","note":"grooves",
      "findings":[{"key":"grooved","severity":"moderate","confidence":0.8,"rationale":"grooves visible"},{"key":"dent","severity":"minor"}]},
     {"key":"72@left_front","confidence":0.85,"condition":"looks_ok","note":"dry, no leaks","findings":[]},
     {"key":"4@left_front","confidence":0.8,"condition":"looks_ok","findings":[]}]}]');
select t.eq((select count(*) from public.media_part), 3::bigint, 'one photo linked to three parts');
select t.eq((select count(*) from public.finding where source = 'ai'), 1::bigint, 'disallowed AI finding dropped');
select t.eq((select status from public.finding where source = 'ai'), 'pending', 'AI finding starts pending');
select t.eq((select count(*) from public.ai_observation where status = 'pending'), 2::bigint, 'two looks-OK suggestions');
select t.eq((select count(*) from public.check_result where component_id in (select component_id from public.ai_observation)), 0::bigint, 'looks-OK counts for nothing yet');
-- Running the AI again on the same photo changes nothing.
select public.ai_record_sort((select v::uuid from t.ids where k = 'insp'),
  '[{"mediaId":"00000000-0000-0000-0000-0000000000f1","parts":[{"key":"73@left_front","confidence":0.9,"condition":"looks_ok"}]}]');
select t.eq((select count(*) from public.media_part), 3::bigint, 'second AI run ignored');

select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{}') $$, '%Resolve 1 AI findings, 1 photos%');
select public.review_finding((select id from public.finding where source = 'ai'), 'confirm');
-- Tech drops the tire from the photo: its pending looks-OK goes with it.
select public.set_photo_parts('00000000-0000-0000-0000-0000000000f1', array['71@left_front', '72@left_front', '73@left_front']);
select t.eq((select string_agg(status, ',' order by status) from public.media_part), 'confirmed,confirmed,technician_added', 'kept links confirmed, added one');
select t.eq((select status from public.ai_observation o join public.component_instance c on c.id = o.component_id where c.class_id = 4), 'rejected', 'removed part''s suggestion rejected');
select t.expect_error($$ select public.review_observations((select v::uuid from t.ids where k = 'insp'), 'confirm',
  jsonb_build_array(jsonb_build_object('id', (select id from public.ai_observation where status = 'pending'), 'check', 'tire.tread_depth'))) $$, '%doesn''t apply%');
select t.eq(public.review_observations((select v::uuid from t.ids where k = 'insp'), 'confirm',
  jsonb_build_array(jsonb_build_object('id', (select id from public.ai_observation where status = 'pending'), 'check', 'brake_caliper.visual'))), 1, 'looks-OK confirmed');
select t.eq((select rating from public.check_result where check_key = 'brake_caliper.visual'), 'ok', 'confirmed looks-OK records OK');
-- A second photo: AI links it; "Confirm placements" confirms it; an unplaced photo blocks submit until excluded.
insert into storage.objects (bucket_id, name) values ('inspection-media', (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m2.jpg');
select public.add_media((select v::uuid from t.ids where k = 'insp'), '00000000-0000-0000-0000-0000000000f2', 'under_car',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m2.jpg', 'IMG_2.jpg');
select public.add_media((select v::uuid from t.ids where k = 'insp'), '00000000-0000-0000-0000-0000000000f3', 'under_car',
  (select v from t.ids where k = 'shop') || '/' || (select v from t.ids where k = 'insp') || '/m3.jpg', 'IMG_3.jpg');
select t.act('service_role', null);
select public.ai_record_sort((select v::uuid from t.ids where k = 'insp'), '[{"mediaId":"00000000-0000-0000-0000-0000000000f2","parts":[{"key":"73@left_front","confidence":0.7,"condition":"unclear"}]}]');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{}') $$, '%Resolve 0 AI findings, 2 photos%');
select t.eq(public.confirm_placements((select v::uuid from t.ids where k = 'insp'), 'under_car'), 1, 'one AI link confirmed');
select public.exclude_photo('00000000-0000-0000-0000-0000000000f3');
select public.set_note((select v::uuid from t.ids where k = 'insp'), 'S24', 'fronts 4mm rotors grooved');
-- Automatic notes: an AI note for a point with a blank tech note is a suggestion that blocks sending until resolved.
select t.act('service_role', null);
select public.ai_record_wording((select v::uuid from t.ids where k = 'insp'), 'S14', 'Brake fluid needs attention now.');
select public.ai_record_wording((select v::uuid from t.ids where k = 'insp'), 'S24', 'Front pads at 4 mm and the rotors are grooved; keep an eye on them.');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.eq((select tech_text || '|' || status from public.point_note where point_id = 'S14'), '|ai_suggested', 'blank note gets a suggestion row');
select t.expect_error($$ select public.submit_inspection((select v::uuid from t.ids where k = 'insp'), '{}') $$, '%and 2 wording suggestions%');
select t.expect_error($$ select public.ai_record_wording((select v::uuid from t.ids where k = 'insp'), 'S14', 'x') $$, '%permission denied%');
select public.resolve_wording((select v::uuid from t.ids where k = 'insp'), 'S14', 'accept');
select public.resolve_wording((select v::uuid from t.ids where k = 'insp'), 'S24', 'reject');
select t.eq((select customer_text from public.point_note where point_id = 'S14'), 'Brake fluid needs attention now.', 'accepted note is what the customer sees');
select t.eq((select customer_text from public.point_note where point_id = 'S24'), 'fronts 4mm rotors grooved', 'rejected keeps the tech note');
select t.eq(public.note_style_for((select v::uuid from t.ids where k = 'insp')), 'customer', 'default note style');
select t.expect_error($$ select public.set_note_style((select v::uuid from t.ids where k = 'shop'), 'technical') $$, '%permission%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.set_note_style((select v::uuid from t.ids where k = 'shop'), 'technical');
select t.eq(public.my_shop_list() -> 0 ->> 'noteStyle', 'technical', 'owner switched to technical notes');
select t.expect_error($$ select public.set_note_style((select v::uuid from t.ids where k = 'shop'), 'poetic') $$, '%Unknown note style%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.eq(public.note_style_for((select v::uuid from t.ids where k = 'insp')) is null, true, 'strangers get no style');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
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
select t.eq((select rating from public.check_result where inspection_id = (select v::uuid from t.ids where k = 'insp') and check_key = 'brake_pad.lining_thickness'), 'monitor', 'old result unchanged');
select t.eq((select count(*) from public.vehicle), 1::bigint, 'same VIN reuses the vehicle');
select t.eq((select count(distinct component_id) from public.check_result where check_key = 'brake_pad.lining_thickness'), 1::bigint, 'same part, same component row across visits');
select t.eq(jsonb_array_length(public.get_vehicle_history((select id from public.vehicle)) -> 'inspections'), 2, 'history has both visits');
select t.eq(jsonb_array_length(public.get_workspace() -> 'jobs'), 2, 'workspace lists jobs');

reset role;

-- Dashboard: members only; dollar amounts only for owners and advisors.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(jsonb_array_length(public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 7) -> 'rows') >= 1, true, 'owner sees inspections');
select t.eq((public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 7) ->> 'money')::boolean, true, 'owner sees money');
select t.eq(jsonb_array_length(public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 7) -> 'events') >= 1, true, 'recent activity');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.eq((public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 7) ->> 'money')::boolean, false, 'technician sees no money');
select t.eq((select bool_and((r ->> 'estimate')::numeric = 0) from jsonb_array_elements(public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 30) -> 'rows') r), true, 'technician gets no estimate totals');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 7) $$, '%permission%');
reset role;

-- Shop numbers: every shop has one, members can list theirs, the pilot link points at wrynch.app.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq((public.my_shop_list() -> 0 ->> 'number')::int >= 1001, true, 'shop has a number from 1001');
select t.eq((select count(distinct number) = count(*) from public.shop), true, 'shop numbers are unique');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.eq(jsonb_array_length(public.my_shop_list()), 0, 'strangers list no shops');
reset role;
select t.eq((select v from t.ids where k = 'pilot_link') like 'https://wrynch.app/#/pilot/%', true, 'pilot link on the app domain');
-- Tekmetric: owners link the shop; repair orders import once (server only); exports are for owners and advisors.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq((public.set_tekmetric_link((select v::uuid from t.ids where k = 'shop'), 12345, true) ->> 'tekmetricShopId')::bigint, 12345::bigint, 'owner links Tekmetric');
select t.eq(length(public.tekmetric_link_for((select v::uuid from t.ids where k = 'shop')) ->> 'webhookToken') >= 32, true, 'owner sees the webhook token');
select t.expect_error($$ select public.set_tekmetric_link((select v::uuid from t.ids where k = 'shop'), -4, true) $$, '%Tekmetric shop ID%');
insert into t.ids select 'tmtoken', public.tekmetric_link_for((select v::uuid from t.ids where k = 'shop')) ->> 'webhookToken';
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.eq(public.tekmetric_link_for((select v::uuid from t.ids where k = 'shop')) ->> 'webhookToken', null, 'technicians do not see the token');
select t.expect_error($$ select public.set_tekmetric_link((select v::uuid from t.ids where k = 'shop'), 1, true) $$, '%permission%');
select t.expect_error($$ select public.tekmetric_import_ro((select v::uuid from t.ids where k = 'shop'), '{"roId": 9}') $$, '%permission denied%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.tekmetric_link_for((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.act('service_role', null);
select t.eq((public.tekmetric_shop_for_token((select v from t.ids where k = 'tmtoken')) ->> 'shopId'), (select v from t.ids where k = 'shop'), 'webhook token finds the shop');
select t.eq(public.tekmetric_shop_for_token('short'), null::jsonb, 'short tokens find nothing');
insert into t.ids select 'tmi', public.tekmetric_import_ro((select v::uuid from t.ids where k = 'shop'),
  '{"roId": 777, "roNumber": "52001", "vin": "1HGCM82633A004352", "year": 2003, "make": "Honda", "model": "Accord", "config": {"powertrain": "gasoline"},
    "customerName": "Pat Lee", "customerPhone": "555-0111", "odometer": 120400, "technician": "Ray K.", "concerns": ["Brake noise", " "]}')::text;
select t.eq((select ro || '|' || technician_name || '|' || odometer || '|' || array_length(concerns, 1) from public.inspection where id = (select v::uuid from t.ids where k = 'tmi')), '52001|Ray K.|120400|1', 'repair order imported');
select t.eq(public.tekmetric_import_ro((select v::uuid from t.ids where k = 'shop'), '{"roId": 777, "roNumber": "52001-A"}')::text, (select v from t.ids where k = 'tmi'), 'importing again updates the same inspection');
select t.eq((select ro from public.inspection where id = (select v::uuid from t.ids where k = 'tmi')), '52001-A', 'RO number refreshed');
select t.expect_error($$ select public.tekmetric_import_ro((select v::uuid from t.ids where k = 'shop'), '{"roId": 778, "vin": ""}') $$, '%no VIN%');
select public.tekmetric_log((select v::uuid from t.ids where k = 'shop'), 'import', 777, (select v::uuid from t.ids where k = 'tmi'), 'ok', 'RO 52001');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq((public.tekmetric_export_info((select v::uuid from t.ids where k = 'tmi')) ->> 'roId')::bigint, 777::bigint, 'owner reads export info');
select t.eq(jsonb_array_length(public.tekmetric_link_for((select v::uuid from t.ids where k = 'shop')) -> 'events'), 1, 'activity is listed');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.tekmetric_export_info((select v::uuid from t.ids where k = 'tmi')) $$, '%permission%');
select t.eq((public.tekmetric_ro_of((select v::uuid from t.ids where k = 'tmi')) ->> 'roId')::bigint, 777::bigint, 'members see the linked RO');
reset role;

-- Approval rate: owners set the before-Wrynch baseline; the dashboard returns it and approved item counts.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.set_approval_baseline((select v::uuid from t.ids where k = 'shop'), 32.5);
select t.eq((public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 30) ->> 'baseline')::numeric, 32.5, 'baseline returned');
select t.eq((select bool_and(r ? 'approvedItems') from jsonb_array_elements(public.shop_dashboard((select v::uuid from t.ids where k = 'shop'), 30) -> 'rows') r), true, 'rows carry approved item counts');
select t.expect_error($$ select public.set_approval_baseline((select v::uuid from t.ids where k = 'shop'), 140) $$, '%0 to 100%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.set_approval_baseline((select v::uuid from t.ids where k = 'shop'), 10) $$, '%permission%');
reset role;

-- Shop AI keys: stored only by the server, encrypted; owners see the last four characters, nobody reads the secret.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(public.assert_shop_owner((select v::uuid from t.ids where k = 'shop')), true, 'owner may manage AI keys');
select t.eq((public.shop_ai_key_info((select v::uuid from t.ids where k = 'shop')) ->> 'configured')::boolean, false, 'no key yet');
select t.expect_error($$ select public.store_shop_ai_key((select v::uuid from t.ids where k = 'shop'), 'openai', 'm', 'v1.a.b', 'wxyz', null) $$, '%permission denied%');
select t.expect_error($$ select * from public.shop_ai_key $$, '%permission denied%');
select t.act('service_role', null);
select public.store_shop_ai_key((select v::uuid from t.ids where k = 'shop'), 'openai', 'gpt-test', 'v1.aXY=.Y3Q=', 'wxyz', '00000000-0000-0000-0000-00000000000a');
select t.eq(public.shop_ai_key_secret((select v::uuid from t.ids where k = 'insp')) ->> 'secret', 'v1.aXY=.Y3Q=', 'server reads the sealed key for an inspection');
select t.expect_error($$ select public.store_shop_ai_key((select v::uuid from t.ids where k = 'shop'), 'openai', null, 'plaintext-key', 'abcd', null) $$, '%check%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(public.shop_ai_key_info((select v::uuid from t.ids where k = 'shop')) ->> 'last4', 'wxyz', 'owner sees the last four');
select t.eq(public.shop_ai_key_info((select v::uuid from t.ids where k = 'shop')) ? 'secret', false, 'the secret is never returned');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.eq(public.shop_ai_key_info((select v::uuid from t.ids where k = 'shop')) ->> 'last4', null, 'technicians do not see key details');
select t.expect_error($$ select public.assert_shop_owner((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.expect_error($$ select public.shop_ai_key_secret((select v::uuid from t.ids where k = 'insp')) $$, '%permission denied%');
select t.expect_error($$ select public.delete_shop_ai_key((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.delete_shop_ai_key((select v::uuid from t.ids where k = 'shop'));
select t.eq((public.shop_ai_key_info((select v::uuid from t.ids where k = 'shop')) ->> 'configured')::boolean, false, 'owner removed the key');
reset role;

-- Training data: shops opt in; only Wrynch staff label; only technician-confirmed photos from opted-in shops.
insert into public.platform_admin (user_id) values ('00000000-0000-0000-0000-00000000000a');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(jsonb_array_length(public.training_queue(50)), 0, 'nothing to label until the shop opts in');
select public.set_share_training((select v::uuid from t.ids where k = 'shop'), true);
select t.eq((public.shop_training_info((select v::uuid from t.ids where k = 'shop')) ->> 'shared')::boolean, true, 'owner opted in');
select t.eq(jsonb_array_length(public.training_queue(50)) >= 1, true, 'confirmed photos are queued');
insert into t.ids select 'tm', public.training_queue(1) -> 0 ->> 'mediaId';
insert into t.ids select 'tc', split_part(public.training_queue(1) -> 0 -> 'parts' ->> 0, '@', 1);
select t.expect_error($$ select public.training_save((select v::uuid from t.ids where k = 'tm'), 'approved',
  jsonb_build_array(jsonb_build_object('classId', (select v::int from t.ids where k = 'tc'), 'x', 0.8, 'y', 0.1, 'w', 0.5, 'h', 0.2)), 800, 600) $$, '%outside the photo%');
select t.expect_error($$ select public.training_save((select v::uuid from t.ids where k = 'tm'), 'approved', '[]', 800, 600) $$, '%at least one box%');
select t.expect_error($$ select public.training_save((select v::uuid from t.ids where k = 'tm'), 'approved', '[{"classId": 999999, "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}]', 800, 600) $$, '%Unknown part type%');
select public.training_save((select v::uuid from t.ids where k = 'tm'), 'approved',
  jsonb_build_array(jsonb_build_object('classId', (select v::int from t.ids where k = 'tc'), 'position', 'left_front', 'x', 0.1, 'y', 0.2, 'w', 0.3, 'h', 0.4, 'source', 'human')), 800, 600);
select t.eq((public.training_stats() -> 'classes' ->> (select v from t.ids where k = 'tc'))::int, 1, 'approved boxes counted per part type');
select t.eq(jsonb_array_length(public.training_export()), 1, 'approved photo exported');
select t.eq((select count(*) from jsonb_array_elements(public.training_queue(50)) q where q ->> 'mediaId' = (select v from t.ids where k = 'tm')), 0::bigint, 'labeled photos leave the queue');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.training_queue(5) $$, '%Wrynch staff%');
select t.expect_error($$ select public.training_export() $$, '%Wrynch staff%');
select t.expect_error($$ select public.set_share_training((select v::uuid from t.ids where k = 'shop'), false) $$, '%permission%');
select t.eq((public.shop_training_info((select v::uuid from t.ids where k = 'shop')) ->> 'admin')::boolean, false, 'technician is not staff');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.set_share_training((select v::uuid from t.ids where k = 'shop'), false);
select t.eq(jsonb_array_length(public.training_export()), 0, 'a shop that stops sharing leaves the export');
select t.expect_error($$ select public.training_save((select v::uuid from t.ids where k = 'tm'), 'skipped', '[]', 800, 600) $$, '%can''t be used%');
reset role;

-- Inspection timing: start and first-submit are stamped by the database; stats per technician.
select t.eq((select started_at is not null and first_submitted_at is not null and first_submitted_at >= started_at
             from public.inspection where id = (select v::uuid from t.ids where k = 'insp')), true, 'start and first submit are recorded');
select t.eq((select started_at from public.inspection where id = (select v::uuid from t.ids where k = 'tmi')), null::timestamptz, 'not-started inspections have no start time');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq((select (x ->> 'inspections')::int >= 1 from jsonb_array_elements(public.technician_stats((select v::uuid from t.ids where k = 'shop'))) x
             where x ->> 'userId' = '00000000-0000-0000-0000-00000000000b'), true, 'owner sees the technician''s count');
select t.eq((select jsonb_array_length(x -> 'recent') >= 1 from jsonb_array_elements(public.technician_stats((select v::uuid from t.ids where k = 'shop'))) x
             where x ->> 'userId' = '00000000-0000-0000-0000-00000000000b'), true, 'recent inspections listed');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.eq(jsonb_array_length(public.technician_stats((select v::uuid from t.ids where k = 'shop'))), 1, 'technicians see only themselves');
select t.expect_error($$ select public.technician_stats((select v::uuid from t.ids where k = 'shop'), '00000000-0000-0000-0000-00000000000a') $$, '%permission%');
select t.eq((public.get_inspection((select v::uuid from t.ids where k = 'insp')) -> 'inspection' ->> 'startedAt') is not null, true, 'inspection document carries the start time');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.technician_stats((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
reset role;

-- Several templates, and checks turned off per template (owners) or for every shop (Wrynch staff).
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(jsonb_array_length(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'templates'), 1, 'the shop starts with one template');
select t.eq(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'templates' -> 0 ->> 'isDefault', 'true', 'and it is the default');
insert into t.ids select 'std', family::text from public.template where shop_id = (select v::uuid from t.ids where k = 'shop') and is_active;
insert into t.ids select 'std_data', data::text from public.template where shop_id = (select v::uuid from t.ids where k = 'shop') and is_active;
-- A courtesy check: the same points, with tire age and the brake pad measurements off (the visual pad check stays).
insert into t.ids select 'courtesy', public.save_template((select v::uuid from t.ids where k = 'shop'), null,
  (select v::jsonb from t.ids where k = 'std_data') || '{"name":"Courtesy check","checksOff":["tire.age","brake_pad.lining_thickness","brake_pad.wear_pattern"]}') ->> 'family';
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), null, (select v::jsonb from t.ids where k = 'std_data') || '{"name":"Bad","checksOff":["tire.made_up_check"]}') $$, '%Unknown checks%');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), null, (select v::jsonb from t.ids where k = 'std_data')
  || '{"name":"Bad","checksOff":["brake_pad.lining_thickness","brake_pad.wear_pattern","brake_pad.visual"]}') $$, '%at least one check%');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), null, (select v::jsonb from t.ids where k = 'std_data') || '{"name":"courtesy CHECK"}') $$, '%already have a template%');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), null, (select v::jsonb from t.ids where k = 'std_data') || '{"name":"  "}') $$, '%name%');
select t.eq(jsonb_array_length(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'templates'), 2, 'two templates');
select t.eq(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'templates' -> 0 ->> 'family', (select v from t.ids where k = 'std'), 'the default is listed first');
select t.eq(public.disabled_checks((select v::uuid from t.ids where k = 'shop')) -> 'shop', '[]'::jsonb, 'nothing is turned off shop-wide any more');
-- A new version keeps the family; inspections already started keep the version they began with.
select t.eq((public.save_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'courtesy'),
  (select data from public.template where family = (select v::uuid from t.ids where k = 'courtesy') and is_active) || '{"note":"v2"}') ->> 'version')::int, 2, 'second version');
select t.eq((select count(*)::int from public.template where family = (select v::uuid from t.ids where k = 'courtesy') and is_active), 1, 'one version in use');
-- An inspection on the courtesy check can't record a check that's off there; a quick OK lands on one that's on.
insert into t.ids select 'cinsp', public.create_inspection((select v::uuid from t.ids where k = 'shop'), '1FTFW1E50JFA00001', 2018, 'Ford', 'F-150', 'XLT', '5.0L V8',
  '{"rearBrakes":"disc"}', 'Lee Carter', '555-0123', '', '48400', 72000, '{}', (select v::uuid from t.ids where k = 'courtesy'));
select t.eq((select t2.family::text from public.inspection i join public.template t2 on t2.id = i.template_id where i.id = (select v::uuid from t.ids where k = 'cinsp')),
  (select v from t.ids where k = 'courtesy'), 'new inspection uses the chosen template');
select t.expect_error($$ select public.set_check((select v::uuid from t.ids where k = 'cinsp'), '73@left_front', 'brake_pad.lining_thickness', 4, null) $$, '%turned off%');
select t.eq(public.set_check((select v::uuid from t.ids where k = 'cinsp'), '73@left_front', 'brake_pad.visual', null, 'monitor'), 'monitor', 'the visual check still records');
select public.mark_ok((select v::uuid from t.ids where k = 'cinsp'), '[{"key": "73@right_front", "check": "brake_pad.lining_thickness"}]');
select t.eq((select check_key from public.check_result c join public.component_instance ci on ci.id = c.component_id
             where c.inspection_id = (select v::uuid from t.ids where k = 'cinsp') and ci.position = 'right_front' and ci.class_id = 73), 'brake_pad.visual', 'quick OK lands on a check that is on');
select t.expect_error($$ select public.set_inspection_template((select v::uuid from t.ids where k = 'cinsp'), (select v::uuid from t.ids where k = 'std')) $$, '%already been recorded%');
-- The standard template still measures pads; a fresh inspection can switch to the courtesy check before work starts.
insert into t.ids select 'sinsp', public.create_inspection((select v::uuid from t.ids where k = 'shop'), '1FTFW1E50JFA00001', null, null, null, null, null, null, '', '', '', '48401', 72100, '{}');
select t.eq(public.set_check((select v::uuid from t.ids where k = 'sinsp'), '73@left_front', 'brake_pad.lining_thickness', 4, null), 'monitor', 'standard template measures pads');
insert into t.ids select 'sinsp2', public.create_inspection((select v::uuid from t.ids where k = 'shop'), '1FTFW1E50JFA00001', null, null, null, null, null, null, '', '', '', '48402', 72100, '{}');
select public.set_inspection_template((select v::uuid from t.ids where k = 'sinsp2'), (select v::uuid from t.ids where k = 'courtesy'));
select t.eq((select status from public.inspection where id = (select v::uuid from t.ids where k = 'sinsp2')), 'not_started', 'switching template does not start the inspection');
select t.expect_error($$ select public.set_check((select v::uuid from t.ids where k = 'sinsp2'), '73@left_front', 'brake_pad.lining_thickness', 4, null) $$, '%turned off%');
-- Default and retiring: the default can't be retired; a retired template can't start inspections, old ones keep it.
select public.set_default_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'courtesy'));
select t.eq(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'template' -> 'data' ->> 'name', 'Courtesy check', 'courtesy check is now the default');
insert into t.ids select 'dinsp', public.create_inspection((select v::uuid from t.ids where k = 'shop'), '1FTFW1E50JFA00001', null, null, null, null, null, null, '', '', '', '48403', 72100, '{}');
select t.eq((select t2.family::text from public.inspection i join public.template t2 on t2.id = i.template_id where i.id = (select v::uuid from t.ids where k = 'dinsp')),
  (select v from t.ids where k = 'courtesy'), 'new inspections use the default');
select t.expect_error($$ select public.archive_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'courtesy')) $$, '%another default%');
select public.set_default_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'std'));
select public.archive_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'courtesy'));
select t.eq(jsonb_array_length(public.get_workspace((select v::uuid from t.ids where k = 'shop')) -> 'templates'), 1, 'retired template is gone from the list');
select t.expect_error($$ select public.create_inspection((select v::uuid from t.ids where k = 'shop'), '1FTFW1E50JFA00001', null, null, null, null, null, null, '', '', '', '48404', 1, '{}', (select v::uuid from t.ids where k = 'courtesy')) $$, '%isn''t available%');
select t.eq(public.get_inspection((select v::uuid from t.ids where k = 'cinsp')) -> 'template' ->> 'name', 'Courtesy check', 'started inspections keep their template');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'courtesy'), (select v::jsonb from t.ids where k = 'std_data')) $$, '%isn''t available%');
-- The one-argument save still versions the default template.
select public.save_template((select v::uuid from t.ids where k = 'shop'), (select v::jsonb from t.ids where k = 'std_data') || '{"checksOff":["tire.age"]}');
select t.eq((select data -> 'checksOff' from public.template where family = (select v::uuid from t.ids where k = 'std') and is_active), '["tire.age"]'::jsonb, 'default template saved');
-- Only owners manage templates; technicians can still pick one for a new inspection.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.save_template((select v::uuid from t.ids where k = 'shop'), null, (select v::jsonb from t.ids where k = 'std_data') || '{"name":"Tech"}') $$, '%permission%');
select t.expect_error($$ select public.set_default_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'std')) $$, '%permission%');
select t.expect_error($$ select public.archive_template((select v::uuid from t.ids where k = 'shop'), (select v::uuid from t.ids where k = 'std')) $$, '%permission%');
select t.expect_error($$ select public.set_platform_check_enabled('wheel.lug_nuts', false) $$, '%Wrynch staff%');
select t.eq(public.disabled_checks((select v::uuid from t.ids where k = 'shop')) ->> 'admin', 'false', 'technician reads the list, not staff');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.disabled_checks((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select public.set_platform_check_enabled('tire.age', false);
select t.eq(public.disabled_checks(null) -> 'platform', '["tire.age"]'::jsonb, 'staff turned a check off for everyone');
select t.expect_error($$ select public.set_platform_check_enabled((select key from public.condition_check where class_id = 1 limit 1), false) $$, '%at least one check%');
select public.set_platform_check_enabled('tire.age', true);
reset role;

-- Declined work: owners and advisors read the visits behind sent reports and record what they did about each part.
select t.act('authenticated', '00000000-0000-0000-0000-00000000000a');
select t.eq(jsonb_array_length(public.declined_work((select v::uuid from t.ids where k = 'shop')) -> 'inspections') >= 1, true, 'visits of vehicles with sent reports');
select t.eq((select count(*)::int from jsonb_array_elements(public.declined_work((select v::uuid from t.ids where k = 'shop')) -> 'inspections') x where x ->> 'status' = 'not_started'), 0, 'inspections not started are left out');
select t.eq(public.declined_work((select v::uuid from t.ids where k = 'shop')) -> 'vehicles' -> 0 ->> 'vin', 'JTEBU5JR4B5012345', 'with their vehicles');
select t.eq(public.set_followup((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'contacted', null, 'Texted Dana') ->> 'contacts', '1', 'a text is counted');
select t.eq(public.set_followup((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'contacted', null, null) ->> 'contacts', '2', 'and the next one');
select t.eq(public.set_followup((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'booked', '2026-11-01', null) ->> 'contacts', '2', 'booking keeps the count');
select t.eq(public.declined_work((select v::uuid from t.ids where k = 'shop')) -> 'followups' -> 0 ->> 'status', 'booked', 'follow-up listed');
select t.eq(public.declined_work((select v::uuid from t.ids where k = 'shop')) -> 'followups' -> 0 ->> 'compKey', '73@left_front', 'by part');
select t.expect_error($$ select public.set_followup((select v::uuid from t.ids where k = 'insp'), '71@left_front', 'contacted', null, null) $$, '%approved this work%');
select t.expect_error($$ select public.set_followup((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'lost', null, null) $$, '%Unknown status%');
select t.expect_error($$ select public.set_followup((select v::uuid from t.ids where k = 'cinsp'), '73@left_front', 'contacted', null, null) $$, '%customer has seen%');
select t.expect_error($$ insert into public.declined_followup (inspection_id, component_id) values ((select v::uuid from t.ids where k = 'insp'), gen_random_uuid()) $$, '%permission denied%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000b');
select t.expect_error($$ select public.declined_work((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.expect_error($$ select public.set_followup((select v::uuid from t.ids where k = 'insp'), '73@left_front', 'dismissed', null, null) $$, '%permission%');
select t.act('authenticated', '00000000-0000-0000-0000-00000000000c');
select t.expect_error($$ select public.declined_work((select v::uuid from t.ids where k = 'shop')) $$, '%permission%');
select t.eq((select count(*)::int from public.declined_followup), 0, 'other shops see none of it');
reset role;

\echo ALL DATABASE TESTS PASSED
