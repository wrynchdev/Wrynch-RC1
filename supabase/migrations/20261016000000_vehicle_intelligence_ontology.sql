-- Vehicle Intelligence Ontology (VIO) foundation.
-- Extends Wrynch's existing component/inspection ontology instead of replacing it.
-- External standards are represented through source mappings; VIO owns vehicle state,
-- installed parts, contextual fitment, modifications, maintenance, diagnostics, usage,
-- provenance, and graph relationships.

create table public.vio_source (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  standard_name text,
  uri text,
  description text,
  created_at timestamptz not null default now()
);

insert into public.vio_source (key,name,standard_name,uri,description) values
('wrynch','Wrynch Vehicle Intelligence Ontology','VIO',null,'Application/domain layer for vehicle state, history, fitment, maintenance, diagnostics, inspections and usage.'),
('auto','Automotive Ontology','AUTO','https://edmcouncil.org/automotive-ontology/','Automotive semantic vocabulary foundation.'),
('schema-org-automotive','Schema.org Automotive','Schema.org Automotive','https://schema.org/docs/automotive.html','Web vocabulary for automotive entities.'),
('saref4auto','SAREF4AUTO','SAREF4AUTO','https://saref.etsi.org/saref4auto/','Automotive IoT/observation semantics.'),
('vsso','Vehicle Signal Specification Ontology','VSSo','https://www.w3.org/TR/vsso-core/','Vehicle signal semantics.'),
('aces','ACES','ACES',null,'Aftermarket application/fitment data mapping.'),
('obd','OBD diagnostic ontology','OBD',null,'Diagnostic/OBD vocabulary mapping.')
on conflict (key) do nothing;

create table public.vio_node (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shop(id) on delete cascade,
  node_type text not null,
  canonical_key text not null,
  label text not null,
  external_ref jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (shop_id,node_type,canonical_key)
);

create index vio_node_type_key on public.vio_node(node_type,canonical_key);

create table public.vio_vehicle_node (
  vehicle_id uuid primary key references public.vehicle(id) on delete cascade,
  node_id uuid not null unique references public.vio_node(id) on delete cascade
);

create table public.vio_relationship (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shop(id) on delete cascade,
  source_node_id uuid not null references public.vio_node(id) on delete cascade,
  predicate text not null,
  target_node_id uuid not null references public.vio_node(id) on delete cascade,
  confidence numeric check (confidence between 0 and 1),
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check (source_node_id <> target_node_id)
);
create index vio_relationship_source on public.vio_relationship(source_node_id,predicate);
create index vio_relationship_target on public.vio_relationship(target_node_id,predicate);
create index vio_relationship_validity on public.vio_relationship(valid_from,valid_to);

create table public.vio_configuration_state (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  state_kind text not null check (state_kind in ('factory','current','historical')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  odometer integer check (odometer >= 0),
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index vio_configuration_vehicle on public.vio_configuration_state(vehicle_id,effective_from desc);

create table public.vio_part (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shop(id) on delete cascade,
  manufacturer text,
  part_number text,
  normalized_part_number text,
  description text not null,
  category text,
  subcategory text,
  is_oem boolean,
  metadata jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id),
  created_at timestamptz not null default now()
);
create index vio_part_number on public.vio_part(normalized_part_number);
create index vio_part_category on public.vio_part(category,subcategory);

create table public.vio_part_identifier (
  part_id uuid not null references public.vio_part(id) on delete cascade,
  identifier_type text not null,
  identifier text not null,
  source_id uuid references public.vio_source(id),
  primary key(part_id,identifier_type,identifier)
);

create table public.vio_part_spec (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.vio_part(id) on delete cascade,
  key text not null,
  numeric_value numeric,
  text_value text,
  unit text,
  source_id uuid references public.vio_source(id),
  metadata jsonb not null default '{}'::jsonb
);
create index vio_part_spec_lookup on public.vio_part_spec(part_id,key);

create table public.vio_installed_part (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  configuration_state_id uuid not null references public.vio_configuration_state(id) on delete cascade,
  part_id uuid not null references public.vio_part(id),
  component_instance_id uuid references public.component_instance(id),
  position text,
  installed_at timestamptz not null default now(),
  removed_at timestamptz,
  odometer_installed integer check (odometer_installed >= 0),
  odometer_removed integer check (odometer_removed is null or odometer_removed >= 0),
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb,
  notes text,
  check (removed_at is null or removed_at >= installed_at)
);
create index vio_installed_part_vehicle on public.vio_installed_part(vehicle_id,installed_at desc);
create index vio_installed_part_part on public.vio_installed_part(part_id);

create table public.vio_fitment_rule (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shop(id) on delete cascade,
  vehicle_node_id uuid references public.vio_node(id) on delete cascade,
  part_id uuid references public.vio_part(id) on delete cascade,
  status text not null check (status in ('direct','conditional','modification_required','incompatible','unknown')),
  requirements jsonb not null default '{}'::jsonb,
  exclusions jsonb not null default '{}'::jsonb,
  effects jsonb not null default '{}'::jsonb,
  confidence numeric check (confidence between 0 and 1),
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check (vehicle_node_id is not null or part_id is not null)
);
create index vio_fitment_vehicle on public.vio_fitment_rule(vehicle_node_id,status);
create index vio_fitment_part on public.vio_fitment_rule(part_id,status);

create table public.vio_modification (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  configuration_state_id uuid references public.vio_configuration_state(id) on delete set null,
  name text not null,
  modification_type text not null,
  installed_at timestamptz,
  removed_at timestamptz,
  odometer integer check (odometer is null or odometer >= 0),
  installer text,
  requirements jsonb not null default '{}'::jsonb,
  effects jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb,
  notes text
);
create index vio_modification_vehicle on public.vio_modification(vehicle_id,installed_at desc);

create table public.vio_modification_part (
  modification_id uuid not null references public.vio_modification(id) on delete cascade,
  part_id uuid not null references public.vio_part(id),
  quantity numeric not null default 1 check (quantity > 0),
  primary key(modification_id,part_id)
);

create table public.vio_maintenance_service (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  system text,
  interval_miles integer check (interval_miles is null or interval_miles > 0),
  interval_days integer check (interval_days is null or interval_days > 0),
  requirements jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id),
  description text
);

create table public.vio_maintenance_record (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  service_id uuid references public.vio_maintenance_service(id),
  performed_at timestamptz not null default now(),
  odometer integer not null check (odometer >= 0),
  component_instance_id uuid references public.component_instance(id),
  part_id uuid references public.vio_part(id),
  quantity numeric,
  fluid_spec text,
  cost numeric check (cost is null or cost >= 0),
  technician text,
  shop_name text,
  notes text,
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'::jsonb
);
create index vio_maintenance_vehicle on public.vio_maintenance_record(vehicle_id,performed_at desc);

create table public.vio_diagnostic_code (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  system text,
  title text not null,
  description text,
  source_id uuid references public.vio_source(id)
);

create table public.vio_diagnostic_cause (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.vio_diagnostic_code(id) on delete cascade,
  component_class_id integer references public.component_class(id),
  failure_mode text not null,
  likelihood numeric check (likelihood between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id)
);

create table public.vio_diagnostic_test (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  component_class_id integer references public.component_class(id),
  required_tools text[] not null default '{}',
  expected_result text,
  procedure jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id)
);

create table public.vio_diagnostic_repair (
  id uuid primary key default gen_random_uuid(),
  code_id uuid references public.vio_diagnostic_code(id) on delete cascade,
  component_class_id integer references public.component_class(id),
  repair text not null,
  prerequisites jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id)
);

create table public.vio_usage_trip (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_lat numeric,
  start_lon numeric,
  end_lat numeric,
  end_lon numeric,
  distance_miles numeric check (distance_miles is null or distance_miles >= 0),
  idle_minutes numeric check (idle_minutes is null or idle_minutes >= 0),
  operating_conditions jsonb not null default '{}'::jsonb,
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'
);
create index vio_usage_trip_vehicle on public.vio_usage_trip(vehicle_id,started_at desc);

create table public.vio_usage_observation (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop(id) on delete cascade,
  vehicle_id uuid not null references public.vehicle(id) on delete cascade,
  trip_id uuid references public.vio_usage_trip(id) on delete cascade,
  signal_key text not null,
  observed_at timestamptz not null,
  numeric_value numeric,
  text_value text,
  unit text,
  latitude numeric,
  longitude numeric,
  source_id uuid references public.vio_source(id),
  evidence jsonb not null default '{}'
);
create index vio_usage_observation_vehicle on public.vio_usage_observation(vehicle_id,signal_key,observed_at desc);

create table public.vio_assertion_evidence (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid references public.vio_relationship(id) on delete cascade,
  entity_type text,
  entity_id uuid,
  source_id uuid references public.vio_source(id),
  source_uri text,
  quote text,
  observed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  confidence numeric check (confidence between 0 and 1),
  metadata jsonb not null default '{}'
);
create index vio_evidence_entity on public.vio_assertion_evidence(entity_type,entity_id);

-- RLS: global ontology/catalog rows are readable; shop-scoped rows are readable by shop members.
-- Writes are intentionally reserved for service_role/server functions until VIO APIs are added.
alter table public.vio_source enable row level security;
alter table public.vio_node enable row level security;
alter table public.vio_vehicle_node enable row level security;
alter table public.vio_relationship enable row level security;
alter table public.vio_configuration_state enable row level security;
alter table public.vio_part enable row level security;
alter table public.vio_part_identifier enable row level security;
alter table public.vio_part_spec enable row level security;
alter table public.vio_installed_part enable row level security;
alter table public.vio_fitment_rule enable row level security;
alter table public.vio_modification enable row level security;
alter table public.vio_modification_part enable row level security;
alter table public.vio_maintenance_service enable row level security;
alter table public.vio_maintenance_record enable row level security;
alter table public.vio_diagnostic_code enable row level security;
alter table public.vio_diagnostic_cause enable row level security;
alter table public.vio_diagnostic_test enable row level security;
alter table public.vio_diagnostic_repair enable row level security;
alter table public.vio_usage_trip enable row level security;
alter table public.vio_usage_observation enable row level security;
alter table public.vio_assertion_evidence enable row level security;

create policy vio_source_read on public.vio_source for select using (true);
create policy vio_node_read on public.vio_node for select using (
  shop_id is null or exists (select 1 from public.shop_member m where m.shop_id = vio_node.shop_id and m.user_id = auth.uid())
);
create policy vio_vehicle_node_read on public.vio_vehicle_node for select using (
  exists (select 1 from public.vehicle v join public.shop_member m on m.shop_id=v.shop_id where v.id=vio_vehicle_node.vehicle_id and m.user_id=auth.uid())
);
create policy vio_relationship_read on public.vio_relationship for select using (
  shop_id is null or exists (select 1 from public.shop_member m where m.shop_id = vio_relationship.shop_id and m.user_id = auth.uid())
);
create policy vio_config_read on public.vio_configuration_state for select using (
  exists (select 1 from public.shop_member m where m.shop_id = vio_configuration_state.shop_id and m.user_id=auth.uid())
);
create policy vio_part_read on public.vio_part for select using (
  shop_id is null or exists (select 1 from public.shop_member m where m.shop_id = vio_part.shop_id and m.user_id=auth.uid())
);
create policy vio_part_identifier_read on public.vio_part_identifier for select using (
  exists (select 1 from public.vio_part p join public.shop_member m on m.shop_id=p.shop_id where p.id=vio_part_identifier.part_id and m.user_id=auth.uid())
  or exists (select 1 from public.vio_part p where p.id=vio_part_identifier.part_id and p.shop_id is null)
);
create policy vio_part_spec_read on public.vio_part_spec for select using (
  exists (select 1 from public.vio_part p join public.shop_member m on m.shop_id=p.shop_id where p.id=vio_part_spec.part_id and m.user_id=auth.uid())
  or exists (select 1 from public.vio_part p where p.id=vio_part_spec.part_id and p.shop_id is null)
);
create policy vio_installed_part_read on public.vio_installed_part for select using (
  exists (select 1 from public.shop_member m where m.shop_id=vio_installed_part.shop_id and m.user_id=auth.uid())
);
create policy vio_fitment_read on public.vio_fitment_rule for select using (
  shop_id is null or exists (select 1 from public.shop_member m where m.shop_id=vio_fitment_rule.shop_id and m.user_id=auth.uid())
);
create policy vio_modification_read on public.vio_modification for select using (
  exists (select 1 from public.shop_member m where m.shop_id=vio_modification.shop_id and m.user_id=auth.uid())
);
create policy vio_modification_part_read on public.vio_modification_part for select using (
  exists (select 1 from public.vio_modification x join public.shop_member m on m.shop_id=x.shop_id where x.id=vio_modification_part.modification_id and m.user_id=auth.uid())
);
create policy vio_maintenance_service_read on public.vio_maintenance_service for select using (true);
create policy vio_maintenance_record_read on public.vio_maintenance_record for select using (
  exists (select 1 from public.shop_member m where m.shop_id=vio_maintenance_record.shop_id and m.user_id=auth.uid())
);
create policy vio_diagnostic_code_read on public.vio_diagnostic_code for select using (true);
create policy vio_diagnostic_cause_read on public.vio_diagnostic_cause for select using (true);
create policy vio_diagnostic_test_read on public.vio_diagnostic_test for select using (true);
create policy vio_diagnostic_repair_read on public.vio_diagnostic_repair for select using (true);
create policy vio_usage_trip_read on public.vio_usage_trip for select using (
  exists (select 1 from public.shop_member m where m.shop_id=vio_usage_trip.shop_id and m.user_id=auth.uid())
);
create policy vio_usage_observation_read on public.vio_usage_observation for select using (
  exists (select 1 from public.shop_member m where m.shop_id=vio_usage_observation.shop_id and m.user_id=auth.uid())
);
create policy vio_evidence_read on public.vio_assertion_evidence for select using (
  (relationship_id is null and entity_id is null)
  or exists (
    select 1 from public.vio_relationship r join public.shop_member m on m.shop_id=r.shop_id
    where r.id=vio_assertion_evidence.relationship_id and m.user_id=auth.uid()
  )
);

revoke insert, update, delete on all tables in this migration from anon, authenticated;
grant select on all tables in this migration to authenticated;
grant all on all tables in this migration to service_role;

comment on table public.vio_relationship is 'Generic semantic graph edge. Use established predicates before adding new predicates.';
comment on table public.vio_configuration_state is 'Historical/factory/current state of a physical vehicle; the core of the vehicle digital twin.';
comment on table public.vio_fitment_rule is 'Configuration-aware fitment. ACES or other sources can be mapped here; VIO adds current-state and modification context.';
comment on table public.vio_assertion_evidence is 'Evidence/provenance for graph assertions and inferred vehicle knowledge.';
