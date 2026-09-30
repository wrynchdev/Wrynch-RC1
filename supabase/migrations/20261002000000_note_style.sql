-- Automatic notes at finish: the shop owner chooses whether AI-written notes are customer-friendly or technical.
-- AI notes are still suggestions: they are stored as ai_suggested and submit_inspection refuses until each one is
-- accepted, edited or rejected by the technician.

alter table public.shop add column note_style text not null default 'customer' check (note_style in ('customer', 'technical'));

create function public.set_note_style(p_shop uuid, p_style text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  if p_style not in ('customer', 'technical') then raise exception 'Unknown note style' using errcode = '22023'; end if;
  update shop set note_style = p_style where id = p_shop;
end $$;
revoke all on function public.set_note_style(uuid, text) from public, anon;
grant execute on function public.set_note_style(uuid, text) to authenticated;

-- The note style for an inspection's shop (members only), for the server writing the notes.
create function public.note_style_for(p_inspection uuid) returns text
  language sql stable security definer set search_path = public as
$$
  select s.note_style from inspection i join shop s on s.id = i.shop_id
   where i.id = p_inspection and i.shop_id in (select public.my_shops());
$$;
revoke all on function public.note_style_for(uuid) from public, anon;
grant execute on function public.note_style_for(uuid) to authenticated;

-- Shops list now carries the note style too.
create or replace function public.my_shop_list() returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'number', s.number, 'role', m.role, 'noteStyle', s.note_style) order by m.created_at), '[]'::jsonb)
    from shop_member m join shop s on s.id = m.shop_id
   where m.user_id = auth.uid();
$$;

-- An AI note can now be suggested for a point whose technician note is blank (the row is created).
create or replace function public.ai_record_wording(p_inspection uuid, p_point text, p_text text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if (select status from inspection where id = p_inspection) <> 'in_progress' then return; end if;
  insert into point_note (inspection_id, point_id, tech_text, ai_text, status, customer_text)
  values (p_inspection, p_point, '', p_text, 'ai_suggested', null)
  on conflict (inspection_id, point_id) do update set ai_text = excluded.ai_text, status = 'ai_suggested', updated_at = now();
end $$;
revoke all on function public.ai_record_wording(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_record_wording(uuid, text, text) to service_role;
