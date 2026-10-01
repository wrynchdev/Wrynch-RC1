-- Tekmetric integration.
-- In: a repair order created in Tekmetric becomes a Wrynch inspection (RO number, vehicle, customer, technician).
-- Out: after review, the advisor exports the approved work, customer notes and report link back to the repair order.
-- Wrynch's own Tekmetric API credentials live in server environment variables, never in the database; a shop
-- only links its Tekmetric shop id. Component conditions and history stay in Wrynch.

create table public.tekmetric_link (
  shop_id           uuid primary key references public.shop(id) on delete cascade,
  tekmetric_shop_id bigint not null check (tekmetric_shop_id > 0),
  webhook_token     text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.tekmetric_link enable row level security;
revoke all on public.tekmetric_link from anon, authenticated;

create table public.tekmetric_event (
  id            bigint generated always as identity primary key,
  shop_id       uuid not null references public.shop(id) on delete cascade,
  kind          text not null check (kind in ('import', 'export', 'webhook')),
  ro_id         bigint,
  inspection_id uuid references public.inspection(id) on delete set null,
  status        text not null check (status in ('ok', 'error', 'skipped')),
  detail        text not null default '',
  created_at    timestamptz not null default now()
);
create index on public.tekmetric_event (shop_id, id desc);
alter table public.tekmetric_event enable row level security;
revoke all on public.tekmetric_event from anon, authenticated;

alter table public.inspection add column tekmetric_ro_id bigint, add column tekmetric_exported_at timestamptz;
create unique index inspection_tekmetric_ro on public.inspection (shop_id, tekmetric_ro_id) where tekmetric_ro_id is not null;

-- Owner: link (or unlink) the shop's Tekmetric shop id. Returns the link, including the webhook address token.
create function public.set_tekmetric_link(p_shop uuid, p_tekmetric_shop_id bigint, p_enabled boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  if p_tekmetric_shop_id is null then
    delete from tekmetric_link where shop_id = p_shop;
  else
    if p_tekmetric_shop_id <= 0 then raise exception 'Enter your Tekmetric shop ID (a number)' using errcode = '22023'; end if;
    insert into tekmetric_link (shop_id, tekmetric_shop_id, enabled) values (p_shop, p_tekmetric_shop_id, coalesce(p_enabled, true))
    on conflict (shop_id) do update set tekmetric_shop_id = excluded.tekmetric_shop_id, enabled = excluded.enabled, updated_at = now();
  end if;
  return public.tekmetric_link_for(p_shop);
end $$;

-- Members: the shop's link and recent activity. Only owners see the webhook token.
create function public.tekmetric_link_for(p_shop uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from shop_member where shop_id = p_shop and user_id = auth.uid();
  if v_role is null then raise exception 'You don''t have permission to do that in this shop' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'linked', l.shop_id is not null,
      'tekmetricShopId', l.tekmetric_shop_id,
      'enabled', coalesce(l.enabled, false),
      'webhookToken', case when v_role = 'owner' then l.webhook_token end,
      'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'roId', e.ro_id, 'inspectionId', e.inspection_id,
                  'status', e.status, 'detail', e.detail) order by e.id desc)
                from (select * from tekmetric_event where shop_id = p_shop order by id desc limit 15) e), '[]'))
    from (select p_shop as sid) s left join tekmetric_link l on l.shop_id = s.sid
  );
end $$;

-- Owners and advisors: what an export needs to know about one inspection.
create function public.tekmetric_export_info(p_inspection uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare r inspection; l tekmetric_link;
begin
  select * into r from inspection where id = p_inspection;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  perform require_role(r.shop_id, array['owner', 'advisor']);
  select * into l from tekmetric_link where shop_id = r.shop_id;
  return jsonb_build_object('shopId', r.shop_id, 'roId', r.tekmetric_ro_id, 'ro', r.ro, 'status', r.status,
    'exportedAt', r.tekmetric_exported_at, 'tekmetricShopId', l.tekmetric_shop_id, 'enabled', coalesce(l.enabled, false));
end $$;

-- Any member: which inspections came from Tekmetric (for the inspection and advisor screens).
create function public.tekmetric_ro_of(p_inspection uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('roId', i.tekmetric_ro_id, 'exportedAt', i.tekmetric_exported_at)
    from inspection i where i.id = p_inspection and i.shop_id in (select public.my_shops());
$$;

-- Server only: find the shop for a webhook address.
create function public.tekmetric_shop_for_token(p_token text) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('shopId', shop_id, 'tekmetricShopId', tekmetric_shop_id, 'enabled', enabled)
    from tekmetric_link where webhook_token = p_token and length(p_token) >= 32;
$$;

-- Server only: create (or refresh) the Wrynch inspection for a Tekmetric repair order. Safe to call twice.
create function public.tekmetric_import_ro(p_shop uuid, p_ro jsonb) returns uuid
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
  values (p_shop, v_vehicle,
          (select id from template where shop_id = p_shop and is_active),
          (select id from rules_version where shop_id = p_shop and is_active),
          nullif(p_ro ->> 'roNumber', ''), (p_ro ->> 'odometer')::int,
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_ro -> 'concerns', '[]'::jsonb)) x where trim(x) <> ''), '{}'),
          nullif(p_ro ->> 'technician', ''), v_ro)
  returning id into v_id;
  return v_id;
end $$;

-- Server only: record activity, and mark an inspection exported.
create function public.tekmetric_log(p_shop uuid, p_kind text, p_ro bigint, p_inspection uuid, p_status text, p_detail text) returns void
  language sql security definer set search_path = public as
$$
  insert into tekmetric_event (shop_id, kind, ro_id, inspection_id, status, detail)
  values (p_shop, p_kind, p_ro, p_inspection, p_status, left(coalesce(p_detail, ''), 500));
$$;

create function public.tekmetric_mark_exported(p_inspection uuid) returns void
  language sql security definer set search_path = public as
$$
  update inspection set tekmetric_exported_at = now() where id = p_inspection;
$$;

revoke all on function public.set_tekmetric_link(uuid, bigint, boolean), public.tekmetric_link_for(uuid),
  public.tekmetric_export_info(uuid), public.tekmetric_ro_of(uuid) from public, anon;
grant execute on function public.set_tekmetric_link(uuid, bigint, boolean), public.tekmetric_link_for(uuid),
  public.tekmetric_export_info(uuid), public.tekmetric_ro_of(uuid) to authenticated;

revoke all on function public.tekmetric_shop_for_token(text), public.tekmetric_import_ro(uuid, jsonb),
  public.tekmetric_log(uuid, text, bigint, uuid, text, text), public.tekmetric_mark_exported(uuid) from public, anon, authenticated;
grant execute on function public.tekmetric_shop_for_token(text), public.tekmetric_import_ro(uuid, jsonb),
  public.tekmetric_log(uuid, text, bigint, uuid, text, text), public.tekmetric_mark_exported(uuid) to service_role;
