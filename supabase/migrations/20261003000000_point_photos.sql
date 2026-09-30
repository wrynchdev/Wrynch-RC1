-- Photos taken from one inspection point: the point is kept on the photo, and AI sorting then only considers
-- that point's parts (instead of every part in the stage).

alter table public.media add column shot_point_id text;

create function public.add_point_media(p_inspection uuid, p_media uuid, p_section text, p_point text, p_path text, p_label text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform public.add_media(p_inspection, p_media, p_section, p_path, p_label);
  update media set shot_point_id = nullif(trim(p_point), '') where id = p_media;
end $$;
revoke all on function public.add_point_media(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.add_point_media(uuid, uuid, text, text, text, text) to authenticated;

-- The inspection document now says which point a photo was taken from.
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
        'excluded', m.excluded, 'customerVisible', m.customer_visible, 'analyzed', m.ai_analyzed_at is not null, 'pointId', m.shot_point_id,
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
