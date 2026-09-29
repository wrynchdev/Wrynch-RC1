-- Pilot program: shops apply from the website; an approved application gets a one-time sign-up link.
-- Creating a shop now needs that link (or the caller already owns a shop and is adding a location).
-- Signing in, invites and everything else are unchanged.

create table public.pilot_request (
  id            uuid primary key default gen_random_uuid(),
  shop_name     text not null check (length(shop_name) between 1 and 120),
  contact_name  text not null check (length(contact_name) between 1 and 120),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone         text check (length(phone) <= 40),
  location      text check (length(location) <= 120),
  techs         integer check (techs between 0 and 500),
  current_tool  text check (length(current_tool) <= 120),
  notes         text check (length(notes) <= 2000),
  template      jsonb,                                  -- points mapped from an uploaded template, if they tried it
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'used')),
  token         text unique,
  approved_at   timestamptz,
  used_by       uuid,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.pilot_request enable row level security;
-- No policies: only the server (service role) and the SQL editor see applications.
revoke all on public.pilot_request from public, anon, authenticated;

-- Called by /api/pilot with the service key.
create function public.record_pilot_request(p jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  if coalesce(pg_column_size(p ->> 'template'), 0) > 200000 then raise exception 'Template too large' using errcode = '22023'; end if;
  insert into pilot_request (shop_name, contact_name, email, phone, location, techs, current_tool, notes, template)
  values (trim(p ->> 'shopName'), trim(p ->> 'contactName'), lower(trim(p ->> 'email')), nullif(trim(p ->> 'phone'), ''),
          nullif(trim(p ->> 'location'), ''), nullif(p ->> 'techs', '')::int, nullif(trim(p ->> 'currentTool'), ''),
          nullif(trim(p ->> 'notes'), ''), case when jsonb_typeof(p -> 'template') = 'object' then p -> 'template' end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_pilot_request(jsonb) from public, anon, authenticated;
grant execute on function public.record_pilot_request(jsonb) to service_role;

-- Run in the Supabase SQL editor to accept an application. Returns the sign-up link to send the shop.
--   select public.approve_pilot_request('<id>');
create function public.approve_pilot_request(p_id uuid, p_base text default 'https://wrynch-rc-1.vercel.app') returns text
  language plpgsql security definer set search_path = public as
$$
declare v_token text;
begin
  update pilot_request
     set status = 'approved', approved_at = now(),
         token = coalesce(token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
   where id = p_id and status in ('pending', 'approved', 'declined')
  returning token into v_token;
  if v_token is null then raise exception 'No open application with that id' using errcode = 'P0002'; end if;
  return rtrim(p_base, '/') || '/app/#/pilot/' || v_token;
end $$;
revoke all on function public.approve_pilot_request(uuid, text) from public, anon, authenticated;

-- Is this pilot link still good? (Shown on the sign-up screen; reveals only the shop name.)
create function public.pilot_invite(p_token text) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('shopName', shop_name, 'contactName', contact_name, 'email', email)
    from pilot_request
   where token = p_token and status = 'approved' and approved_at > now() - interval '30 days';
$$;
revoke all on function public.pilot_invite(text) from public;
grant execute on function public.pilot_invite(text) to anon, authenticated;

-- create_shop: needs an approved pilot link unless the caller already owns a shop.
drop function public.create_shop(text, text, jsonb);
create function public.create_shop(p_name text, p_display_name text, p_template jsonb, p_pilot_token text default null) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_shop uuid; v_req pilot_request;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from shop_member where user_id = auth.uid() and role = 'owner') then
    select * into v_req from pilot_request
     where token = p_pilot_token and status = 'approved' and approved_at > now() - interval '30 days' for update;
    if not found then
      raise exception 'Wrynch is in a pilot program. Apply on the website and use the sign-up link we send you.' using errcode = '42501';
    end if;
    update pilot_request set status = 'used', used_by = auth.uid(), used_at = now() where id = v_req.id;
  end if;
  perform validate_template(p_template);
  insert into shop (name) values (trim(p_name)) returning id into v_shop;
  insert into shop_member (shop_id, user_id, role, display_name) values (v_shop, auth.uid(), 'owner', trim(p_display_name));
  insert into template (shop_id, name, version, data, created_by) values (v_shop, coalesce(p_template ->> 'name', 'Shop MPI'), 1, p_template, auth.uid());
  insert into rules_version (shop_id, number, created_by) values (v_shop, 1, auth.uid());
  return v_shop;
end $$;
revoke all on function public.create_shop(text, text, jsonb, text) from public, anon;
grant execute on function public.create_shop(text, text, jsonb, text) to authenticated;
