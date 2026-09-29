-- Shop numbers: a short, permanent number per shop (1001, 1002, …) used for the shop's web address,
-- e.g. https://1001.wrynch.app. Existing shops are numbered in the order they were created.

create sequence public.shop_number_seq start 1001;
alter table public.shop add column number integer;
update public.shop s set number = n.num
  from (select id, nextval('public.shop_number_seq') as num from public.shop order by created_at, id) n
 where s.id = n.id;
alter table public.shop alter column number set default nextval('public.shop_number_seq');
alter table public.shop alter column number set not null;
alter table public.shop add constraint shop_number_unique unique (number);
alter sequence public.shop_number_seq owned by public.shop.number;

-- The signed-in user's shops with their numbers (for the shop address and the shop switcher).
create function public.my_shop_list() returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'number', s.number, 'role', m.role) order by m.created_at), '[]'::jsonb)
    from shop_member m join shop s on s.id = m.shop_id
   where m.user_id = auth.uid();
$$;
revoke all on function public.my_shop_list() from public, anon;
grant execute on function public.my_shop_list() to authenticated;

-- Pilot sign-up links now point at the app's own domain.
create or replace function public.approve_pilot_request(p_id uuid, p_base text default 'https://wrynch.app') returns text
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
  return rtrim(p_base, '/') || case when p_base ~ 'wrynch\.app/?$' then '/#/pilot/' else '/app/#/pilot/' end || v_token;
end $$;
revoke all on function public.approve_pilot_request(uuid, text) from public, anon, authenticated;
