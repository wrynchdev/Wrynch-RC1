-- Turning component checks off. Shop owners can switch off catalog checks for their shop, and Wrynch staff
-- (platform admins) can switch one off for every shop. Nobody can add checks: only catalog checks can be listed,
-- and each part always keeps at least one check that is on. A check that's off can't be recorded on a new
-- inspection; results already recorded stay as they are (and can still be corrected).

create table public.platform_disabled_check (
  check_key   text primary key references public.condition_check(key),
  disabled_by uuid,
  disabled_at timestamptz not null default now()
);
alter table public.platform_disabled_check enable row level security;
revoke all on public.platform_disabled_check from anon, authenticated;

create table public.shop_disabled_check (
  shop_id     uuid not null references public.shop(id) on delete cascade,
  check_key   text not null references public.condition_check(key),
  disabled_by uuid,
  disabled_at timestamptz not null default now(),
  primary key (shop_id, check_key)
);
alter table public.shop_disabled_check enable row level security;
revoke all on public.shop_disabled_check from anon, authenticated;

create function public.check_disabled(p_shop uuid, p_check text) returns boolean
  language sql stable security definer set search_path = public as
$$
  select exists (select 1 from platform_disabled_check where check_key = p_check)
      or exists (select 1 from shop_disabled_check where shop_id = p_shop and check_key = p_check);
$$;

-- The check to record a quick "OK" on: the one asked for if it's on, else the part's first check that is on
-- (descriptive checks before measurements).
create function public.usable_check(p_shop uuid, p_class int, p_check text) returns text
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select key from condition_check where key = p_check and class_id = p_class and not check_disabled(p_shop, key)),
    (select key from condition_check where class_id = p_class and not check_disabled(p_shop, key) order by value_type = 'numeric', key limit 1),
    p_check);
$$;

-- Which checks are off: Wrynch-wide and for this shop, and whether the caller is Wrynch staff.
create function public.disabled_checks(p_shop uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if p_shop is not null and p_shop not in (select public.my_shops()) and not public.is_platform_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'platform', coalesce((select jsonb_agg(check_key order by check_key) from platform_disabled_check), '[]'::jsonb),
    'shop', coalesce((select jsonb_agg(check_key order by check_key) from shop_disabled_check where shop_id = p_shop), '[]'::jsonb),
    'admin', public.is_platform_admin());
end $$;

-- Owners: turn one of the catalog's checks on or off for the shop.
create function public.set_shop_check_enabled(p_shop uuid, p_check text, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_class int;
begin
  perform require_role(p_shop, array['owner']);
  select class_id into v_class from condition_check where key = p_check;
  if v_class is null then raise exception 'Unknown check %', p_check using errcode = '22023'; end if;
  if coalesce(p_enabled, true) then
    delete from shop_disabled_check where shop_id = p_shop and check_key = p_check;
    return;
  end if;
  if exists (select 1 from platform_disabled_check where check_key = p_check) then return; end if;
  if not exists (select 1 from condition_check where class_id = v_class and key <> p_check and not check_disabled(p_shop, key)) then
    raise exception 'Each part needs at least one check, so this one can''t be turned off' using errcode = '22023';
  end if;
  insert into shop_disabled_check (shop_id, check_key, disabled_by) values (p_shop, p_check, auth.uid())
    on conflict (shop_id, check_key) do nothing;
end $$;

-- Wrynch staff: turn one of the catalog's checks on or off for every shop.
create function public.set_platform_check_enabled(p_check text, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_class int;
begin
  perform require_platform_admin();
  select class_id into v_class from condition_check where key = p_check;
  if v_class is null then raise exception 'Unknown check %', p_check using errcode = '22023'; end if;
  if coalesce(p_enabled, true) then
    delete from platform_disabled_check where check_key = p_check;
    return;
  end if;
  if not exists (select 1 from condition_check c where c.class_id = v_class and c.key <> p_check
                   and not exists (select 1 from platform_disabled_check d where d.check_key = c.key)) then
    raise exception 'Each part needs at least one check, so this one can''t be turned off' using errcode = '22023';
  end if;
  insert into platform_disabled_check (check_key, disabled_by) values (p_check, auth.uid()) on conflict (check_key) do nothing;
end $$;

-- Recording a check refuses one that's off, unless this inspection already has a result for it (so it can be fixed).
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
  if check_disabled(r.shop_id, p_check)
     and not exists (select 1 from check_result where inspection_id = p_inspection and component_id = v_comp and check_key = p_check) then
    raise exception 'This check is turned off for your shop' using errcode = '22023';
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

-- "Nothing found" records OK on a check that is on.
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
      values (p_inspection, v_comp, usable_check(r.shop_id, split_part(it ->> 'key', '@', 1)::int, it ->> 'check'), null, 'ok', r.rules_version_id, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;

-- Confirming an AI "looks OK" records OK on a check that is on.
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
          values (p_inspection, o.component_id, usable_check(r.shop_id, v_class, it ->> 'check'), null, 'ok', r.rules_version_id, auth.uid());
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.check_disabled(uuid, text), public.usable_check(uuid, int, text), public.disabled_checks(uuid),
  public.set_shop_check_enabled(uuid, text, boolean), public.set_platform_check_enabled(text, boolean) from public, anon;
grant execute on function public.disabled_checks(uuid), public.set_shop_check_enabled(uuid, text, boolean),
  public.set_platform_check_enabled(text, boolean) to authenticated;
