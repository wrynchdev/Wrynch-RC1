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
  node_type text not null check (node_type in ('vehicle','vehicle_configuration','system','component','part','fitment_rule','modification','maintenance_service','maintenance_record','dtc','symptom','diagnostic_test','repair','inspection','measurement','trip','observation','source','evidence')),
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
  predicate text not null check (predicate in ('HAS_COMPONENT','BELONGS_TO_SYSTEM','FITS','COMPATIBLE_WITH','INCOMPATIBLE_WITH','REQUIRES','RECOMMENDS','REPLACES','SUPERSEDES','REPLACED_BY','DEPENDS_ON','CAUSES','SYMPTOM_OF','DIAGNOSED_BY','REPAIRED_BY','MAINTAINED_BY','MODIFIED_BY','INSTALLED_ON','REMOVED_FROM','MEASURED_BY','CONNECTED_TO','CONTROLLED_BY','POWERED_BY','USES_FLUID','USES_PART','HAS_SPECIFICATION','HAS_MEASUREMENT','HAS_HISTORY','HAS_FINDING','HAS_SYMPTOM','HAS_DTC','AFFECTS_FITMENT','OBSERVED_ON')),
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
  check (effective_to is null or effective_to > effective_from),
  check ((state_kind = 'current' and effective_to is null) or state_kind <> 'current')
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
  check (vehicle_node_id is not null or part_id is not null),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
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
  evidence jsonb not null default '{}'::jsonb
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
  evidence jsonb not null default '{}'::jsonb
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

-- ------------------------------------------------------------------ cross-row integrity
-- These checks prevent a graph/digital-twin record from accidentally joining
-- objects belonging to different vehicles or shops. RLS protects reads; these
-- triggers protect semantic integrity for service-role writes.
create or replace function public.vio_check_shop_consistency() returns trigger
language plpgsql security definer set search_path = public as $
declare node_shop uuid; other_shop uuid; vehicle_shop uuid; config_vehicle uuid; part_shop uuid;
begin
  if tg_table_name = 'vio_relationship' then
    select shop_id into node_shop from vio_node where id = new.source_node_id;
    if node_shop is not null and new.shop_id is distinct from node_shop then
      raise exception 'VIO relationship source node belongs to another shop';
    end if;
    select shop_id into other_shop from vio_node where id = new.target_node_id;
    if other_shop is not null and new.shop_id is distinct from other_shop then
      raise exception 'VIO relationship target node belongs to another shop';
    end if;
  elsif tg_table_name = 'vio_vehicle_node' then
    select v.shop_id into vehicle_shop from vehicle v where v.id = new.vehicle_id;
    select n.shop_id into node_shop from vio_node n where n.id = new.node_id;
    if node_shop is not null and node_shop is distinct from vehicle_shop then
      raise exception 'VIO vehicle node belongs to another shop';
    end if;
  elsif tg_table_name = 'vio_configuration_state' then
    select v.shop_id into vehicle_shop from vehicle v where v.id = new.vehicle_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO configuration shop does not match vehicle'; end if;
  elsif tg_table_name = 'vio_installed_part' then
    select v.shop_id into vehicle_shop from vehicle v where v.id = new.vehicle_id;
    select c.vehicle_id into config_vehicle from vio_configuration_state c where c.id = new.configuration_state_id;
    select p.shop_id into part_shop from vio_part p where p.id = new.part_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO installed-part shop does not match vehicle'; end if;
    if config_vehicle is distinct from new.vehicle_id then raise exception 'VIO installed part configuration belongs to another vehicle'; end if;
    if part_shop is not null and part_shop is distinct from new.shop_id then raise exception 'VIO installed part references another shop part'; end if;
    if new.component_instance_id is not null and not exists (select 1 from component_instance ci where ci.id=new.component_instance_id and ci.vehicle_id=new.vehicle_id) then
      raise exception 'VIO installed part component belongs to another vehicle';
    end if;
  elsif tg_table_name = 'vio_fitment_rule' then
    if new.shop_id is not null and new.vehicle_node_id is not null then
      select n.shop_id into node_shop from vio_node n where n.id=new.vehicle_node_id;
      if node_shop is not null and node_shop is distinct from new.shop_id then raise exception 'VIO fitment vehicle node belongs to another shop'; end if;
    end if;
    if new.shop_id is not null and new.part_id is not null then
      select p.shop_id into part_shop from vio_part p where p.id=new.part_id;
      if part_shop is not null and part_shop is distinct from new.shop_id then raise exception 'VIO fitment part belongs to another shop'; end if;
    end if;
  elsif tg_table_name = 'vio_modification' then
    select v.shop_id into vehicle_shop from vehicle v where v.id=new.vehicle_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO modification shop does not match vehicle'; end if;
    if new.configuration_state_id is not null and not exists (select 1 from vio_configuration_state c where c.id=new.configuration_state_id and c.vehicle_id=new.vehicle_id) then
      raise exception 'VIO modification configuration belongs to another vehicle';
    end if;
  elsif tg_table_name = 'vio_maintenance_record' then
    select v.shop_id into vehicle_shop from vehicle v where v.id=new.vehicle_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO maintenance shop does not match vehicle'; end if;
    if new.component_instance_id is not null and not exists (select 1 from component_instance ci where ci.id=new.component_instance_id and ci.vehicle_id=new.vehicle_id) then
      raise exception 'VIO maintenance component belongs to another vehicle';
    end if;
    if new.part_id is not null and exists (select 1 from vio_part p where p.id=new.part_id and p.shop_id is not null and p.shop_id is distinct from new.shop_id) then
      raise exception 'VIO maintenance part belongs to another shop';
    end if;
  elsif tg_table_name = 'vio_modification_part' then
    if not exists (select 1 from vio_modification m join vio_part p on p.id=new.part_id where m.id=new.modification_id and (p.shop_id is null or p.shop_id=m.shop_id)) then
      raise exception 'VIO modification part belongs to another shop';
    end if;
  elsif tg_table_name = 'vio_usage_trip' then
    select v.shop_id into vehicle_shop from vehicle v where v.id=new.vehicle_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO trip shop does not match vehicle'; end if;
    if new.ended_at is not null and new.ended_at < new.started_at then raise exception 'VIO trip cannot end before it starts'; end if;
  elsif tg_table_name = 'vio_usage_observation' then
    select v.shop_id into vehicle_shop from vehicle v where v.id=new.vehicle_id;
    if vehicle_shop is distinct from new.shop_id then raise exception 'VIO observation shop does not match vehicle'; end if;
    if new.trip_id is not null and not exists (select 1 from vio_usage_trip t where t.id=new.trip_id and t.vehicle_id=new.vehicle_id) then
      raise exception 'VIO observation trip belongs to another vehicle';
    end if;
    if new.numeric_value is null and new.text_value is null then raise exception 'VIO observation requires a numeric or text value'; end if;
  end if;
  return new;
end $;

create trigger vio_relationship_integrity before insert or update on public.vio_relationship for each row execute function public.vio_check_shop_consistency();
create trigger vio_vehicle_node_integrity before insert or update on public.vio_vehicle_node for each row execute function public.vio_check_shop_consistency();
create trigger vio_configuration_integrity before insert or update on public.vio_configuration_state for each row execute function public.vio_check_shop_consistency();
create trigger vio_installed_part_integrity before insert or update on public.vio_installed_part for each row execute function public.vio_check_shop_consistency();
create trigger vio_fitment_integrity before insert or update on public.vio_fitment_rule for each row execute function public.vio_check_shop_consistency();
create trigger vio_modification_integrity before insert or update on public.vio_modification for each row execute function public.vio_check_shop_consistency();
create trigger vio_modification_part_integrity before insert or update on public.vio_modification_part for each row execute function public.vio_check_shop_consistency();
create trigger vio_maintenance_integrity before insert or update on public.vio_maintenance_record for each row execute function public.vio_check_shop_consistency();
create trigger vio_trip_integrity before insert or update on public.vio_usage_trip for each row execute function public.vio_check_shop_consistency();
create trigger vio_observation_integrity before insert or update on public.vio_usage_observation for each row execute function public.vio_check_shop_consistency();

-- Only one open factory/current state may exist for a vehicle. Historical
-- states are allowed to coexist but must have valid time bounds.
create unique index vio_one_factory_state on public.vio_configuration_state(vehicle_id) where state_kind='factory';
create unique index vio_one_current_state on public.vio_configuration_state(vehicle_id) where state_kind='current' and effective_to is null;

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
