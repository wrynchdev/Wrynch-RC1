-- Security hardening from the codebase audit (2026-10-11).
--
-- 1. Sending a report is for owners and advisors: assert_report_sender lets the server check the role before a text or
--    email goes out (mark_sent checked it only afterwards, when the customer already had the link).
-- 2. The customer's copy of an inspection leaves out what the AI thought: confidence, rationale and the AI's original
--    suggestion. The customer sees the confirmed finding only.
-- 3. A customer can approve only parts the report recommends (rated Monitor or Immediate). Taking an approval back is
--    always allowed.
-- 4. Internal helpers are no longer callable by signed-in users (they were revoked from anon only).
-- 5. A daily cap on the public, signed-out AI features (reading a shop's inspection sheet on the marketing site), shared
--    by every server instance, so a script can't run up Wrynch's AI bill.
-- 6. The photo bucket only takes images, up to 20 MB each.

-- ------------------------------------------------------------------ 1. who can send a report
create function public.assert_report_sender(p_inspection uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['submitted','sent'], false);
end $$;
revoke all on function public.assert_report_sender(uuid) from public, anon;
grant execute on function public.assert_report_sender(uuid) to authenticated;

-- ------------------------------------------------------------------ 2. the customer's copy
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
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'compKey', comp_key(f.component_id), 'checkKey', f.check_key, 'key', f.finding_key, 'severity', f.severity,
        'source', f.source, 'status', f.status,
        'confidence', case when p_customer then null else f.confidence end, 'rationale', case when p_customer then null else f.rationale end,
        'mediaId', f.media_id, 'reviewedAt', f.reviewed_at,
        'aiOriginal', case when p_customer or f.ai_original_key is null then null else jsonb_build_object('key', f.ai_original_key, 'severity', f.ai_original_severity) end)
        order by f.created_at)
      from finding f where f.inspection_id = i.id
        and (not p_customer or f.source = 'technician' and f.status = 'confirmed' or f.source = 'ai' and f.status in ('confirmed','modified'))), '[]'),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sectionId', m.section_id, 'url', m.storage_path, 'label', m.label,
        'excluded', m.excluded, 'customerVisible', m.customer_visible, 'analyzed', m.ai_analyzed_at is not null, 'pointId', m.shot_point_id, 'corner', m.shot_corner,
        'links', coalesce((select jsonb_agg(jsonb_build_object('compKey', comp_key(mp.component_id), 'status', mp.status, 'confidence', case when p_customer then null else mp.confidence end) order by mp.created_at)
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
        'status', n.status, 'customerText', n.customer_text, 'approved', n.approved_at is not null))
      from point_note n where n.inspection_id = i.id
        and (not p_customer or (n.approved_at is not null and coalesce(trim(n.customer_text), '') <> ''))), '[]'),
    'estimate', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'compKey', comp_key(e.component_id), 'description', e.description, 'parts', e.parts, 'labor', e.labor) order by e.created_at)
      from estimate_line e where e.inspection_id = i.id), '[]'),
    'customerApprovals', coalesce((select jsonb_agg(comp_key(ca.component_id)) from customer_approval ca where ca.inspection_id = i.id), '[]')
  ) from inspection i where i.id = p_id
$$;
revoke execute on function public.inspection_doc(uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. customer approvals
create or replace function public.customer_set_approval(p_token text, p_key text, p_approved boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid;
begin
  select * into r from inspection where report_token = p_token and status = 'sent';
  if not found then raise exception 'This report link isn''t valid' using errcode = 'P0002'; end if;
  select id into v_comp from component_instance where vehicle_id = r.vehicle_id
    and class_id = split_part(p_key, '@', 1)::int and position is not distinct from nullif(split_part(p_key, '@', 2), '');
  if v_comp is null then raise exception 'Unknown part' using errcode = '22023'; end if;
  if p_approved then
    if not exists (select 1 from check_result where inspection_id = r.id and component_id = v_comp and rating in ('monitor', 'immediate')) then
      raise exception 'This report doesn''t recommend work on that part' using errcode = '22023';
    end if;
    insert into customer_approval (inspection_id, component_id) values (r.id, v_comp) on conflict do nothing;
  else
    delete from customer_approval where inspection_id = r.id and component_id = v_comp;
  end if;
end $$;
revoke all on function public.customer_set_approval(text, text, boolean) from public, anon, authenticated;
grant execute on function public.customer_set_approval(text, text, boolean) to service_role;

-- ------------------------------------------------------------------ 4. internal helpers
revoke all on function public.template_check_off(uuid, text), public.usable_check_in(uuid, int, text), public.default_template(uuid),
  public.template_for(uuid, uuid), public.followup_doc(public.declined_followup), public.pilot_request_doc(public.pilot_request),
  public.training_eligible(uuid), public.inspection_timing() from public, anon, authenticated;
do $$ begin
  -- Added by catalog 1.4.0; revoke it too when that release is already in.
  if to_regprocedure('public.noted_at_ok(int, text, text)') is not null then
    execute 'revoke all on function public.noted_at_ok(int, text, text) from public, anon, authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------ 5. public AI cap
create table public.public_ai_usage (
  day    date not null default current_date,
  bucket text not null,
  calls  int  not null default 0,
  primary key (day, bucket)
);
alter table public.public_ai_usage enable row level security;
revoke all on public.public_ai_usage from public, anon, authenticated;

-- Count one AI call in a bucket for today; false once today's cap is reached (the call should not be made).
create function public.take_public_ai_call(p_bucket text, p_max int) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  insert into public_ai_usage (day, bucket, calls) values (current_date, p_bucket, 1)
    on conflict (day, bucket) do update set calls = public_ai_usage.calls + 1
    returning calls into n;
  return n <= p_max;
end $$;
revoke all on function public.take_public_ai_call(text, int) from public, anon, authenticated;
grant execute on function public.take_public_ai_call(text, int) to service_role;

-- ------------------------------------------------------------------ 6. photo bucket limits
do $$ begin
  -- Supabase's storage.buckets has these columns; the plain-PostgreSQL test shim doesn't.
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set file_size_limit = 20971520,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
      where id = 'inspection-media'$q$;
  end if;
end $$;
