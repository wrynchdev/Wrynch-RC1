-- Inspection timing: when an inspection starts (first change, status not started -> in progress) and when it's
-- first sent to the advisor. The time between is the inspection time; technicians' profiles show how many they've
-- finished and their average. Inspections left open more than 8 hours (overnight, waiting on parts) are counted
-- but left out of the average.

alter table public.inspection add column started_at timestamptz, add column first_submitted_at timestamptz;

create function public.inspection_timing() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'submitted' and new.first_submitted_at is null then new.first_submitted_at := coalesce(new.submitted_at, now()); end if;
  return new;
end $$;
create trigger inspection_timing before insert or update of status on public.inspection
  for each row execute function public.inspection_timing();

-- Inspections already submitted keep what we know: submitted time only (no start), so they don't count toward averages.
update public.inspection set first_submitted_at = submitted_at where first_submitted_at is null and submitted_at is not null;

-- Members: inspection counts and times per technician. Technicians see only themselves; owners and advisors see everyone.
create function public.technician_stats(p_shop uuid, p_user uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from shop_member where shop_id = p_shop and user_id = auth.uid();
  if v_role is null then raise exception 'You don''t have permission to do that in this shop' using errcode = '42501'; end if;
  if v_role = 'technician' and p_user is not null and p_user <> auth.uid() then
    raise exception 'You don''t have permission to do that in this shop' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', m.user_id, 'name', coalesce(m.display_name, ''), 'role', m.role,
      'inspections', (select count(*) from inspection i where i.shop_id = p_shop and i.technician_id = m.user_id and i.first_submitted_at is not null),
      'last30', (select count(*) from inspection i where i.shop_id = p_shop and i.technician_id = m.user_id and i.first_submitted_at >= now() - interval '30 days'),
      'timed', (select count(*) from inspection i where i.shop_id = p_shop and i.technician_id = m.user_id and i.started_at is not null
                 and i.first_submitted_at - i.started_at between interval '1 minute' and interval '8 hours'),
      'avgSeconds', (select round(avg(extract(epoch from i.first_submitted_at - i.started_at))) from inspection i
                      where i.shop_id = p_shop and i.technician_id = m.user_id and i.started_at is not null
                        and i.first_submitted_at - i.started_at between interval '1 minute' and interval '8 hours'),
      'inProgress', (select count(*) from inspection i where i.shop_id = p_shop and i.technician_id = m.user_id and i.status = 'in_progress'),
      'recent', coalesce((select jsonb_agg(r order by r ->> 'submittedAt' desc) from (
          select jsonb_build_object('id', i.id, 'ro', coalesce(i.ro, ''), 'vehicle', trim(concat_ws(' ', v.year, v.make, v.model)),
                   'startedAt', i.started_at, 'submittedAt', i.first_submitted_at,
                   'seconds', case when i.started_at is not null then round(extract(epoch from i.first_submitted_at - i.started_at)) end) as r
            from inspection i join vehicle v on v.id = i.vehicle_id
           where i.shop_id = p_shop and i.technician_id = m.user_id and i.first_submitted_at is not null
           order by i.first_submitted_at desc limit 10) x), '[]'::jsonb)
    ) order by m.created_at)
    from shop_member m
    where m.shop_id = p_shop
      and (p_user is null or m.user_id = p_user)
      and (v_role <> 'technician' or m.user_id = auth.uid())), '[]'::jsonb);
end $$;
revoke all on function public.technician_stats(uuid, uuid) from public, anon;
grant execute on function public.technician_stats(uuid, uuid) to authenticated;

-- The inspection document carries the start and first-submit times (not in the customer's copy).
create or replace function public.inspection_doc(p_id uuid, p_customer boolean) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'id', i.id, 'ro', coalesce(i.ro, ''), 'vehicleId', i.vehicle_id, 'odometer', coalesce(i.odometer, 0),
    'date', i.inspection_date, 'technician', coalesce(i.technician_name, ''), 'status', i.status, 'concerns', to_jsonb(i.concerns),
    'startedAt', case when p_customer then null else i.started_at end, 'firstSubmittedAt', case when p_customer then null else i.first_submitted_at end,
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
        'excluded', m.excluded, 'customerVisible', m.customer_visible, 'analyzed', m.ai_analyzed_at is not null, 'pointId', m.shot_point_id, 'corner', m.shot_corner,
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
