-- Wrynch production schema (PostgreSQL 15+).
-- Mirrors the "Data Model" sheet of ontology/Vehicle_Component_Classes_Metadata_Ontology_v1.2.xlsx.
-- The demo app keeps this same shape in the browser (src/domain/types.ts); this file is the target
-- for the real API. Catalog tables are loaded from src/data/ontology.json.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ catalog (read-only, versioned)
create table ontology_release (
  version      text primary key,              -- e.g. '1.2.0'
  released_at  timestamptz not null default now()
);

create table component_class (
  id              integer primary key,          -- stable catalog id, never reused
  name            text not null unique,         -- e.g. 'brake_pad'
  label           text not null,
  category        text not null,
  safety_critical boolean not null,
  ai_photo        text not null check (ai_photo in ('yes','partial','no')),
  position_rule   text not null check (position_rule in ('none','optional','required','required_if_multiple','required_if_multiple_axles','implied')),
  allowed_positions text[] not null default '{}',
  capture_guidance text,
  added_in        text not null references ontology_release(version)
);

create table finding_type (
  key         text primary key,                 -- e.g. 'grooved'
  definition  text not null
);

-- Which findings are allowed on a class, and their default rating per severity (R2).
create table class_finding (
  class_id    integer not null references component_class(id),
  finding_key text not null references finding_type(key),
  rating_minor    text not null check (rating_minor    in ('ok','monitor','immediate')),
  rating_moderate text not null check (rating_moderate in ('ok','monitor','immediate')),
  rating_severe   text not null check (rating_severe   in ('ok','monitor','immediate')),
  rating_critical text not null check (rating_critical = 'immediate'),
  primary key (class_id, finding_key)
);

create table condition_check (
  key          text primary key,                -- e.g. 'brake_pad.lining_thickness'
  class_id     integer not null references component_class(id),
  name         text not null,
  method       text not null,
  unit         text,
  value_type   text not null check (value_type in ('numeric','categorical','pass_fail','visual')),
  band_ok      text not null,
  band_monitor text,
  band_immediate text
);

-- Shop-configurable thresholds (R8). Every check result stores the rules version it used.
create table shop (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table rules_version (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shop(id),
  number     integer not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, number)
);

create table check_threshold (
  rules_version_id uuid not null references rules_version(id),
  check_key   text not null references condition_check(key),
  ok_op       text check (ok_op in ('<','<=','>','>=')),
  ok_value    numeric,
  imm_op      text check (imm_op in ('<','<=','>','>=')),
  imm_value   numeric,
  primary key (rules_version_id, check_key)
);

-- ------------------------------------------------------------------ templates
create table template (
  id        uuid primary key default gen_random_uuid(),
  shop_id   uuid not null references shop(id),
  name      text not null,
  version   integer not null default 1
);

create table template_stage (                  -- bulk-capture unit ("Under car")
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references template(id) on delete cascade,
  name        text not null,
  capture_instructions text,
  sort_order  integer not null
);

create table template_point (                  -- what the technician sees
  id        uuid primary key default gen_random_uuid(),
  stage_id  uuid not null references template_stage(id) on delete cascade,
  name      text not null,
  sort_order integer not null
);

create table template_component_mapping (      -- point -> class + position
  id         uuid primary key default gen_random_uuid(),
  point_id   uuid not null references template_point(id) on delete cascade,
  class_id   integer not null references component_class(id),
  position   text,
  required   boolean not null default false,
  applies_when text not null default 'always'  -- predicate id, see src/domain/ontology.ts CONDITIONS
);

-- ------------------------------------------------------------------ vehicles & history
create table customer (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop(id),
  name    text not null,
  phone   text,
  email   text
);

create table vehicle (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shop(id),
  customer_id uuid references customer(id),
  vin         text not null,
  year        integer, make text, model text, trim text,
  config      jsonb not null default '{}'::jsonb,  -- VehicleConfig: drivetrain, rear brakes, ...
  unique (shop_id, vin)
);

-- A physical part on a vehicle: class + position. History hangs off this row.
create table component_instance (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicle(id),
  class_id   integer not null references component_class(id),
  position   text,
  subtype    text,
  unique nulls not distinct (vehicle_id, class_id, position)
);

create table service_event (
  id           uuid primary key default gen_random_uuid(),
  component_instance_id uuid not null references component_instance(id),
  odometer     integer,
  performed_on date,
  description  text not null,
  source       text not null check (source in ('shop_record','customer_reported','technician_observed','integration'))
);

-- ------------------------------------------------------------------ inspections
create table inspection (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shop(id),
  vehicle_id    uuid not null references vehicle(id),
  template_id   uuid not null references template(id),
  rules_version_id uuid not null references rules_version(id),
  ro_number     text,
  odometer      integer,
  technician_id uuid,
  status        text not null default 'not_started' check (status in ('not_started','in_progress','submitted','sent')),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz
);

create table vehicle_concern (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  concern_type  text not null check (concern_type in ('noise','vibration','pull','powertrain_performance','customer_complaint')),
  description   text not null
);

create table diagnostic_trouble_code (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  code          text not null,
  description   text,
  component_instance_id uuid references component_instance(id)
);

create table check_result (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  component_instance_id uuid not null references component_instance(id),
  check_key     text not null references condition_check(key),
  value         numeric,                     -- typed by the technician/tool, never by AI (R3)
  rating        text not null check (rating in ('ok','monitor','immediate')),
  rules_version_id uuid not null references rules_version(id),
  recorded_by   uuid not null,
  recorded_at   timestamptz not null default now(),
  unique (inspection_id, component_instance_id, check_key)
);

create table finding (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  component_instance_id uuid not null references component_instance(id),
  finding_key   text not null references finding_type(key),
  severity      text not null check (severity in ('minor','moderate','severe','critical')),
  source        text not null check (source in ('ai','technician')),
  review_status text not null check (review_status in ('pending','confirmed','modified','denied')),
  confidence    numeric check (confidence between 0 and 1),
  ai_original_key text,
  ai_original_severity text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  -- R10: a technician finding is confirmed on entry; an AI finding starts pending.
  check (source = 'ai' or review_status = 'confirmed'),
  check (review_status = 'pending' or reviewed_at is not null)
);

create table component_status (
  inspection_id uuid not null references inspection(id) on delete cascade,
  component_instance_id uuid not null references component_instance(id),
  not_inspected_kind   text check (not_inspected_kind in ('not_inspected','unable_to_assess')),
  not_inspected_reason text check (not_inspected_reason in ('not_accessible','not_performed_this_visit','blocked_by_other_condition','vehicle_not_road_tested','customer_declined','unsafe_to_inspect')),
  override_rating text check (override_rating in ('ok','monitor','immediate')),
  override_reason text,
  primary key (inspection_id, component_instance_id),
  check ((not_inspected_kind is null) = (not_inspected_reason is null)),
  check (override_rating is null or override_reason is not null)
);

create table media (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  stage_id      uuid not null references template_stage(id),
  storage_url   text not null,               -- original is never overwritten
  captured_at   timestamptz,
  uploaded_at   timestamptz not null default now()
);

create table media_assignment (
  id            uuid primary key default gen_random_uuid(),
  media_id      uuid not null references media(id) on delete cascade,
  point_id      uuid references template_point(id),
  component_instance_id uuid references component_instance(id),
  status        text not null check (status in ('ai_proposed','confirmed','reassigned','technician_assigned','unassigned','excluded')),
  confidence    numeric,
  customer_visible boolean not null default true,
  previous_assignment_id uuid references media_assignment(id),
  created_at    timestamptz not null default now()
);
create index on media_assignment (media_id, created_at desc);

create table text_revision (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id) on delete cascade,
  point_id      uuid not null references template_point(id),
  technician_text text not null,
  ai_suggestion text,
  customer_text text,
  status        text not null check (status in ('technician_original','ai_suggested','ai_accepted','ai_edited','ai_rejected')),
  created_at    timestamptz not null default now()
);

create table customer_approval (
  inspection_id uuid not null references inspection(id) on delete cascade,
  component_instance_id uuid not null references component_instance(id),
  approved_at   timestamptz not null default now(),
  primary key (inspection_id, component_instance_id)
);

-- ------------------------------------------------------------------ R11 / R12 enforcement
-- Everything customer-facing reads from these views, never from the base tables.
create view customer_finding as
  select f.* from finding f
  join inspection i on i.id = f.inspection_id
  where i.status in ('submitted','sent')
    and (f.source = 'technician' or f.review_status in ('confirmed','modified'));

create view current_media_assignment as
  select distinct on (media_id) * from media_assignment order by media_id, created_at desc;

create view customer_media as
  select m.*, a.component_instance_id, a.point_id from media m
  join current_media_assignment a on a.media_id = m.id
  join inspection i on i.id = m.inspection_id
  where i.status in ('submitted','sent')
    and a.status in ('confirmed','reassigned','technician_assigned')
    and a.customer_visible;

-- R12: an inspection cannot be submitted while anything AI is pending.
create function inspection_gate() returns trigger language plpgsql as $$
begin
  if new.status in ('submitted','sent') and old.status = 'in_progress' then
    if exists (select 1 from finding where inspection_id = new.id and source = 'ai' and review_status = 'pending') then
      raise exception 'Inspection % has AI findings pending technician review', new.id;
    end if;
    if exists (select 1 from current_media_assignment a join media m on m.id = a.media_id
               where m.inspection_id = new.id and a.status in ('ai_proposed','unassigned')) then
      raise exception 'Inspection % has photos not confirmed by the technician', new.id;
    end if;
    if exists (select 1 from text_revision t where t.inspection_id = new.id and t.status = 'ai_suggested'
               and t.created_at = (select max(created_at) from text_revision x where x.inspection_id = t.inspection_id and x.point_id = t.point_id)) then
      raise exception 'Inspection % has AI wording not approved', new.id;
    end if;
    new.submitted_at := now();
  end if;
  return new;
end $$;

create trigger inspection_gate before update of status on inspection
  for each row execute function inspection_gate();
