-- Shops can use their own AI provider. The key is encrypted by the server (AES-256-GCM, master key in the server
-- environment, bound to the shop) before it reaches the database; only the server key can read the stored value,
-- and people only ever see the provider, model and last four characters.

create table public.shop_ai_key (
  shop_id    uuid primary key references public.shop(id) on delete cascade,
  provider   text not null check (provider in ('anthropic', 'openai')),
  model      text,
  secret     text not null check (secret like 'v1.%'),
  last4      text not null check (length(last4) <= 4),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.shop_ai_key enable row level security;
revoke all on public.shop_ai_key from anon, authenticated;

-- Members: whether the shop uses its own AI key. Owners also see the model and last four characters.
create function public.shop_ai_key_info(p_shop uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text; k shop_ai_key;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from shop_member where shop_id = p_shop and user_id = auth.uid();
  if v_role is null then raise exception 'You don''t have permission to do that in this shop' using errcode = '42501'; end if;
  select * into k from shop_ai_key where shop_id = p_shop;
  if not found then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object('configured', true, 'provider', k.provider,
    'model', case when v_role = 'owner' then k.model end,
    'last4', case when v_role = 'owner' then k.last4 end,
    'updatedAt', case when v_role = 'owner' then k.updated_at end);
end $$;

-- Owners: checked by the server before it encrypts and stores a key.
create function public.assert_shop_owner(p_shop uuid) returns boolean
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  return true;
end $$;

create function public.delete_shop_ai_key(p_shop uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  delete from shop_ai_key where shop_id = p_shop;
end $$;

-- Server only: store an already-encrypted key, and read it back for an inspection's shop.
create function public.store_shop_ai_key(p_shop uuid, p_provider text, p_model text, p_secret text, p_last4 text, p_user uuid) returns void
  language sql security definer set search_path = public as
$$
  insert into shop_ai_key (shop_id, provider, model, secret, last4, updated_by)
  values (p_shop, p_provider, nullif(trim(p_model), ''), p_secret, p_last4, p_user)
  on conflict (shop_id) do update set provider = excluded.provider, model = excluded.model, secret = excluded.secret,
    last4 = excluded.last4, updated_by = excluded.updated_by, updated_at = now();
$$;

create function public.shop_ai_key_secret(p_inspection uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('shopId', k.shop_id, 'provider', k.provider, 'model', k.model, 'secret', k.secret)
    from inspection i join shop_ai_key k on k.shop_id = i.shop_id where i.id = p_inspection;
$$;

revoke all on function public.shop_ai_key_info(uuid), public.assert_shop_owner(uuid), public.delete_shop_ai_key(uuid) from public, anon;
grant execute on function public.shop_ai_key_info(uuid), public.assert_shop_owner(uuid), public.delete_shop_ai_key(uuid) to authenticated;
revoke all on function public.store_shop_ai_key(uuid, text, text, text, text, uuid), public.shop_ai_key_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_shop_ai_key(uuid, text, text, text, text, uuid), public.shop_ai_key_secret(uuid) to service_role;
