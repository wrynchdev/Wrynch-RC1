-- Declined work: what the shop did about each part a customer didn't approve on a sent report (texted them, booked
-- it, or let it go). The list of declined parts itself is worked out by the app from the inspections (the same
-- rating rules as everywhere else, src/domain/declined.ts); this table only keeps the shop's follow-up.

create table public.declined_followup (
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  component_id  uuid not null references public.component_instance(id),
  status        text not null default 'open' check (status in ('open','contacted','booked','dismissed')),
  due_on        date,
  contacted_at  timestamptz,
  contacts      integer not null default 0 check (contacts >= 0),
  note          text check (length(note) <= 500),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (inspection_id, component_id)
);
alter table public.declined_followup enable row level security;
create policy member_read on public.declined_followup for select to authenticated
  using (inspection_id in (select id from public.inspection where shop_id in (select public.my_shops())));
revoke insert, update, delete, truncate on public.declined_followup from anon, authenticated;
revoke all on public.declined_followup from anon;

create function public.followup_doc(f public.declined_followup) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('inspectionId', f.inspection_id, 'compKey', comp_key(f.component_id), 'status', f.status, 'dueOn', f.due_on,
    'contactedAt', f.contacted_at, 'contacts', f.contacts, 'note', f.note, 'updatedAt', f.updated_at);
$$;

-- Advisors and owners: every visit of each vehicle that had a report sent in the last p_days, with the shop's
-- follow-ups. Later visits are included so the app can tell recovered and replaced items from open ones.
create function public.declined_work(p_shop uuid, p_days int default 365) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_vehicles uuid[];
begin
  perform require_role(p_shop, array['owner','advisor']);
  select coalesce(array_agg(distinct vehicle_id), '{}') into v_vehicles from inspection
   where shop_id = p_shop and status = 'sent' and inspection_date >= current_date - least(greatest(coalesce(p_days, 365), 1), 1095);
  return jsonb_build_object(
    'inspections', coalesce((select jsonb_agg(inspection_doc(i.id, false) order by i.inspection_date) from inspection i
      where i.shop_id = p_shop and i.vehicle_id = any (v_vehicles) and i.status <> 'not_started'), '[]'),
    'vehicles', coalesce((select jsonb_agg(vehicle_doc(v)) from unnest(v_vehicles) v), '[]'),
    'followups', coalesce((select jsonb_agg(followup_doc(f)) from declined_followup f join inspection i on i.id = f.inspection_id
      where i.shop_id = p_shop and i.vehicle_id = any (v_vehicles)), '[]'));
end $$;

-- Record what the shop did about one declined part. 'contacted' counts the message and stamps the time.
create function public.set_followup(p_inspection uuid, p_key text, p_status text, p_due date, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid; f declined_followup;
begin
  select * into r from inspection where id = p_inspection;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  perform require_role(r.shop_id, array['owner','advisor']);
  if r.status <> 'sent' then raise exception 'Only work on a report the customer has seen can be followed up' using errcode = '55000'; end if;
  if p_status not in ('open','contacted','booked','dismissed') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  select id into v_comp from component_instance where vehicle_id = r.vehicle_id
    and class_id = split_part(p_key, '@', 1)::int and position is not distinct from nullif(split_part(p_key, '@', 2), '');
  if v_comp is null then raise exception 'Unknown part' using errcode = '22023'; end if;
  if exists (select 1 from customer_approval where inspection_id = p_inspection and component_id = v_comp) then
    raise exception 'The customer approved this work' using errcode = '22023';
  end if;
  insert into declined_followup as d (inspection_id, component_id, status, due_on, contacted_at, contacts, note, updated_by)
    values (p_inspection, v_comp, p_status, p_due, case when p_status = 'contacted' then now() end,
            case when p_status = 'contacted' then 1 else 0 end, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (inspection_id, component_id) do update set
      status = excluded.status, due_on = excluded.due_on, note = excluded.note, updated_by = excluded.updated_by, updated_at = now(),
      contacted_at = case when excluded.status = 'contacted' then now() else d.contacted_at end,
      contacts = d.contacts + case when excluded.status = 'contacted' then 1 else 0 end
    returning * into f;
  return followup_doc(f);
end $$;

revoke all on function public.followup_doc(public.declined_followup), public.declined_work(uuid, int),
  public.set_followup(uuid, text, text, date, text) from public, anon;
grant execute on function public.declined_work(uuid, int), public.set_followup(uuid, text, text, date, text) to authenticated;
