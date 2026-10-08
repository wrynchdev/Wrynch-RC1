-- Findings belong to the check that found them, and the service advisor approves every report note.
--
-- 1. A finding can name the check it explains (finding.check_key). A technician picks findings under a check only when
--    that check is rated Monitor or Immediate; the check's rating is what counts, the findings say why. Rating the
--    check OK, clearing it or marking the part not inspected removes its findings.
-- 2. Confirming an AI finding files it under the part's visual condition check and rates that check (never better than
--    it already was), so it reads the same as a finding the technician picked.
-- 3. Every inspection point gets a note: the technician's, or an AI summary of the point's findings. Nothing is sent
--    until the service advisor has approved (or rewritten) every point's note. The technician no longer approves wording.

-- ------------------------------------------------------------------ 1. findings under checks
alter table public.finding add column check_key text references public.condition_check(key);

-- Only a check rated Monitor or Immediate keeps findings.
create function public.drop_check_findings() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_insp uuid; v_comp uuid; v_check text;
begin
  if tg_op = 'DELETE' then
    v_insp := old.inspection_id; v_comp := old.component_id; v_check := old.check_key;
  elsif new.rating = 'ok' then
    v_insp := new.inspection_id; v_comp := new.component_id; v_check := new.check_key;
  else
    return new;
  end if;
  delete from finding where inspection_id = v_insp and component_id = v_comp and check_key = v_check and source = 'technician';
  -- An AI finding is kept as a record, marked as overruled by the technician.
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
   where inspection_id = v_insp and component_id = v_comp and check_key = v_check and source = 'ai' and status in ('confirmed', 'modified');
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger check_result_drops_findings after insert or update of rating or delete on public.check_result
  for each row execute function public.drop_check_findings();

-- Set the findings that explain a check's Monitor or Immediate rating (replaces the technician's earlier picks).
create function public.set_check_findings(p_inspection uuid, p_key text, p_check text, p_findings text[]) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid; v_rating text; v_class int := split_part(p_key, '@', 1)::int; bad text;
begin
  r := editable_inspection(p_inspection);
  v_comp := component_for(r.vehicle_id, p_key);
  if not exists (select 1 from condition_check where key = p_check and class_id = v_class) then
    raise exception 'Check % doesn''t apply to this part', p_check using errcode = '22023';
  end if;
  select rating into v_rating from check_result where inspection_id = p_inspection and component_id = v_comp and check_key = p_check;
  if coalesce(v_rating, 'ok') = 'ok' then
    raise exception 'Rate the check Monitor or Immediate before adding findings' using errcode = '22023';
  end if;
  select string_agg(x, ', ') into bad from unnest(coalesce(p_findings, '{}')) x
   where not exists (select 1 from class_finding where class_id = v_class and finding_key = x);
  if bad is not null then raise exception 'Findings not used for this part: %', bad using errcode = '22023'; end if;
  delete from finding where inspection_id = p_inspection and component_id = v_comp and check_key = p_check and source = 'technician';
  insert into finding (inspection_id, component_id, check_key, finding_key, severity, source, status, reviewed_by, reviewed_at)
    select p_inspection, v_comp, p_check, x, case v_rating when 'immediate' then 'severe' else 'moderate' end, 'technician', 'confirmed', auth.uid(), now()
      from (select distinct unnest(coalesce(p_findings, '{}')) x) s;
end $$;

-- ------------------------------------------------------------------ 2. confirmed AI findings go under the visual check
create function public.file_ai_finding() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_class int; v_check text; v_rating text;
begin
  if new.source <> 'ai' or new.status not in ('confirmed', 'modified') or new.check_key is not null then return new; end if;
  select * into r from inspection where id = new.inspection_id;
  select class_id into v_class from component_instance where id = new.component_id;
  select key into v_check from condition_check
   where class_id = v_class and value_type = 'visual' and not template_check_off(r.template_id, key)
   order by key limit 1;
  select ratings[array_position(array['minor','moderate','severe','critical'], new.severity)] into v_rating
    from class_finding where class_id = v_class and finding_key = new.finding_key;
  if v_check is null or v_rating is null or v_rating = 'ok' then return new; end if;  -- stays a part-level finding
  new.check_key := v_check;
  insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
    values (new.inspection_id, new.component_id, v_check, null, v_rating, r.rules_version_id, auth.uid())
    on conflict (inspection_id, component_id, check_key) do update
      set rating = case when check_result.rating = 'immediate' or excluded.rating = 'immediate' then 'immediate' else 'monitor' end,
          recorded_by = excluded.recorded_by, recorded_at = now();
  delete from component_status where inspection_id = new.inspection_id and component_id = new.component_id;
  return new;
end $$;
create trigger finding_files_ai_confirm before update of status on public.finding
  for each row when (new.source = 'ai' and new.status in ('confirmed', 'modified') and old.status = 'pending')
  execute function public.file_ai_finding();

-- ------------------------------------------------------------------ 3. advisor-approved notes
alter table public.point_note add column approved_by uuid, add column approved_at timestamptz;

-- Notes already on submitted or sent reports were approved under the old flow (by the technician).
update public.point_note n set approved_at = n.updated_at
  from public.inspection i
 where i.id = n.inspection_id and i.status in ('submitted', 'sent')
   and n.status <> 'ai_suggested' and coalesce(trim(n.customer_text), '') <> '';

-- Any new technician text or new AI wording needs the advisor's approval again.
create function public.note_needs_approval() returns trigger
  language plpgsql as
$$
begin
  if new.tech_text is distinct from old.tech_text or new.ai_text is distinct from old.ai_text then
    new.approved_at := null; new.approved_by := null;
  end if;
  return new;
end $$;
create trigger point_note_needs_approval before update on public.point_note
  for each row execute function public.note_needs_approval();

-- The service advisor approves the note the customer will read for one point, as suggested or rewritten.
create function public.approve_note(p_inspection uuid, p_point text, p_text text) returns void
  language plpgsql security definer set search_path = public as
$$
declare n point_note; v_text text := trim(coalesce(p_text, ''));
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['submitted','sent'], false);
  if v_text = '' then raise exception 'A report note can''t be blank' using errcode = '22023'; end if;
  select * into n from point_note where inspection_id = p_inspection and point_id = p_point for update;
  if not found then
    insert into point_note (inspection_id, point_id, tech_text, customer_text, status, approved_by, approved_at)
      values (p_inspection, p_point, '', v_text, 'technician_original', auth.uid(), now());
    return;
  end if;
  update point_note set
    customer_text = v_text,
    status = case when n.status = 'ai_suggested' then case when v_text = trim(coalesce(n.ai_text, '')) then 'ai_accepted' else 'ai_edited' end
                  else n.status end,
    approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where inspection_id = p_inspection and point_id = p_point;
end $$;

-- How many report notes still need the advisor: unapproved or blank notes, and points listed when the technician
-- submitted that have no approved note at all.
create function public.notes_waiting(p_inspection uuid) returns int
  language sql stable security definer set search_path = public as
$$
  select count(*)::int from (
    select n.point_id from point_note n
     where n.inspection_id = p_inspection and (n.approved_at is null or coalesce(trim(n.customer_text), '') = '')
    union
    select p from inspection i, jsonb_array_elements_text(coalesce(i.summary -> 'points', '[]'::jsonb)) p
     where i.id = p_inspection
       and not exists (select 1 from point_note n where n.inspection_id = i.id and n.point_id = p and n.approved_at is not null)
  ) waiting;
$$;

-- AI wording can be written after the technician submits (for the advisor to approve), but never over an approved note.
create or replace function public.ai_record_wording(p_inspection uuid, p_point text, p_text text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if (select status from inspection where id = p_inspection) not in ('in_progress', 'submitted') then return; end if;
  insert into point_note (inspection_id, point_id, tech_text, ai_text, status, customer_text)
  values (p_inspection, p_point, '', p_text, 'ai_suggested', null)
  on conflict (inspection_id, point_id) do update set ai_text = excluded.ai_text, status = 'ai_suggested', updated_at = now()
    where point_note.approved_at is null;
end $$;

-- The technician's submit no longer waits on wording; the advisor approves notes before sending.
create or replace function public.submit_inspection(p_inspection uuid, p_summary jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare n_f int; n_m int;
begin
  perform editable_inspection(p_inspection, p_statuses => array['in_progress']);
  select count(*) into n_f from finding where inspection_id = p_inspection and source = 'ai' and status = 'pending';
  select count(*) into n_m from media m where m.inspection_id = p_inspection and not m.excluded
    and (exists (select 1 from media_part mp where mp.media_id = m.id and mp.status = 'ai_proposed')
         or not exists (select 1 from media_part mp where mp.media_id = m.id));
  if n_f + n_m > 0 then
    raise exception 'Resolve % AI findings and % photos first', n_f, n_m using errcode = '55000';
  end if;
  update inspection set status = 'submitted', submitted_at = now(), summary = p_summary where id = p_inspection;
end $$;

-- Sending needs every report note approved.
create or replace function public.mark_sent(p_inspection uuid, p_channel text, p_destination text, p_status text, p_detail text) returns void
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  perform editable_inspection(p_inspection, array['owner','advisor'], array['submitted','sent']);
  n := notes_waiting(p_inspection);
  if n > 0 then raise exception 'Approve the report notes first (% waiting)', n using errcode = '55000'; end if;
  insert into delivery (inspection_id, channel, destination, status, detail, created_by) values (p_inspection, p_channel, p_destination, p_status, p_detail, auth.uid());
  if p_status <> 'failed' then update inspection set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_inspection; end if;
end $$;

-- The inspection document: findings carry their check; notes say whether the advisor approved them, and the
-- customer's copy only has approved notes.
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
        'status', n.status, 'customerText', n.customer_text, 'approved', n.approved_at is not null))
      from point_note n where n.inspection_id = i.id
        and (not p_customer or (n.approved_at is not null and coalesce(trim(n.customer_text), '') <> ''))), '[]'),
    'estimate', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'compKey', comp_key(e.component_id), 'description', e.description, 'parts', e.parts, 'labor', e.labor) order by e.created_at)
      from estimate_line e where e.inspection_id = i.id), '[]'),
    'customerApprovals', coalesce((select jsonb_agg(comp_key(ca.component_id)) from customer_approval ca where ca.inspection_id = i.id), '[]')
  ) from inspection i where i.id = p_id
$$;

revoke all on function public.drop_check_findings(), public.file_ai_finding(), public.note_needs_approval() from public, anon, authenticated;
revoke all on function public.set_check_findings(uuid, text, text, text[]), public.approve_note(uuid, text, text), public.notes_waiting(uuid) from public, anon;
grant execute on function public.set_check_findings(uuid, text, text, text[]), public.approve_note(uuid, text, text) to authenticated;
-- notes_waiting reads by inspection id alone, so only the server (send-report) and the other functions call it.
revoke all on function public.notes_waiting(uuid) from authenticated;
grant execute on function public.notes_waiting(uuid) to service_role;
revoke all on function public.ai_record_wording(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_record_wording(uuid, text, text) to service_role;
revoke execute on function public.inspection_doc(uuid, boolean) from public, anon, authenticated;
