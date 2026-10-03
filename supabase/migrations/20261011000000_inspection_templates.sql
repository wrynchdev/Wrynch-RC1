-- Several inspection templates per shop (for example a courtesy check and a full brake inspection).
--
-- * A template "family" is one named template; each save adds a version to its family, and an inspection keeps the
--   version it started with. A shop can have many families active at once; one of them is the shop's default.
-- * Which component checks are switched off now belongs to the template, in its data as `checksOff` (catalog check
--   keys). A courtesy check can leave only the visual brake check on while the brake inspection keeps every
--   measurement. Wrynch staff can still switch a check off for every shop. The shop-wide switches that existed
--   before are copied into every template the shop has, so nothing a technician sees changes.
-- * Every part keeps at least one check that is on, and only catalog checks can be listed (nothing can be added).

-- ------------------------------------------------------------------ template families
alter table public.template add column family uuid not null default gen_random_uuid();
-- Until now a shop had one template, so all of a shop's versions belong to one family.
update public.template t set family = f.family
  from (select distinct on (shop_id) shop_id, family from public.template order by shop_id, version) f
 where t.shop_id = f.shop_id;
drop index public.template_one_active;
create unique index template_one_active on public.template (family) where is_active;
alter table public.template drop constraint if exists template_shop_id_version_key;
alter table public.template add constraint template_family_version_key unique (family, version);
create index on public.template (shop_id, family);

alter table public.shop add column default_template uuid;
update public.shop s set default_template = (select family from public.template t where t.shop_id = s.id and t.is_active limit 1);

-- ------------------------------------------------------------------ checks switched off per template
-- Copy the shop-wide switches into every version of the shop's template (in-progress inspections keep behaving as before).
update public.template t set data = jsonb_set(t.data, '{checksOff}', (
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from (
      select jsonb_array_elements_text(coalesce(t.data -> 'checksOff', '[]'::jsonb)) k
      union select d.check_key from public.shop_disabled_check d where d.shop_id = t.shop_id) x))
 where exists (select 1 from public.shop_disabled_check d where d.shop_id = t.shop_id);

create or replace function public.validate_template(p_data jsonb) returns void language plpgsql stable security definer set search_path = public as
$$
declare bad text;
begin
  if jsonb_typeof(p_data -> 'sections') is distinct from 'array' or jsonb_array_length(p_data -> 'sections') = 0 then
    raise exception 'A template needs at least one section' using errcode = '22023';
  end if;
  if p_data ? 'name' and coalesce(trim(p_data ->> 'name'), '') = '' then
    raise exception 'Give the template a name' using errcode = '22023';
  end if;
  select string_agg(distinct x::text, ', ') into bad
    from jsonb_path_query(p_data, '$.sections[*].points[*].components[*].classId') x
    where not exists (select 1 from component_class c where c.id = x::text::int);
  if bad is not null then raise exception 'Unknown part ids in template: %', bad using errcode = '22023'; end if;
  if exists (select 1 from jsonb_path_query(p_data, '$.sections[*].points[*]') p where coalesce(trim(p ->> 'name'), '') = '' or coalesce(p ->> 'id', '') = '') then
    raise exception 'Every point needs an id and a name' using errcode = '22023';
  end if;
  if p_data ? 'checksOff' then
    if jsonb_typeof(p_data -> 'checksOff') <> 'array' then raise exception 'checksOff must be a list of checks' using errcode = '22023'; end if;
    select string_agg(x, ', ') into bad from jsonb_array_elements_text(p_data -> 'checksOff') x
      where not exists (select 1 from condition_check c where c.key = x);
    if bad is not null then raise exception 'Unknown checks in template: %', bad using errcode = '22023'; end if;
    select string_agg(cl.label, ', ' order by cl.label) into bad from component_class cl
     where exists (select 1 from condition_check c where c.class_id = cl.id)
       and not exists (select 1 from condition_check c where c.class_id = cl.id and not (p_data -> 'checksOff' ? c.key));
    if bad is not null then raise exception 'Each part needs at least one check that is on: %', bad using errcode = '22023'; end if;
  end if;
end $$;

-- Is a check off for inspections on this template version: off for every shop, or off in the template.
create function public.template_check_off(p_template uuid, p_check text) returns boolean
  language sql stable security definer set search_path = public as
$$
  select exists (select 1 from platform_disabled_check where check_key = p_check)
      or coalesce((select data -> 'checksOff' ? p_check from template where id = p_template), false);
$$;

-- The check to record a quick "OK" on: the one asked for if it's on, else the part's first check that is on
-- (descriptive checks before measurements).
create function public.usable_check_in(p_template uuid, p_class int, p_check text) returns text
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select key from condition_check where key = p_check and class_id = p_class and not template_check_off(p_template, key)),
    (select key from condition_check where class_id = p_class and not template_check_off(p_template, key) order by value_type = 'numeric', key limit 1),
    p_check);
$$;

-- Recording a check refuses one that's off in this inspection's template, unless it already has a result (so it can be fixed).
create or replace function public.set_check(p_inspection uuid, p_key text, p_check text, p_value numeric, p_rating text) returns text
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid; v_rating text;
begin
  r := editable_inspection(p_inspection);
  v_comp := component_for(r.vehicle_id, p_key);
  if not exists (select 1 from condition_check where key = p_check and class_id = split_part(p_key, '@', 1)::int) then
    raise exception 'Check % doesn''t apply to this part', p_check using errcode = '22023';
  end if;
  if template_check_off(r.template_id, p_check)
     and not exists (select 1 from check_result where inspection_id = p_inspection and component_id = v_comp and check_key = p_check) then
    raise exception 'This check is turned off for this inspection' using errcode = '22023';
  end if;
  if p_value is not null then v_rating := rate_value(r.rules_version_id, p_check, p_value); end if;
  v_rating := coalesce(v_rating, p_rating);
  if v_rating is null or v_rating not in ('ok','monitor','immediate') then raise exception 'Pick a rating' using errcode = '22023'; end if;
  insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
    values (p_inspection, v_comp, p_check, p_value, v_rating, r.rules_version_id, auth.uid())
    on conflict (inspection_id, component_id, check_key) do update
      set value = excluded.value, rating = excluded.rating, recorded_by = excluded.recorded_by, recorded_at = now();
  delete from component_status where inspection_id = p_inspection and component_id = v_comp;
  return v_rating;
end $$;

create or replace function public.mark_ok(p_inspection uuid, p_items jsonb) returns int
  language plpgsql security definer set search_path = public as
$$
declare r inspection; it jsonb; v_comp uuid; n int := 0;
begin
  r := editable_inspection(p_inspection);
  for it in select * from jsonb_array_elements(p_items) loop
    v_comp := component_for(r.vehicle_id, it ->> 'key');
    if exists (select 1 from check_result where inspection_id = p_inspection and component_id = v_comp)
       or exists (select 1 from finding where inspection_id = p_inspection and component_id = v_comp and status <> 'denied')
       or exists (select 1 from component_status where inspection_id = p_inspection and component_id = v_comp) then continue; end if;
    insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
      values (p_inspection, v_comp, usable_check_in(r.template_id, split_part(it ->> 'key', '@', 1)::int, it ->> 'check'), null, 'ok', r.rules_version_id, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.review_observations(p_inspection uuid, p_action text, p_items jsonb) returns int
  language plpgsql security definer set search_path = public as
$$
declare r inspection; it jsonb; o ai_observation; n int := 0; v_class int;
begin
  r := editable_inspection(p_inspection);
  if p_action not in ('confirm','reject') then raise exception 'Unknown action %', p_action using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    select * into o from ai_observation where id = (it ->> 'id')::uuid and inspection_id = p_inspection and status = 'pending' for update;
    if not found then continue; end if;
    update ai_observation set status = case p_action when 'confirm' then 'confirmed' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now() where id = o.id;
    if p_action = 'confirm' then
      if not exists (select 1 from condition_check c join component_instance ci on ci.class_id = c.class_id where ci.id = o.component_id and c.key = it ->> 'check') then
        raise exception 'Check % doesn''t apply to this part', it ->> 'check' using errcode = '22023';
      end if;
      select class_id into v_class from component_instance where id = o.component_id;
      if not exists (select 1 from check_result where inspection_id = p_inspection and component_id = o.component_id)
         and not exists (select 1 from finding where inspection_id = p_inspection and component_id = o.component_id and status <> 'denied')
         and not exists (select 1 from component_status where inspection_id = p_inspection and component_id = o.component_id) then
        insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
          values (p_inspection, o.component_id, usable_check_in(r.template_id, v_class, it ->> 'check'), null, 'ok', r.rules_version_id, auth.uid());
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Which checks are off for every shop, and whether the caller is Wrynch staff. (`shop` stays in the answer, always
-- empty, for apps that still read it; a template's own list travels with the template.)
create or replace function public.disabled_checks(p_shop uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if p_shop is not null and p_shop not in (select public.my_shops()) and not public.is_platform_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'platform', coalesce((select jsonb_agg(check_key order by check_key) from platform_disabled_check), '[]'::jsonb),
    'shop', '[]'::jsonb,
    'admin', public.is_platform_admin());
end $$;

drop function public.set_shop_check_enabled(uuid, text, boolean);
drop function public.usable_check(uuid, int, text);
drop function public.check_disabled(uuid, text);
drop table public.shop_disabled_check;

-- ------------------------------------------------------------------ choosing and managing templates
-- The shop's default template (the version in use): its chosen default, else the oldest template still active.
create function public.default_template(p_shop uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select t.id from template t join shop s on s.id = t.shop_id
   where t.shop_id = p_shop and t.is_active
   order by (t.family is not distinct from s.default_template) desc, (select min(x.created_at) from template x where x.family = t.family), t.id
   limit 1;
$$;

-- The version in use of one of the shop's templates (null family = the default one).
create function public.template_for(p_shop uuid, p_family uuid) returns uuid
  language plpgsql stable security definer set search_path = public as
$$
declare v_id uuid;
begin
  if p_family is null then return default_template(p_shop); end if;
  select id into v_id from template where shop_id = p_shop and family = p_family and is_active;
  if v_id is null then raise exception 'That inspection template isn''t available' using errcode = 'P0002'; end if;
  return v_id;
end $$;

-- Owners: save a template. p_family null makes a new template; otherwise a new version of that one.
create function public.save_template(p_shop uuid, p_family uuid, p_template jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_family uuid := coalesce(p_family, gen_random_uuid()); v_next int; v_name text;
begin
  perform require_role(p_shop, array['owner']);
  perform validate_template(p_template);
  v_name := coalesce(nullif(trim(p_template ->> 'name'), ''), 'Shop MPI');
  if p_family is not null and not exists (select 1 from template where shop_id = p_shop and family = p_family and is_active) then
    raise exception 'That inspection template isn''t available' using errcode = 'P0002';
  end if;
  if exists (select 1 from template where shop_id = p_shop and is_active and family <> v_family and lower(name) = lower(v_name)) then
    raise exception 'You already have a template called %', v_name using errcode = '23505';
  end if;
  -- Pin the current default first, so adding a template never changes which one is the default.
  update shop set default_template = coalesce((select family from template where id = default_template(p_shop)), v_family)
   where id = p_shop and default_template is null;
  select coalesce(max(version), 0) + 1 into v_next from template where family = v_family;
  update template set is_active = false where family = v_family and is_active;
  insert into template (shop_id, family, name, version, data, created_by)
    values (p_shop, v_family, v_name, v_next, p_template, auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'family', v_family, 'version', v_next);
end $$;

-- The original call saves a new version of the shop's default template.
create or replace function public.save_template(p_shop uuid, p_template jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  return (save_template(p_shop, (select family from template where id = default_template(p_shop)), p_template) ->> 'id')::uuid;
end $$;

create function public.set_default_template(p_shop uuid, p_family uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  perform template_for(p_shop, p_family);
  update shop set default_template = p_family where id = p_shop;
end $$;

-- Owners: retire a template. New inspections can't use it; inspections that used it keep it. The default and the
-- last template can't be retired.
create function public.archive_template(p_shop uuid, p_family uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  perform template_for(p_shop, p_family);
  if (select family from template where id = default_template(p_shop)) = p_family then
    raise exception 'Choose another default template before removing this one' using errcode = '22023';
  end if;
  update template set is_active = false where shop_id = p_shop and family = p_family and is_active;
end $$;

-- Switch an inspection to another template, while nothing has been recorded on it yet.
create function public.set_inspection_template(p_inspection uuid, p_family uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection, p_start => false);
  if exists (select 1 from check_result where inspection_id = p_inspection)
     or exists (select 1 from finding where inspection_id = p_inspection)
     or exists (select 1 from media where inspection_id = p_inspection)
     or exists (select 1 from component_status where inspection_id = p_inspection)
     or exists (select 1 from point_note where inspection_id = p_inspection) then
    raise exception 'Work has already been recorded on this inspection, so its template can''t change' using errcode = '55000';
  end if;
  update inspection set template_id = template_for(r.shop_id, p_family) where id = p_inspection;
end $$;

-- New inspections: the template can be chosen (null = the shop's default).
drop function public.create_inspection(uuid, text, int, text, text, text, text, jsonb, text, text, text, text, int, text[]);
create function public.create_inspection(
  p_shop uuid, p_vin text, p_year int, p_make text, p_model text, p_trim text, p_engine text, p_config jsonb,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_ro text, p_odometer int, p_concerns text[],
  p_template uuid default null
) returns uuid language plpgsql security definer set search_path = public as
$$
declare v_vehicle uuid; v_customer uuid; v_id uuid; v_template uuid;
begin
  perform require_role(p_shop, array['owner','advisor','technician']);
  v_template := template_for(p_shop, p_template);
  select id, customer_id into v_vehicle, v_customer from vehicle where shop_id = p_shop and vin = upper(trim(p_vin));
  if v_customer is null and coalesce(trim(p_customer_name), '') <> '' then
    insert into customer (shop_id, name, phone, email) values (p_shop, trim(p_customer_name), nullif(trim(p_customer_phone), ''), nullif(lower(trim(p_customer_email)), ''))
      returning id into v_customer;
  elsif v_customer is not null then
    update customer set name = coalesce(nullif(trim(p_customer_name), ''), name), phone = coalesce(nullif(trim(p_customer_phone), ''), phone),
      email = coalesce(nullif(lower(trim(p_customer_email)), ''), email) where id = v_customer;
  end if;
  if v_vehicle is null then
    insert into vehicle (shop_id, customer_id, vin, year, make, model, trim, engine, config)
      values (p_shop, v_customer, upper(trim(p_vin)), p_year, p_make, p_model, p_trim, p_engine, p_config) returning id into v_vehicle;
  else
    update vehicle set customer_id = v_customer, year = coalesce(p_year, year), make = coalesce(p_make, make), model = coalesce(p_model, model),
      trim = coalesce(p_trim, trim), engine = coalesce(p_engine, engine), config = coalesce(p_config, config) where id = v_vehicle;
  end if;
  insert into inspection (shop_id, vehicle_id, template_id, rules_version_id, ro, odometer, concerns)
    values (p_shop, v_vehicle, v_template,
      (select id from rules_version where shop_id = p_shop and is_active),
      nullif(trim(p_ro), ''), p_odometer, coalesce(p_concerns, '{}'))
    returning id into v_id;
  return v_id;
end $$;

-- Tekmetric imports start on the shop's default template (switchable before work starts).
create or replace function public.tekmetric_import_ro(p_shop uuid, p_ro jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  v_ro bigint := (p_ro ->> 'roId')::bigint;
  v_vin text := upper(trim(coalesce(p_ro ->> 'vin', '')));
  v_id uuid; v_vehicle uuid; v_customer uuid;
begin
  if v_ro is null then raise exception 'Repair order id missing' using errcode = '22023'; end if;
  select id into v_id from inspection where shop_id = p_shop and tekmetric_ro_id = v_ro;
  if v_id is not null then
    update inspection set ro = coalesce(nullif(p_ro ->> 'roNumber', ''), ro),
           technician_name = coalesce(nullif(p_ro ->> 'technician', ''), technician_name),
           odometer = coalesce(odometer, (p_ro ->> 'odometer')::int)
     where id = v_id and status in ('not_started', 'in_progress');
    return v_id;
  end if;
  if length(v_vin) not between 11 and 17 then
    raise exception 'This repair order''s vehicle has no VIN in Tekmetric; add it there, or start the inspection in Wrynch' using errcode = '22023';
  end if;

  select id, customer_id into v_vehicle, v_customer from vehicle where shop_id = p_shop and vin = v_vin;
  if v_customer is null and coalesce(trim(p_ro ->> 'customerName'), '') <> '' then
    insert into customer (shop_id, name, phone, email)
    values (p_shop, trim(p_ro ->> 'customerName'), nullif(trim(p_ro ->> 'customerPhone'), ''), nullif(lower(trim(p_ro ->> 'customerEmail')), ''))
    returning id into v_customer;
  end if;
  if v_vehicle is null then
    insert into vehicle (shop_id, customer_id, vin, year, make, model, trim, engine, config)
    values (p_shop, v_customer, v_vin, (p_ro ->> 'year')::int, nullif(p_ro ->> 'make', ''), nullif(p_ro ->> 'model', ''),
            nullif(p_ro ->> 'trim', ''), nullif(p_ro ->> 'engine', ''), p_ro -> 'config')
    returning id into v_vehicle;
  else
    update vehicle set customer_id = coalesce(v_customer, customer_id) where id = v_vehicle;
  end if;

  insert into inspection (shop_id, vehicle_id, template_id, rules_version_id, ro, odometer, concerns, technician_name, tekmetric_ro_id)
  values (p_shop, v_vehicle, default_template(p_shop),
          (select id from rules_version where shop_id = p_shop and is_active),
          nullif(p_ro ->> 'roNumber', ''), (p_ro ->> 'odometer')::int,
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_ro -> 'concerns', '[]'::jsonb)) x where trim(x) <> ''), '{}'),
          nullif(p_ro ->> 'technician', ''), v_ro)
  returning id into v_id;
  return v_id;
end $$;

-- Workspace: every active template (default first), the default one as `template`, and each job's template name.
create or replace function public.get_workspace(p_shop uuid default null, p_days int default 14) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_shop uuid; v_role text; v_default uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select m.shop_id, m.role into v_shop, v_role from shop_member m
    where m.user_id = auth.uid() and (p_shop is null or m.shop_id = p_shop) order by m.created_at limit 1;
  if v_shop is null then
    return jsonb_build_object('shops', '[]'::jsonb);
  end if;
  v_default := default_template(v_shop);
  return jsonb_build_object(
    'shops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role)) from shop_member m join shop s on s.id = m.shop_id where m.user_id = auth.uid()),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone) from shop s where s.id = v_shop),
    'role', v_role,
    'me', (select jsonb_build_object('userId', user_id, 'name', display_name) from shop_member where shop_id = v_shop and user_id = auth.uid()),
    'members', (select jsonb_agg(jsonb_build_object('userId', user_id, 'name', display_name, 'role', role) order by display_name) from shop_member where shop_id = v_shop),
    'invites', case when v_role = 'owner' then coalesce((select jsonb_agg(jsonb_build_object('email', email, 'role', role, 'token', token, 'createdAt', created_at))
                 from shop_invite where shop_id = v_shop and accepted_at is null and created_at > now() - interval '14 days'), '[]') else '[]' end,
    'template', (select jsonb_build_object('id', id, 'family', family, 'version', version, 'data', data) from template where id = v_default),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'family', t.family, 'version', t.version, 'name', t.name,
        'isDefault', t.id = v_default, 'data', t.data) order by t.id = v_default desc, lower(t.name))
      from template t where t.shop_id = v_shop and t.is_active), '[]'),
    'rules', (select jsonb_build_object('id', rv.id, 'number', rv.number,
        'thresholds', coalesce((select jsonb_agg(jsonb_build_object('checkKey', t.check_key, 'ok', jsonb_build_array(t.ok_op, t.ok_value),
          'immediate', case when t.imm_op is null then null else jsonb_build_array(t.imm_op, t.imm_value) end)) from check_threshold t where t.rules_version_id = rv.id), '[]'))
      from rules_version rv where rv.shop_id = v_shop and rv.is_active),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'ro', coalesce(i.ro, ''), 'status', i.status, 'date', i.inspection_date, 'odometer', coalesce(i.odometer, 0),
        'technician', coalesce(i.technician_name, ''), 'concerns', to_jsonb(i.concerns), 'summary', i.summary,
        'templateId', i.template_id, 'templateName', (select name from template where id = i.template_id),
        'pendingAi', (select count(*) from finding f where f.inspection_id = i.id and f.source = 'ai' and f.status = 'pending'),
        'vehicle', vehicle_doc(i.vehicle_id)) order by i.inspection_date desc, i.created_at desc)
      from inspection i where i.shop_id = v_shop and (i.inspection_date > current_date - p_days or i.status in ('not_started','in_progress','submitted'))), '[]')
  );
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.template_check_off(uuid, text), public.usable_check_in(uuid, int, text), public.default_template(uuid),
  public.template_for(uuid, uuid), public.save_template(uuid, uuid, jsonb), public.set_default_template(uuid, uuid),
  public.archive_template(uuid, uuid), public.set_inspection_template(uuid, uuid),
  public.create_inspection(uuid, text, int, text, text, text, text, jsonb, text, text, text, text, int, text[], uuid) from public, anon;
grant execute on function public.save_template(uuid, uuid, jsonb), public.set_default_template(uuid, uuid), public.archive_template(uuid, uuid),
  public.set_inspection_template(uuid, uuid),
  public.create_inspection(uuid, text, int, text, text, text, text, jsonb, text, text, text, text, int, text[], uuid) to authenticated;
