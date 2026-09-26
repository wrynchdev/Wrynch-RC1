-- Wrynch core schema for Supabase (PostgreSQL 15+).
--
-- Design rules:
--  * Every table has row-level security. Members of a shop can READ their shop's rows.
--  * Nobody writes tables directly. All writes go through the functions below (SECURITY DEFINER),
--    which check the caller's shop role and enforce the inspection rules:
--      R3  numeric checks are rated on the server from the shop's rating rules
--      R4/R10  AI findings start 'pending' and count for nothing until a technician reviews them
--      R11 the customer report only ever contains technician-confirmed content
--      R12 an inspection can't be submitted while any AI finding, photo placement or wording is pending
--  * AI proposals can only be written by the server (service_role), never by a browser.
--  * The component catalog (classes, checks, findings) is loaded by the next migration.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ catalog
create table public.component_class (
  id               integer primary key,              -- permanent; never renumbered or reused
  name             text not null unique,
  label            text not null,
  category         text not null,
  safety_critical  boolean not null,
  ai_photo         text not null check (ai_photo in ('yes','partial','no')),
  position_rule    text not null,
  allowed_positions text[] not null default '{}'
);

create table public.finding_type (
  key        text primary key,
  label      text not null,
  definition text not null
);

-- Allowed findings per class, with the default rating at each severity (rule R2).
create table public.class_finding (
  class_id    integer not null references public.component_class(id),
  finding_key text not null references public.finding_type(key),
  ratings     text[] not null check (array_length(ratings, 1) = 4 and ratings[4] = 'immediate'),
  primary key (class_id, finding_key)
);

create table public.condition_check (
  key         text primary key,
  class_id    integer not null references public.component_class(id),
  name        text not null,
  unit        text,
  value_type  text not null check (value_type in ('numeric','categorical','pass_fail','visual')),
  -- catalog default thresholds (null = rated by the technician)
  ok_op       text check (ok_op in ('<','<=','>','>=')),
  ok_value    numeric,
  imm_op      text check (imm_op in ('<','<=','>','>=')),
  imm_value   numeric
);

-- ------------------------------------------------------------------ shops and people
create table public.shop (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  phone      text,
  created_at timestamptz not null default now()
);

create table public.shop_member (
  shop_id      uuid not null references public.shop(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','advisor','technician')),
  display_name text not null,
  created_at   timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index on public.shop_member (user_id);

create table public.shop_invite (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shop(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('owner','advisor','technician')),
  token       text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  accepted_by uuid,
  accepted_at timestamptz
);

-- Templates are versioned JSON documents (stages -> points -> components); editing creates a new version.
create table public.template (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shop(id) on delete cascade,
  name       text not null,
  version    integer not null,
  data       jsonb not null,
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, version)
);
create unique index template_one_active on public.template (shop_id) where is_active;

-- Rating rules: a version is a set of overrides on the catalog defaults. Results keep the version they used.
create table public.rules_version (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shop(id) on delete cascade,
  number     integer not null,
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, number)
);
create unique index rules_one_active on public.rules_version (shop_id) where is_active;

create table public.check_threshold (
  rules_version_id uuid not null references public.rules_version(id) on delete cascade,
  check_key  text not null references public.condition_check(key),
  ok_op      text not null check (ok_op in ('<','<=','>','>=')),
  ok_value   numeric not null,
  imm_op     text check (imm_op in ('<','<=','>','>=')),
  imm_value  numeric,
  primary key (rules_version_id, check_key),
  check ((imm_op is null) = (imm_value is null))
);

-- ------------------------------------------------------------------ customers, vehicles, components
create table public.customer (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  name    text not null,
  phone   text,
  email   text
);

create table public.vehicle (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shop(id) on delete cascade,
  customer_id uuid references public.customer(id),
  vin         text not null check (length(vin) between 11 and 17),
  year        integer, make text, model text, trim text, engine text,
  config      jsonb not null,
  unique (shop_id, vin)
);

-- A physical part on a vehicle (class + position). All history hangs off this row.
create table public.component_instance (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  class_id   integer not null references public.component_class(id),
  position   text,
  unique nulls not distinct (vehicle_id, class_id, position)
);

-- ------------------------------------------------------------------ inspections
create table public.inspection (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop(id) on delete cascade,
  vehicle_id       uuid not null references public.vehicle(id),
  template_id      uuid not null references public.template(id),
  rules_version_id uuid not null references public.rules_version(id),
  ro               text,
  odometer         integer check (odometer >= 0),
  inspection_date  date not null default current_date,
  technician_id    uuid,
  technician_name  text,
  status           text not null default 'not_started' check (status in ('not_started','in_progress','submitted','sent')),
  concerns         text[] not null default '{}',
  extra_components uuid[] not null default '{}',  -- on-demand parts added by the tech (component_instance ids)
  summary          jsonb,                          -- counts at submit time, for lists
  report_token     text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  sent_at          timestamptz
);
create index on public.inspection (shop_id, inspection_date desc);
create index on public.inspection (vehicle_id);

create table public.dtc (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  code          text not null,
  description   text,
  component_id  uuid references public.component_instance(id)
);

create table public.check_result (
  inspection_id    uuid not null references public.inspection(id) on delete cascade,
  component_id     uuid not null references public.component_instance(id),
  check_key        text not null references public.condition_check(key),
  value            numeric,
  rating           text not null check (rating in ('ok','monitor','immediate')),
  rules_version_id uuid not null references public.rules_version(id),
  recorded_by      uuid,
  recorded_at      timestamptz not null default now(),
  primary key (inspection_id, component_id, check_key)
);

create table public.media (
  id              uuid primary key,                 -- chosen by the client so the upload path is known up front
  inspection_id   uuid not null references public.inspection(id) on delete cascade,
  section_id      text not null,
  storage_path    text not null unique,
  label           text not null,
  customer_visible boolean not null default true,
  ai_point_id     text,
  ai_component_id uuid references public.component_instance(id),
  ai_confidence   numeric check (ai_confidence between 0 and 1),
  created_by      uuid,
  created_at      timestamptz not null default now()
);

-- Append-only placement history; the latest row is the current placement.
create table public.media_assignment (
  id           bigint generated always as identity primary key,
  media_id     uuid not null references public.media(id) on delete cascade,
  point_id     text,
  component_id uuid references public.component_instance(id),
  status       text not null check (status in ('ai_proposed','confirmed','reassigned','technician_assigned','unassigned','excluded')),
  created_by   uuid,                                -- null = AI
  created_at   timestamptz not null default now()
);
create index on public.media_assignment (media_id, id desc);

create table public.finding (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  component_id  uuid not null references public.component_instance(id),
  finding_key   text not null references public.finding_type(key),
  severity      text not null check (severity in ('minor','moderate','severe','critical')),
  source        text not null check (source in ('ai','technician')),
  status        text not null check (status in ('pending','confirmed','modified','denied')),
  confidence    numeric check (confidence between 0 and 1),
  rationale     text,
  media_id      uuid references public.media(id) on delete set null,
  ai_original_key text,
  ai_original_severity text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (source = 'ai' or status in ('confirmed','denied')),
  check (status = 'pending' or reviewed_at is not null)
);
create index on public.finding (inspection_id);

create table public.component_status (
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  component_id  uuid not null references public.component_instance(id),
  kind          text not null check (kind in ('not_inspected','unable_to_assess')),
  reason        text not null check (reason in ('not_accessible','not_performed_this_visit','blocked_by_other_condition','vehicle_not_road_tested','customer_declined','unsafe_to_inspect')),
  primary key (inspection_id, component_id)
);

create table public.point_note (
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  point_id      text not null,
  tech_text     text not null default '',
  ai_text       text,
  status        text not null default 'technician_original' check (status in ('technician_original','ai_suggested','ai_accepted','ai_edited','ai_rejected')),
  customer_text text,
  updated_at    timestamptz not null default now(),
  primary key (inspection_id, point_id)
);

create table public.estimate_line (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  component_id  uuid references public.component_instance(id),
  description   text not null,
  parts         numeric(10,2) not null default 0 check (parts >= 0),
  labor         numeric(10,2) not null default 0 check (labor >= 0),
  created_at    timestamptz not null default now()
);

create table public.customer_approval (
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  component_id  uuid not null references public.component_instance(id),
  approved_at   timestamptz not null default now(),
  primary key (inspection_id, component_id)
);

create table public.delivery (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  channel       text not null check (channel in ('sms','email','link')),
  destination   text,
  status        text not null check (status in ('sent','failed','skipped')),
  detail        text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security (read access)
create function public.my_shops() returns setof uuid
  language sql stable security definer set search_path = public as
$$ select shop_id from public.shop_member where user_id = auth.uid() $$;

do $$
declare t text;
begin
  foreach t in array array['component_class','finding_type','class_finding','condition_check'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy catalog_read on public.%I for select to authenticated using (true)', t);
  end loop;
  foreach t in array array['shop_member','shop_invite','template','rules_version','customer','vehicle'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using (shop_id in (select public.my_shops()))', t);
  end loop;
  foreach t in array array['dtc','check_result','media','finding','component_status','point_note','estimate_line','customer_approval','delivery'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using (inspection_id in (select id from public.inspection where shop_id in (select public.my_shops())))', t);
  end loop;
end $$;
alter table public.shop enable row level security;
create policy member_read on public.shop for select to authenticated using (id in (select public.my_shops()));
alter table public.inspection enable row level security;
create policy member_read on public.inspection for select to authenticated using (shop_id in (select public.my_shops()));
alter table public.check_threshold enable row level security;
create policy member_read on public.check_threshold for select to authenticated
  using (rules_version_id in (select id from public.rules_version where shop_id in (select public.my_shops())));
alter table public.component_instance enable row level security;
create policy member_read on public.component_instance for select to authenticated
  using (vehicle_id in (select id from public.vehicle where shop_id in (select public.my_shops())));
alter table public.media_assignment enable row level security;
create policy member_read on public.media_assignment for select to authenticated
  using (media_id in (select m.id from public.media m join public.inspection i on i.id = m.inspection_id where i.shop_id in (select public.my_shops())));

-- No insert/update/delete policies exist: every write goes through the functions below.
-- Belt and braces: take away table write privileges from the API roles entirely.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------------ helpers
create function public.require_role(p_shop uuid, p_roles text[]) returns void
  language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from shop_member where shop_id = p_shop and user_id = auth.uid() and role = any (p_roles)) then
    raise exception 'You don''t have permission to do that in this shop' using errcode = '42501';
  end if;
end $$;

-- Returns the inspection row after checking the caller may edit it.
create function public.editable_inspection(p_id uuid, p_roles text[] default array['owner','advisor','technician'], p_statuses text[] default array['not_started','in_progress'], p_start boolean default true)
  returns public.inspection language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  select * into r from inspection where id = p_id for update;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  perform require_role(r.shop_id, p_roles);
  if not (r.status = any (p_statuses)) then
    raise exception 'This inspection is % and can''t be changed', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  if p_start and r.status = 'not_started' and 'in_progress' = any (p_statuses) then
    update inspection set status = 'in_progress', technician_id = coalesce(technician_id, auth.uid()),
      technician_name = coalesce(technician_name, (select display_name from shop_member where shop_id = r.shop_id and user_id = auth.uid()))
      where id = p_id returning * into r;
  end if;
  return r;
end $$;

-- "73@left_front" -> component_instance id for this vehicle (created on first use).
create function public.component_for(p_vehicle uuid, p_key text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_class int := split_part(p_key, '@', 1)::int; v_pos text := nullif(split_part(p_key, '@', 2), ''); v_id uuid;
begin
  if not exists (select 1 from component_class where id = v_class) then raise exception 'Unknown part %', p_key using errcode = '22023'; end if;
  select id into v_id from component_instance where vehicle_id = p_vehicle and class_id = v_class and position is not distinct from v_pos;
  if v_id is null then
    insert into component_instance (vehicle_id, class_id, position) values (p_vehicle, v_class, v_pos)
      on conflict (vehicle_id, class_id, position) do update set class_id = excluded.class_id returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.comp_key(p_component uuid) returns text language sql stable security definer set search_path = public as
$$ select class_id || '@' || coalesce(position, '') from component_instance where id = p_component $$;

create function public.cmp(v numeric, op text, lim numeric) returns boolean language sql immutable as
$$ select case op when '<' then v < lim when '<=' then v <= lim when '>' then v > lim when '>=' then v >= lim end $$;

-- R3: rate a typed value with the shop's rules (override if present, else catalog default). Null = no automatic rule.
create function public.rate_value(p_rules uuid, p_check text, p_value numeric) returns text
  language plpgsql stable security definer set search_path = public as
$$
declare ok_op text; ok_v numeric; imm_op text; imm_v numeric;
begin
  select t.ok_op, t.ok_value, t.imm_op, t.imm_value into ok_op, ok_v, imm_op, imm_v
    from check_threshold t where t.rules_version_id = p_rules and t.check_key = p_check;
  if not found then
    select c.ok_op, c.ok_value, c.imm_op, c.imm_value into ok_op, ok_v, imm_op, imm_v from condition_check c where c.key = p_check;
  end if;
  if ok_op is null then return null; end if;
  if imm_op is not null and cmp(p_value, imm_op, imm_v) then return 'immediate'; end if;
  if cmp(p_value, ok_op, ok_v) then return 'ok'; end if;
  return 'monitor';
end $$;

create function public.validate_template(p_data jsonb) returns void language plpgsql stable security definer set search_path = public as
$$
declare bad text;
begin
  if jsonb_typeof(p_data -> 'sections') is distinct from 'array' or jsonb_array_length(p_data -> 'sections') = 0 then
    raise exception 'A template needs at least one section' using errcode = '22023';
  end if;
  select string_agg(distinct x::text, ', ') into bad
    from jsonb_path_query(p_data, '$.sections[*].points[*].components[*].classId') x
    where not exists (select 1 from component_class c where c.id = x::text::int);
  if bad is not null then raise exception 'Unknown part ids in template: %', bad using errcode = '22023'; end if;
  if exists (select 1 from jsonb_path_query(p_data, '$.sections[*].points[*]') p where coalesce(trim(p ->> 'name'), '') = '' or coalesce(p ->> 'id', '') = '') then
    raise exception 'Every point needs an id and a name' using errcode = '22023';
  end if;
end $$;

-- ------------------------------------------------------------------ shop setup & team
create function public.create_shop(p_name text, p_display_name text, p_template jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_shop uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform validate_template(p_template);
  insert into shop (name) values (trim(p_name)) returning id into v_shop;
  insert into shop_member (shop_id, user_id, role, display_name) values (v_shop, auth.uid(), 'owner', trim(p_display_name));
  insert into template (shop_id, name, version, data, created_by) values (v_shop, coalesce(p_template ->> 'name', 'Shop MPI'), 1, p_template, auth.uid());
  insert into rules_version (shop_id, number, created_by) values (v_shop, 1, auth.uid());
  return v_shop;
end $$;

create function public.invite_member(p_shop uuid, p_email text, p_role text) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_token text;
begin
  perform require_role(p_shop, array['owner']);
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right' using errcode = '22023'; end if;
  insert into shop_invite (shop_id, email, role, created_by) values (p_shop, lower(trim(p_email)), p_role, auth.uid()) returning token into v_token;
  return v_token;
end $$;

create function public.accept_invite(p_token text, p_display_name text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare inv shop_invite;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into inv from shop_invite where token = p_token for update;
  if not found or inv.accepted_at is not null then raise exception 'This invite link is no longer valid' using errcode = 'P0002'; end if;
  if inv.created_at < now() - interval '14 days' then raise exception 'This invite has expired; ask for a new one' using errcode = 'P0002'; end if;
  insert into shop_member (shop_id, user_id, role, display_name) values (inv.shop_id, auth.uid(), inv.role, trim(p_display_name))
    on conflict (shop_id, user_id) do update set role = excluded.role;
  update shop_invite set accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return inv.shop_id;
end $$;

create function public.set_member_role(p_shop uuid, p_user uuid, p_role text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  if p_role is null then
    if p_user = auth.uid() then raise exception 'You can''t remove yourself' using errcode = '22023'; end if;
    delete from shop_member where shop_id = p_shop and user_id = p_user;
  else
    if p_user = auth.uid() and p_role <> 'owner' and (select count(*) from shop_member where shop_id = p_shop and role = 'owner') = 1 then
      raise exception 'A shop needs at least one owner' using errcode = '22023';
    end if;
    update shop_member set role = p_role where shop_id = p_shop and user_id = p_user;
  end if;
end $$;

create function public.save_template(p_shop uuid, p_template jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_next int;
begin
  perform require_role(p_shop, array['owner']);
  perform validate_template(p_template);
  select coalesce(max(version), 0) + 1 into v_next from template where shop_id = p_shop;
  update template set is_active = false where shop_id = p_shop and is_active;
  insert into template (shop_id, name, version, data, created_by)
    values (p_shop, coalesce(p_template ->> 'name', 'Shop MPI'), v_next, p_template, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- p_thresholds: [{checkKey, ok:[op,value], immediate:[op,value]|null}] — the full override set for the new version.
create function public.save_thresholds(p_shop uuid, p_thresholds jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_next int; t jsonb;
begin
  perform require_role(p_shop, array['owner']);
  select coalesce(max(number), 0) + 1 into v_next from rules_version where shop_id = p_shop;
  update rules_version set is_active = false where shop_id = p_shop and is_active;
  insert into rules_version (shop_id, number, created_by) values (p_shop, v_next, auth.uid()) returning id into v_id;
  for t in select * from jsonb_array_elements(coalesce(p_thresholds, '[]')) loop
    if not exists (select 1 from condition_check where key = t ->> 'checkKey' and ok_op is not null) then
      raise exception 'Check % has no numeric rule to change', t ->> 'checkKey' using errcode = '22023';
    end if;
    insert into check_threshold values (v_id, t ->> 'checkKey', t -> 'ok' ->> 0, (t -> 'ok' ->> 1)::numeric,
      nullif(t -> 'immediate' ->> 0, ''), (t -> 'immediate' ->> 1)::numeric);
  end loop;
  return v_id;
end $$;

-- ------------------------------------------------------------------ vehicles & new inspections
create function public.create_inspection(
  p_shop uuid, p_vin text, p_year int, p_make text, p_model text, p_trim text, p_engine text, p_config jsonb,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_ro text, p_odometer int, p_concerns text[]
) returns uuid language plpgsql security definer set search_path = public as
$$
declare v_vehicle uuid; v_customer uuid; v_id uuid;
begin
  perform require_role(p_shop, array['owner','advisor','technician']);
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
    values (p_shop, v_vehicle,
      (select id from template where shop_id = p_shop and is_active),
      (select id from rules_version where shop_id = p_shop and is_active),
      nullif(trim(p_ro), ''), p_odometer, coalesce(p_concerns, '{}'))
    returning id into v_id;
  return v_id;
end $$;

create function public.set_vehicle_config(p_inspection uuid, p_config jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection, p_start => false);
  update vehicle set config = p_config where id = r.vehicle_id;
end $$;

create function public.set_odometer(p_inspection uuid, p_odometer int) returns void
  language plpgsql security definer set search_path = public as
$$ begin perform editable_inspection(p_inspection, p_start => false); update inspection set odometer = p_odometer where id = p_inspection; end $$;

create function public.start_inspection(p_inspection uuid) returns void
  language plpgsql security definer set search_path = public as
$$ begin perform editable_inspection(p_inspection); end $$;

create function public.add_dtc(p_inspection uuid, p_code text, p_description text, p_key text) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection);
  insert into dtc (inspection_id, code, description, component_id)
    values (p_inspection, upper(trim(p_code)), p_description, case when p_key is null then null else component_for(r.vehicle_id, p_key) end);
  if p_key is not null then
    update inspection set extra_components = array(select distinct unnest(extra_components || component_for(r.vehicle_id, p_key))) where id = p_inspection;
  end if;
end $$;

create function public.add_extra_component(p_inspection uuid, p_key text) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection);
  update inspection set extra_components = array(select distinct unnest(extra_components || component_for(r.vehicle_id, p_key))) where id = p_inspection;
end $$;

-- ------------------------------------------------------------------ checks, findings, statuses
create function public.set_check(p_inspection uuid, p_key text, p_check text, p_value numeric, p_rating text) returns text
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid; v_rating text;
begin
  r := editable_inspection(p_inspection);
  v_comp := component_for(r.vehicle_id, p_key);
  if not exists (select 1 from condition_check where key = p_check and class_id = split_part(p_key, '@', 1)::int) then
    raise exception 'Check % doesn''t apply to this part', p_check using errcode = '22023';
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

create function public.clear_check(p_inspection uuid, p_key text, p_check text) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection);
  delete from check_result where inspection_id = p_inspection and component_id = component_for(r.vehicle_id, p_key) and check_key = p_check;
end $$;

-- "Nothing found": p_items = [{key, check}] for parts the app has determined are untouched.
create function public.mark_ok(p_inspection uuid, p_items jsonb) returns int
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
      values (p_inspection, v_comp, it ->> 'check', null, 'ok', r.rules_version_id, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.add_finding(p_inspection uuid, p_key text, p_finding text, p_severity text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_id uuid; v_comp uuid;
begin
  r := editable_inspection(p_inspection);
  if not exists (select 1 from class_finding where class_id = split_part(p_key, '@', 1)::int and finding_key = p_finding) then
    raise exception 'That finding isn''t used for this part' using errcode = '22023';
  end if;
  v_comp := component_for(r.vehicle_id, p_key);
  insert into finding (inspection_id, component_id, finding_key, severity, source, status, reviewed_by, reviewed_at)
    values (p_inspection, v_comp, p_finding, p_severity, 'technician', 'confirmed', auth.uid(), now()) returning id into v_id;
  delete from component_status where inspection_id = p_inspection and component_id = v_comp;
  return v_id;
end $$;

create function public.remove_finding(p_finding uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare f finding;
begin
  select * into f from finding where id = p_finding;
  if not found then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  perform editable_inspection(f.inspection_id);
  if f.source <> 'technician' then raise exception 'AI findings are rejected, not deleted, so the record is kept' using errcode = '22023'; end if;
  delete from finding where id = p_finding;
end $$;

-- R10: the only way an AI finding starts to count.
create function public.review_finding(p_finding uuid, p_action text, p_key text default null, p_severity text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare f finding;
begin
  select * into f from finding where id = p_finding for update;
  if not found then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  perform editable_inspection(f.inspection_id);
  if f.source <> 'ai' then raise exception 'Only AI findings are reviewed' using errcode = '22023'; end if;
  if p_action = 'confirm' then
    update finding set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now() where id = p_finding;
  elsif p_action = 'reject' then
    update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now() where id = p_finding;
  elsif p_action = 'modify' then
    if not exists (select 1 from class_finding c join component_instance ci on ci.class_id = c.class_id where ci.id = f.component_id and c.finding_key = p_key) then
      raise exception 'That finding isn''t used for this part' using errcode = '22023';
    end if;
    update finding set status = 'modified', finding_key = p_key, severity = p_severity, reviewed_by = auth.uid(), reviewed_at = now() where id = p_finding;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
end $$;

create function public.set_not_inspected(p_inspection uuid, p_key text, p_kind text, p_reason text) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid;
begin
  r := editable_inspection(p_inspection);
  v_comp := component_for(r.vehicle_id, p_key);
  delete from component_status where inspection_id = p_inspection and component_id = v_comp;
  if p_kind is not null then
    insert into component_status values (p_inspection, v_comp, p_kind, p_reason);
    delete from check_result where inspection_id = p_inspection and component_id = v_comp;
  end if;
end $$;

-- ------------------------------------------------------------------ photos
-- Called after the browser uploads the file to storage at <shop>/<inspection>/<media id>.<ext>.
create function public.add_media(p_inspection uuid, p_media uuid, p_section text, p_path text, p_label text) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection;
begin
  r := editable_inspection(p_inspection);
  if p_path not like r.shop_id || '/' || r.id || '/%' then raise exception 'Photo is in the wrong folder' using errcode = '22023'; end if;
  insert into media (id, inspection_id, section_id, storage_path, label, created_by) values (p_media, p_inspection, p_section, p_path, p_label, auth.uid());
  insert into media_assignment (media_id, status, created_by) values (p_media, 'unassigned', auth.uid());
end $$;

create function public.current_assignment(p_media uuid) returns public.media_assignment
  language sql stable security definer set search_path = public as
$$ select * from media_assignment where media_id = p_media order by id desc limit 1 $$;

create function public.confirm_placements(p_inspection uuid, p_section text) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  perform editable_inspection(p_inspection);
  insert into media_assignment (media_id, point_id, component_id, status, created_by)
    select m.id, a.point_id, a.component_id, 'confirmed', auth.uid()
      from media m cross join lateral current_assignment(m.id) a
      where m.inspection_id = p_inspection and m.section_id = p_section and a.status = 'ai_proposed';
  get diagnostics n = row_count;
  return n;
end $$;

create function public.place_photo(p_media uuid, p_point text, p_key text) returns void
  language plpgsql security definer set search_path = public as
$$
declare m media; r inspection; a media_assignment; v_comp uuid; v_status text;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  r := editable_inspection(m.inspection_id);
  v_comp := component_for(r.vehicle_id, p_key);
  a := current_assignment(p_media);
  v_status := case when m.ai_component_id is null then 'technician_assigned'
                   when m.ai_component_id = v_comp and a.status = 'ai_proposed' then 'confirmed' else 'reassigned' end;
  insert into media_assignment (media_id, point_id, component_id, status, created_by) values (p_media, p_point, v_comp, v_status, auth.uid());
  -- an AI finding raised from this photo is dropped if the tech moves the photo to another part
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
    where media_id = p_media and status = 'pending' and component_id <> v_comp;
end $$;

create function public.exclude_photo(p_media uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare m media; a media_assignment;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  perform editable_inspection(m.inspection_id);
  a := current_assignment(p_media);
  insert into media_assignment (media_id, point_id, component_id, status, created_by) values (p_media, a.point_id, a.component_id, 'excluded', auth.uid());
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now() where media_id = p_media and status = 'pending';
end $$;

create function public.set_photo_visible(p_media uuid, p_visible boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare m media;
begin
  select * into m from media where id = p_media;
  perform editable_inspection(m.inspection_id, p_statuses => array['in_progress','submitted']);
  update media set customer_visible = p_visible where id = p_media;
end $$;

-- ------------------------------------------------------------------ notes & wording
create function public.set_note(p_inspection uuid, p_point text, p_text text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform editable_inspection(p_inspection);
  insert into point_note (inspection_id, point_id, tech_text, customer_text) values (p_inspection, p_point, p_text, nullif(p_text, ''))
    on conflict (inspection_id, point_id) do update set tech_text = excluded.tech_text,
      customer_text = case when point_note.status = 'technician_original' then excluded.customer_text else point_note.customer_text end,
      updated_at = now();
end $$;

create function public.resolve_wording(p_inspection uuid, p_point text, p_action text, p_text text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare n point_note;
begin
  perform editable_inspection(p_inspection);
  select * into n from point_note where inspection_id = p_inspection and point_id = p_point for update;
  if not found or n.status <> 'ai_suggested' then raise exception 'No wording suggestion to review' using errcode = '22023'; end if;
  update point_note set
    status = case p_action when 'accept' then 'ai_accepted' when 'reject' then 'ai_rejected' when 'edit' then 'ai_edited' end,
    customer_text = case p_action when 'accept' then n.ai_text when 'reject' then n.tech_text when 'edit' then p_text end,
    updated_at = now()
  where inspection_id = p_inspection and point_id = p_point;
end $$;

-- ------------------------------------------------------------------ AI writes (server only)
-- p_items: [{mediaId, pointId, key, confidence, finding: {key, severity, confidence, rationale} | null}]
-- A null pointId/key = the AI couldn't place the photo. The caller (api/ai-sort) has already validated
-- keys against the template; this re-checks that findings are allowed for the class.
create function public.ai_record_sort(p_inspection uuid, p_items jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; it jsonb; v_comp uuid; f jsonb;
begin
  select * into r from inspection where id = p_inspection;
  if r.status <> 'in_progress' then return; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from media where id = (it ->> 'mediaId')::uuid and inspection_id = p_inspection) then continue; end if;
    if (current_assignment((it ->> 'mediaId')::uuid)).status <> 'unassigned' then continue; end if;  -- tech already acted
    v_comp := case when it ->> 'key' is null then null else component_for(r.vehicle_id, it ->> 'key') end;
    update media set ai_point_id = it ->> 'pointId', ai_component_id = v_comp, ai_confidence = (it ->> 'confidence')::numeric
      where id = (it ->> 'mediaId')::uuid;
    if v_comp is not null and it ->> 'pointId' is not null then
      insert into media_assignment (media_id, point_id, component_id, status) values ((it ->> 'mediaId')::uuid, it ->> 'pointId', v_comp, 'ai_proposed');
    end if;
    f := it -> 'finding';
    if v_comp is not null and f is not null and jsonb_typeof(f) = 'object'
       and exists (select 1 from class_finding where class_id = split_part(it ->> 'key', '@', 1)::int and finding_key = f ->> 'key')
       and f ->> 'severity' in ('minor','moderate','severe','critical') then
      insert into finding (inspection_id, component_id, finding_key, severity, source, status, confidence, rationale, media_id, ai_original_key, ai_original_severity)
        values (p_inspection, v_comp, f ->> 'key', f ->> 'severity', 'ai', 'pending', (f ->> 'confidence')::numeric, left(f ->> 'rationale', 500),
                (it ->> 'mediaId')::uuid, f ->> 'key', f ->> 'severity');
    end if;
  end loop;
end $$;

create function public.ai_record_wording(p_inspection uuid, p_point text, p_text text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  update point_note set ai_text = p_text, status = 'ai_suggested', updated_at = now()
    where inspection_id = p_inspection and point_id = p_point
      and (select status from inspection where id = p_inspection) = 'in_progress';
end $$;

-- ------------------------------------------------------------------ lifecycle
-- R12 (AI part): refuses while anything AI-generated is unreviewed. Required-part completeness is checked in the app.
create function public.submit_inspection(p_inspection uuid, p_summary jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare n_f int; n_m int; n_w int;
begin
  perform editable_inspection(p_inspection, p_statuses => array['in_progress']);
  select count(*) into n_f from finding where inspection_id = p_inspection and source = 'ai' and status = 'pending';
  select count(*) into n_m from media m where m.inspection_id = p_inspection and (current_assignment(m.id)).status in ('ai_proposed','unassigned');
  select count(*) into n_w from point_note where inspection_id = p_inspection and status = 'ai_suggested';
  if n_f + n_m + n_w > 0 then
    raise exception 'Resolve % AI findings, % photos and % wording suggestions first', n_f, n_m, n_w using errcode = '55000';
  end if;
  update inspection set status = 'submitted', submitted_at = now(), summary = p_summary where id = p_inspection;
end $$;

create function public.reopen_inspection(p_inspection uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['submitted']);
  update inspection set status = 'in_progress', submitted_at = null where id = p_inspection;
end $$;

create function public.mark_sent(p_inspection uuid, p_channel text, p_destination text, p_status text, p_detail text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['submitted','sent']);
  insert into delivery (inspection_id, channel, destination, status, detail, created_by) values (p_inspection, p_channel, p_destination, p_status, p_detail, auth.uid());
  if p_status <> 'failed' then update inspection set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_inspection; end if;
end $$;

-- ------------------------------------------------------------------ estimates
create function public.save_estimate_line(p_inspection uuid, p_line uuid, p_key text, p_description text, p_parts numeric, p_labor numeric) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_id uuid;
begin
  r := editable_inspection(p_inspection, array['owner','advisor'], array['in_progress','submitted','sent']);
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the work' using errcode = '22023'; end if;
  if p_line is null then
    insert into estimate_line (inspection_id, component_id, description, parts, labor)
      values (p_inspection, case when p_key is null then null else component_for(r.vehicle_id, p_key) end, trim(p_description), coalesce(p_parts, 0), coalesce(p_labor, 0))
      returning id into v_id;
  else
    update estimate_line set description = trim(p_description), parts = coalesce(p_parts, 0), labor = coalesce(p_labor, 0)
      where id = p_line and inspection_id = p_inspection returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.delete_estimate_line(p_inspection uuid, p_line uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['in_progress','submitted','sent']);
  delete from estimate_line where id = p_line and inspection_id = p_inspection;
end $$;

-- ------------------------------------------------------------------ reading (JSON in the app's shapes)
create function public.inspection_doc(p_id uuid, p_customer boolean) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'id', i.id, 'ro', coalesce(i.ro, ''), 'vehicleId', i.vehicle_id, 'odometer', coalesce(i.odometer, 0),
    'date', i.inspection_date, 'technician', coalesce(i.technician_name, ''), 'status', i.status, 'concerns', to_jsonb(i.concerns),
    'templateId', i.template_id, 'rulesVersionId', i.rules_version_id,
    'reportToken', case when p_customer then null else i.report_token end,
    'extraComponents', coalesce((select jsonb_agg(comp_key(x)) from unnest(i.extra_components) x), '[]'),
    'dtcs', coalesce((select jsonb_agg(jsonb_build_object('code', d.code, 'description', coalesce(d.description, ''), 'compKey', comp_key(d.component_id))) from dtc d where d.inspection_id = i.id), '[]'),
    'results', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(c.component_id), 'checkKey', c.check_key, 'value', c.value, 'rating', c.rating, 'at', c.recorded_at)) from check_result c where c.inspection_id = i.id), '[]'),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'compKey', comp_key(f.component_id), 'key', f.finding_key, 'severity', f.severity,
        'source', f.source, 'status', f.status, 'confidence', f.confidence, 'rationale', f.rationale, 'mediaId', f.media_id, 'reviewedAt', f.reviewed_at,
        'aiOriginal', case when f.ai_original_key is null then null else jsonb_build_object('key', f.ai_original_key, 'severity', f.ai_original_severity) end)
        order by f.created_at)
      from finding f where f.inspection_id = i.id
        and (not p_customer or f.source = 'technician' and f.status = 'confirmed' or f.source = 'ai' and f.status in ('confirmed','modified'))), '[]'),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sectionId', m.section_id, 'url', m.storage_path, 'label', m.label,
        'pointId', a.point_id, 'compKey', comp_key(a.component_id), 'status', a.status, 'confidence', m.ai_confidence,
        'aiGuess', case when m.ai_component_id is null then null else jsonb_build_object('pointId', m.ai_point_id, 'compKey', comp_key(m.ai_component_id)) end,
        'history', '[]'::jsonb, 'customerVisible', m.customer_visible) order by m.created_at)
      from media m cross join lateral current_assignment(m.id) a
      where m.inspection_id = i.id and (not p_customer or (a.status in ('confirmed','reassigned','technician_assigned') and m.customer_visible))), '[]'),
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(s.component_id), 'notInspected', jsonb_build_object('kind', s.kind, 'reason', s.reason), 'override', null))
      from component_status s where s.inspection_id = i.id), '[]'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('pointId', n.point_id,
        'techText', case when p_customer then '' else n.tech_text end,
        'aiText', case when p_customer then null else n.ai_text end,
        'status', n.status, 'customerText', n.customer_text))
      from point_note n where n.inspection_id = i.id and (not p_customer or (n.customer_text is not null and n.status <> 'ai_suggested'))), '[]'),
    'estimate', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'compKey', comp_key(e.component_id), 'description', e.description, 'parts', e.parts, 'labor', e.labor) order by e.created_at)
      from estimate_line e where e.inspection_id = i.id), '[]'),
    'customerApprovals', coalesce((select jsonb_agg(comp_key(ca.component_id)) from customer_approval ca where ca.inspection_id = i.id), '[]')
  ) from inspection i where i.id = p_id
$$;
revoke all on function public.inspection_doc(uuid, boolean) from public, anon, authenticated;

create function public.vehicle_doc(p_vehicle uuid) returns jsonb language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('id', v.id, 'vin', v.vin, 'year', v.year, 'make', coalesce(v.make, ''), 'model', coalesce(v.model, ''), 'trim', coalesce(v.trim, ''),
    'engine', coalesce(v.engine, ''), 'customer', coalesce(c.name, ''), 'customerPhone', c.phone, 'customerEmail', c.email, 'config', v.config)
  from vehicle v left join customer c on c.id = v.customer_id where v.id = p_vehicle
$$;
revoke all on function public.vehicle_doc(uuid) from public, anon, authenticated;

create function public.get_inspection(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare r inspection;
begin
  select * into r from inspection where id = p_id;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  perform require_role(r.shop_id, array['owner','advisor','technician']);
  return jsonb_build_object('inspection', inspection_doc(p_id, false), 'vehicle', vehicle_doc(r.vehicle_id),
    'template', (select data from template where id = r.template_id));
end $$;

create function public.get_vehicle_history(p_vehicle uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_shop uuid;
begin
  select shop_id into v_shop from vehicle where id = p_vehicle;
  if not found then raise exception 'Vehicle not found' using errcode = 'P0002'; end if;
  perform require_role(v_shop, array['owner','advisor','technician']);
  return jsonb_build_object('vehicle', vehicle_doc(p_vehicle),
    'inspections', coalesce((select jsonb_agg(inspection_doc(i.id, false) order by i.inspection_date) from inspection i where i.vehicle_id = p_vehicle and i.status <> 'not_started'), '[]'));
end $$;

-- Everything the app needs after sign-in: memberships, active shop setup, recent jobs (headers only).
create function public.get_workspace(p_shop uuid default null, p_days int default 14) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_shop uuid; v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select m.shop_id, m.role into v_shop, v_role from shop_member m
    where m.user_id = auth.uid() and (p_shop is null or m.shop_id = p_shop) order by m.created_at limit 1;
  if v_shop is null then
    return jsonb_build_object('shops', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'shops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role)) from shop_member m join shop s on s.id = m.shop_id where m.user_id = auth.uid()),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone) from shop s where s.id = v_shop),
    'role', v_role,
    'me', (select jsonb_build_object('userId', user_id, 'name', display_name) from shop_member where shop_id = v_shop and user_id = auth.uid()),
    'members', (select jsonb_agg(jsonb_build_object('userId', user_id, 'name', display_name, 'role', role) order by display_name) from shop_member where shop_id = v_shop),
    'invites', case when v_role = 'owner' then coalesce((select jsonb_agg(jsonb_build_object('email', email, 'role', role, 'token', token, 'createdAt', created_at))
                 from shop_invite where shop_id = v_shop and accepted_at is null and created_at > now() - interval '14 days'), '[]') else '[]' end,
    'template', (select jsonb_build_object('id', id, 'version', version, 'data', data) from template where shop_id = v_shop and is_active),
    'rules', (select jsonb_build_object('id', rv.id, 'number', rv.number,
        'thresholds', coalesce((select jsonb_agg(jsonb_build_object('checkKey', t.check_key, 'ok', jsonb_build_array(t.ok_op, t.ok_value),
          'immediate', case when t.imm_op is null then null else jsonb_build_array(t.imm_op, t.imm_value) end)) from check_threshold t where t.rules_version_id = rv.id), '[]'))
      from rules_version rv where rv.shop_id = v_shop and rv.is_active),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'ro', coalesce(i.ro, ''), 'status', i.status, 'date', i.inspection_date, 'odometer', coalesce(i.odometer, 0),
        'technician', coalesce(i.technician_name, ''), 'concerns', to_jsonb(i.concerns), 'summary', i.summary,
        'pendingAi', (select count(*) from finding f where f.inspection_id = i.id and f.source = 'ai' and f.status = 'pending'),
        'vehicle', vehicle_doc(i.vehicle_id)) order by i.inspection_date desc, i.created_at desc)
      from inspection i where i.shop_id = v_shop and (i.inspection_date > current_date - p_days or i.status in ('not_started','in_progress','submitted'))), '[]')
  );
end $$;

-- ------------------------------------------------------------------ customer (no sign-in; the token is the secret)
create function public.customer_report(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare r inspection;
begin
  select * into r from inspection where report_token = p_token and status in ('submitted','sent');
  if not found then raise exception 'This report link isn''t valid' using errcode = 'P0002'; end if;
  return jsonb_build_object('inspection', inspection_doc(r.id, true), 'vehicle', vehicle_doc(r.vehicle_id) - 'customerPhone' - 'customerEmail',
    'template', (select data from template where id = r.template_id),
    'shop', (select jsonb_build_object('name', name, 'phone', phone) from shop where id = r.shop_id));
end $$;

create function public.customer_set_approval(p_token text, p_key text, p_approved boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid;
begin
  select * into r from inspection where report_token = p_token and status = 'sent';
  if not found then raise exception 'This report link isn''t valid' using errcode = 'P0002'; end if;
  select id into v_comp from component_instance where vehicle_id = r.vehicle_id
    and class_id = split_part(p_key, '@', 1)::int and position is not distinct from nullif(split_part(p_key, '@', 2), '');
  if v_comp is null then raise exception 'Unknown part' using errcode = '22023'; end if;
  if p_approved then insert into customer_approval (inspection_id, component_id) values (r.id, v_comp) on conflict do nothing;
  else delete from customer_approval where inspection_id = r.id and component_id = v_comp; end if;
end $$;

-- ------------------------------------------------------------------ grants
-- Supabase grants every new function to anon and authenticated by default; take that back and grant explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.my_shops(), public.create_shop(text, text, jsonb), public.invite_member(uuid, text, text), public.accept_invite(text, text),
  public.set_member_role(uuid, uuid, text), public.save_template(uuid, jsonb), public.save_thresholds(uuid, jsonb),
  public.create_inspection(uuid, text, int, text, text, text, text, jsonb, text, text, text, text, int, text[]),
  public.set_vehicle_config(uuid, jsonb), public.set_odometer(uuid, int), public.start_inspection(uuid), public.add_dtc(uuid, text, text, text),
  public.add_extra_component(uuid, text), public.set_check(uuid, text, text, numeric, text), public.clear_check(uuid, text, text),
  public.mark_ok(uuid, jsonb), public.add_finding(uuid, text, text, text), public.remove_finding(uuid),
  public.review_finding(uuid, text, text, text), public.set_not_inspected(uuid, text, text, text),
  public.add_media(uuid, uuid, text, text, text), public.confirm_placements(uuid, text), public.place_photo(uuid, text, text),
  public.exclude_photo(uuid), public.set_photo_visible(uuid, boolean), public.set_note(uuid, text, text),
  public.resolve_wording(uuid, text, text, text), public.submit_inspection(uuid, jsonb), public.reopen_inspection(uuid),
  public.mark_sent(uuid, text, text, text, text), public.save_estimate_line(uuid, uuid, text, text, numeric, numeric),
  public.delete_estimate_line(uuid, uuid), public.get_inspection(uuid), public.get_vehicle_history(uuid), public.get_workspace(uuid, int)
to authenticated;
-- Server-only: AI output and the customer report are written/read by api/ functions with the service key.
grant execute on function public.ai_record_sort(uuid, jsonb), public.ai_record_wording(uuid, text, text),
  public.customer_report(text), public.customer_set_approval(text, text, boolean) to service_role;
-- Internal helpers stay callable by the functions above (they run as the owner).

-- ------------------------------------------------------------------ photo storage
insert into storage.buckets (id, name, public) values ('inspection-media', 'inspection-media', false) on conflict (id) do nothing;

create policy "members upload inspection photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-media' and (storage.foldername(name))[1]::uuid in (select public.my_shops()));
create policy "members read inspection photos" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-media' and (storage.foldername(name))[1]::uuid in (select public.my_shops()));
