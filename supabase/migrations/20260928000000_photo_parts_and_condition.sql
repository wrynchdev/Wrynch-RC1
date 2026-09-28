-- Photos can show several parts (and so count for several inspection points), and the AI suggests a
-- condition for every part it sees. Replaces the one-photo-one-part placement model.
--
-- Rules are unchanged: everything the AI produces is a pending suggestion. "Looks OK" suggestions count for
-- nothing until a technician confirms them; AI photo links block submit until confirmed; AI findings stay
-- pending findings.

-- ------------------------------------------------------------------ tables
alter table public.media add column if not exists excluded boolean not null default false;
alter table public.media add column if not exists ai_analyzed_at timestamptz;

-- The parts a photo shows. A part belongs to one or more inspection points, so the photo appears in each.
create table public.media_part (
  media_id     uuid not null references public.media(id) on delete cascade,
  component_id uuid not null references public.component_instance(id),
  status       text not null check (status in ('ai_proposed','confirmed','technician_added')),
  confidence   numeric check (confidence between 0 and 1),
  created_by   uuid,                               -- null = AI
  created_at   timestamptz not null default now(),
  primary key (media_id, component_id)
);

-- Append-only record of who linked, confirmed, removed or excluded what.
create table public.media_event (
  id           bigint generated always as identity primary key,
  media_id     uuid not null references public.media(id) on delete cascade,
  component_id uuid references public.component_instance(id),
  action       text not null check (action in ('ai_linked','confirmed','added','removed','excluded','included')),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index on public.media_event (media_id, id);

-- AI "this part looks OK" suggestions. Problems are recorded as pending findings instead.
create table public.ai_observation (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspection(id) on delete cascade,
  media_id      uuid not null references public.media(id) on delete cascade,
  component_id  uuid not null references public.component_instance(id),
  verdict       text not null check (verdict = 'looks_ok'),
  note          text,
  confidence    numeric check (confidence between 0 and 1),
  status        text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (media_id, component_id)
);
create index on public.ai_observation (inspection_id);

-- Carry existing placements over from the old one-part model.
insert into public.media_part (media_id, component_id, status, confidence, created_by, created_at)
select m.id, a.component_id,
       case a.status when 'ai_proposed' then 'ai_proposed' when 'confirmed' then 'confirmed' else 'technician_added' end,
       m.ai_confidence, a.created_by, a.created_at
from public.media m cross join lateral public.current_assignment(m.id) a
where a.component_id is not null and a.status in ('ai_proposed','confirmed','reassigned','technician_assigned')
on conflict do nothing;
update public.media m set excluded = true where (public.current_assignment(m.id)).status = 'excluded';
update public.media set ai_analyzed_at = created_at where ai_component_id is not null or ai_confidence is not null;

-- ------------------------------------------------------------------ security
alter table public.media_part enable row level security;
create policy member_read on public.media_part for select to authenticated
  using (media_id in (select m.id from public.media m join public.inspection i on i.id = m.inspection_id where i.shop_id in (select public.my_shops())));
alter table public.media_event enable row level security;
create policy member_read on public.media_event for select to authenticated
  using (media_id in (select m.id from public.media m join public.inspection i on i.id = m.inspection_id where i.shop_id in (select public.my_shops())));
alter table public.ai_observation enable row level security;
create policy member_read on public.ai_observation for select to authenticated
  using (inspection_id in (select id from public.inspection where shop_id in (select public.my_shops())));
revoke insert, update, delete, truncate on public.media_part, public.media_event, public.ai_observation from anon, authenticated;
revoke all on public.media_part, public.media_event, public.ai_observation from anon;

-- ------------------------------------------------------------------ photo functions
drop function if exists public.place_photo(uuid, text, text);

-- The technician sets the full list of parts a photo shows. AI links they keep become confirmed; parts they
-- add are technician_added; parts they drop are removed, along with any pending AI suggestions about them.
create function public.set_photo_parts(p_media uuid, p_keys text[]) returns void
  language plpgsql security definer set search_path = public as
$$
declare m media; r inspection; k text; v_comp uuid; v_keep uuid[] := '{}';
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  r := editable_inspection(m.inspection_id);
  foreach k in array coalesce(p_keys, '{}') loop
    v_comp := component_for(r.vehicle_id, k);
    v_keep := v_keep || v_comp;
    if exists (select 1 from media_part where media_id = p_media and component_id = v_comp) then
      update media_part set status = 'confirmed' where media_id = p_media and component_id = v_comp and status = 'ai_proposed';
      if found then insert into media_event (media_id, component_id, action, created_by) values (p_media, v_comp, 'confirmed', auth.uid()); end if;
    else
      insert into media_part (media_id, component_id, status, created_by) values (p_media, v_comp, 'technician_added', auth.uid());
      insert into media_event (media_id, component_id, action, created_by) values (p_media, v_comp, 'added', auth.uid());
    end if;
  end loop;
  insert into media_event (media_id, component_id, action, created_by)
    select p_media, component_id, 'removed', auth.uid() from media_part where media_id = p_media and not (component_id = any (v_keep));
  delete from media_part where media_id = p_media and not (component_id = any (v_keep));
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
    where media_id = p_media and source = 'ai' and status = 'pending' and not (component_id = any (v_keep));
  update ai_observation set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where media_id = p_media and status = 'pending' and not (component_id = any (v_keep));
  if m.excluded then
    update media set excluded = false where id = p_media;
    insert into media_event (media_id, action, created_by) values (p_media, 'included', auth.uid());
  end if;
end $$;

create or replace function public.confirm_placements(p_inspection uuid, p_section text) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  perform editable_inspection(p_inspection);
  with c as (
    update media_part mp set status = 'confirmed'
      from media m where m.id = mp.media_id and m.inspection_id = p_inspection and m.section_id = p_section
        and not m.excluded and mp.status = 'ai_proposed'
      returning mp.media_id, mp.component_id)
  insert into media_event (media_id, component_id, action, created_by) select media_id, component_id, 'confirmed', auth.uid() from c;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.exclude_photo(p_media uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare m media;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  perform editable_inspection(m.inspection_id);
  update media set excluded = true where id = p_media;
  insert into media_event (media_id, action, created_by) values (p_media, 'excluded', auth.uid());
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now() where media_id = p_media and source = 'ai' and status = 'pending';
  update ai_observation set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where media_id = p_media and status = 'pending';
end $$;

-- p_items: [{id, check}] — confirm AI "looks OK" suggestions. Each confirmed one records an OK result on the
-- given check (the part's visual check), unless the part already has a result, a finding or a skip reason.
create function public.review_observations(p_inspection uuid, p_action text, p_items jsonb) returns int
  language plpgsql security definer set search_path = public as
$$
declare r inspection; it jsonb; o ai_observation; n int := 0;
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
      if not exists (select 1 from check_result where inspection_id = p_inspection and component_id = o.component_id)
         and not exists (select 1 from finding where inspection_id = p_inspection and component_id = o.component_id and status <> 'denied')
         and not exists (select 1 from component_status where inspection_id = p_inspection and component_id = o.component_id) then
        insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
          values (p_inspection, o.component_id, it ->> 'check', null, 'ok', r.rules_version_id, auth.uid());
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ AI writes (server only)
-- p_items: [{mediaId, parts: [{key, confidence, condition: 'looks_ok'|'concern'|'unclear', note,
--            findings: [{key, severity, confidence, rationale}]}]}]
-- The caller (api/ai-sort) has validated keys against the template; findings are re-checked here.
create or replace function public.ai_record_sort(p_inspection uuid, p_items jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; it jsonb; p jsonb; f jsonb; v_media uuid; v_comp uuid; v_class int;
begin
  select * into r from inspection where id = p_inspection;
  if r.status <> 'in_progress' then return; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_media := (it ->> 'mediaId')::uuid;
    -- Only photos nobody has touched and the AI hasn't already analysed.
    if not exists (select 1 from media where id = v_media and inspection_id = p_inspection and not excluded and ai_analyzed_at is null) then continue; end if;
    if exists (select 1 from media_part where media_id = v_media) then continue; end if;
    update media set ai_analyzed_at = now() where id = v_media;
    for p in select * from jsonb_array_elements(coalesce(it -> 'parts', '[]')) loop
      v_class := split_part(p ->> 'key', '@', 1)::int;
      v_comp := component_for(r.vehicle_id, p ->> 'key');
      insert into media_part (media_id, component_id, status, confidence) values (v_media, v_comp, 'ai_proposed', (p ->> 'confidence')::numeric)
        on conflict do nothing;
      insert into media_event (media_id, component_id, action) values (v_media, v_comp, 'ai_linked');
      if p ->> 'condition' = 'looks_ok' then
        insert into ai_observation (inspection_id, media_id, component_id, verdict, note, confidence)
          values (p_inspection, v_media, v_comp, 'looks_ok', left(p ->> 'note', 300), (p ->> 'confidence')::numeric)
          on conflict do nothing;
      end if;
      for f in select * from jsonb_array_elements(coalesce(p -> 'findings', '[]')) loop
        if exists (select 1 from class_finding where class_id = v_class and finding_key = f ->> 'key')
           and f ->> 'severity' in ('minor','moderate','severe','critical') then
          insert into finding (inspection_id, component_id, finding_key, severity, source, status, confidence, rationale, media_id, ai_original_key, ai_original_severity)
            values (p_inspection, v_comp, f ->> 'key', f ->> 'severity', 'ai', 'pending', (f ->> 'confidence')::numeric, left(f ->> 'rationale', 500),
                    v_media, f ->> 'key', f ->> 'severity');
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------------ submit gate (R12)
create or replace function public.submit_inspection(p_inspection uuid, p_summary jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare n_f int; n_m int; n_w int;
begin
  perform editable_inspection(p_inspection, p_statuses => array['in_progress']);
  select count(*) into n_f from finding where inspection_id = p_inspection and source = 'ai' and status = 'pending';
  -- photos not excluded that still have an unconfirmed AI link, or no parts at all
  select count(*) into n_m from media m where m.inspection_id = p_inspection and not m.excluded
    and (exists (select 1 from media_part mp where mp.media_id = m.id and mp.status = 'ai_proposed')
         or not exists (select 1 from media_part mp where mp.media_id = m.id));
  select count(*) into n_w from point_note where inspection_id = p_inspection and status = 'ai_suggested';
  if n_f + n_m + n_w > 0 then
    raise exception 'Resolve % AI findings, % photos and % wording suggestions first', n_f, n_m, n_w using errcode = '55000';
  end if;
  -- Unreviewed "looks OK" suggestions simply lapse; they never counted.
  update inspection set status = 'submitted', submitted_at = now(), summary = p_summary where id = p_inspection;
end $$;

-- ------------------------------------------------------------------ reading
create or replace function public.inspection_doc(p_id uuid, p_customer boolean) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'id', i.id, 'ro', coalesce(i.ro, ''), 'vehicleId', i.vehicle_id, 'odometer', coalesce(i.odometer, 0),
    'date', i.inspection_date, 'technician', coalesce(i.technician_name, ''), 'status', i.status, 'concerns', to_jsonb(i.concerns),
    'templateId', i.template_id, 'rulesVersionId', i.rules_version_id,
    'reportToken', case when p_customer then null else i.report_token end,
    'extraComponents', coalesce((select jsonb_agg(comp_key(x)) from unnest(i.extra_components) x), '[]'),
    'dtcs', coalesce((select jsonb_agg(jsonb_build_object('code', d.code, 'description', coalesce(d.description, ''), 'compKey', comp_key(d.component_id))) from dtc d where d.inspection_id = i.id), '[]'),
    'results', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(c.component_id), 'checkKey', c.check_key, 'value', c.value, 'rating', c.rating, 'at', c.recorded_at)) from check_result c where c.inspection_id = i.id), '[]'),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'compKey', comp_key(f.component_id), 'key', f.finding_key, 'severity', f.severity,
        'source', f.source, 'status', f.status, 'confidence', f.confidence, 'rationale', f.rationale, 'mediaId', f.media_id, 'reviewedAt', f.reviewed_at,
        'aiOriginal', case when f.ai_original_key is null then null else jsonb_build_object('key', f.ai_original_key, 'severity', f.ai_original_severity) end)
        order by f.created_at)
      from finding f where f.inspection_id = i.id
        and (not p_customer or f.source = 'technician' and f.status = 'confirmed' or f.source = 'ai' and f.status in ('confirmed','modified'))), '[]'),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sectionId', m.section_id, 'url', m.storage_path, 'label', m.label,
        'excluded', m.excluded, 'customerVisible', m.customer_visible, 'analyzed', m.ai_analyzed_at is not null,
        'links', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(mp.component_id), 'status', mp.status, 'confidence', mp.confidence) order by mp.created_at)
            from media_part mp where mp.media_id = m.id and (not p_customer or mp.status <> 'ai_proposed')), '[]'))
        order by m.created_at)
      from media m
      where m.inspection_id = i.id
        and (not p_customer or (not m.excluded and m.customer_visible
             and exists (select 1 from media_part mp where mp.media_id = m.id and mp.status <> 'ai_proposed')))), '[]'),
    'observations', case when p_customer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'mediaId', o.media_id,
        'compKey', comp_key(o.component_id), 'verdict', o.verdict, 'note', o.note, 'confidence', o.confidence, 'status', o.status) order by o.created_at)
      from ai_observation o where o.inspection_id = i.id), '[]') end,
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(s.component_id), 'notInspected', jsonb_build_object('kind', s.kind, 'reason', s.reason), 'override', null))
      from component_status s where s.inspection_id = i.id), '[]'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('pointId', n.point_id,
        'techText', case when p_customer then '' else n.tech_text end,
        'aiText', case when p_customer then null else n.ai_text end,
        'status', n.status, 'customerText', n.customer_text))
      from point_note n where n.inspection_id = i.id and (not p_customer or (n.customer_text is not null and n.status <> 'ai_suggested'))), '[]'),
    'estimate', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'compKey', comp_key(e.component_id), 'description', e.description, 'parts', e.parts, 'labor', e.labor) order by e.created_at)
      from estimate_line e where e.inspection_id = i.id), '[]'),
    'customerApprovals', coalesce((select jsonb_agg(comp_key(ca.component_id)) from customer_approval ca where ca.inspection_id = i.id), '[]')
  ) from inspection i where i.id = p_id
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public.set_photo_parts(uuid, text[]), public.review_observations(uuid, text, jsonb) from public, anon;
grant execute on function public.set_photo_parts(uuid, text[]), public.review_observations(uuid, text, jsonb) to authenticated;
-- Replaced functions keep their grants; make sure the internal ones stay closed.
revoke execute on function public.inspection_doc(uuid, boolean), public.ai_record_sort(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_record_sort(uuid, jsonb) to service_role;
