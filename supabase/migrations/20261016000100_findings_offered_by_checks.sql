-- Catalog 1.4.0: each check lists the findings it offers (condition_check.fail_findings, loaded by the release
-- migration before this one), and every finding a part can have is offered by at least one of its checks.
--
-- 1. A technician's findings under a check must be ones that check offers. Findings already on the check stay valid,
--    so an inspection started on the older catalog can still be edited.
-- 2. A visual check rated OK can keep "noted" findings: cosmetic ones the part rates OK at minor severity, such as an
--    existing dent before work starts. They are recorded at minor severity, stay in the history and the report, and
--    don't change the rating. Rating the check OK keeps them; clearing it or skipping the part removes them.
-- 3. A confirmed AI finding is filed under the first check of the part (catalog order) that offers it and is on in
--    the inspection's template; before, it went under the first visual check by key, even one that didn't offer it.
--    A cosmetic finding rated OK is noted under that check (rated OK if nobody had rated it).

-- Whether a finding at this severity can stay under a check rated OK.
create function public.noted_at_ok(p_class int, p_finding text, p_severity text) returns boolean
  language sql stable security definer set search_path = public as
$$
  select p_severity = 'minor'
     and coalesce((select ratings[1] = 'ok' from class_finding where class_id = p_class and finding_key = p_finding), false);
$$;

-- ------------------------------------------------------------------ 1 + 2. technician findings under a check
create or replace function public.set_check_findings(p_inspection uuid, p_key text, p_check text, p_findings text[]) returns void
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_comp uuid; v_rating text; v_class int := split_part(p_key, '@', 1)::int; c condition_check; bad text;
begin
  r := editable_inspection(p_inspection);
  v_comp := component_for(r.vehicle_id, p_key);
  select * into c from condition_check where key = p_check and class_id = v_class;
  if not found then
    raise exception 'Check % doesn''t apply to this part', p_check using errcode = '22023';
  end if;
  select rating into v_rating from check_result where inspection_id = p_inspection and component_id = v_comp and check_key = p_check;
  if v_rating is null or (v_rating = 'ok' and c.value_type <> 'visual') then
    raise exception 'Rate the check Monitor or Immediate before adding findings' using errcode = '22023';
  end if;
  select string_agg(x, ', ') into bad from unnest(coalesce(p_findings, '{}')) x
   where not exists (select 1 from class_finding where class_id = v_class and finding_key = x);
  if bad is not null then raise exception 'Findings not used for this part: %', bad using errcode = '22023'; end if;
  select string_agg(x, ', ') into bad from unnest(coalesce(p_findings, '{}')) x
   where not (x = any(c.fail_findings))
     and not exists (select 1 from finding f where f.inspection_id = p_inspection and f.component_id = v_comp
                      and f.check_key = p_check and f.finding_key = x and f.status <> 'denied');
  if bad is not null then raise exception 'Findings this check doesn''t offer: %', bad using errcode = '22023'; end if;
  if v_rating = 'ok' then
    select string_agg(x, ', ') into bad from unnest(coalesce(p_findings, '{}')) x where not noted_at_ok(v_class, x, 'minor');
    if bad is not null then
      raise exception 'Only cosmetic findings can be noted on a check rated OK: %', bad using errcode = '22023';
    end if;
  end if;
  delete from finding where inspection_id = p_inspection and component_id = v_comp and check_key = p_check and source = 'technician';
  insert into finding (inspection_id, component_id, check_key, finding_key, severity, source, status, reviewed_by, reviewed_at)
    select p_inspection, v_comp, p_check, x, case v_rating when 'immediate' then 'severe' when 'monitor' then 'moderate' else 'minor' end,
           'technician', 'confirmed', auth.uid(), now()
      from (select distinct unnest(coalesce(p_findings, '{}')) x) s;
end $$;

-- A check rated OK keeps only its noted findings; a check cleared (or a part skipped) keeps none.
create or replace function public.drop_check_findings() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_insp uuid; v_comp uuid; v_check text; v_keep boolean := false; v_class int;
begin
  if tg_op = 'DELETE' then
    v_insp := old.inspection_id; v_comp := old.component_id; v_check := old.check_key;
  elsif new.rating = 'ok' then
    v_insp := new.inspection_id; v_comp := new.component_id; v_check := new.check_key; v_keep := true;
  else
    return new;
  end if;
  select class_id into v_class from component_instance where id = v_comp;
  delete from finding
   where inspection_id = v_insp and component_id = v_comp and check_key = v_check and source = 'technician'
     and not (v_keep and noted_at_ok(v_class, finding_key, severity));
  -- An AI finding is kept as a record, marked as overruled by the technician.
  update finding set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
   where inspection_id = v_insp and component_id = v_comp and check_key = v_check and source = 'ai' and status in ('confirmed', 'modified')
     and not (v_keep and noted_at_ok(v_class, finding_key, severity));
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ------------------------------------------------------------------ 3. confirmed AI findings
create or replace function public.file_ai_finding() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare r inspection; v_class int; v_check text; v_type text; v_rating text;
begin
  if new.source <> 'ai' or new.status not in ('confirmed', 'modified') or new.check_key is not null then return new; end if;
  select * into r from inspection where id = new.inspection_id;
  select class_id into v_class from component_instance where id = new.component_id;
  select ratings[array_position(array['minor','moderate','severe','critical'], new.severity)] into v_rating
    from class_finding where class_id = v_class and finding_key = new.finding_key;
  if v_rating is null then return new; end if;  -- not a finding this part can have: stays part-level
  select key, value_type into v_check, v_type from condition_check
   where class_id = v_class and new.finding_key = any(fail_findings) and not template_check_off(r.template_id, key)
   order by sort_order, key limit 1;
  if v_check is null then return new; end if;  -- no check that is on offers it: stays part-level and rates the part
  if v_rating = 'ok' then
    if v_type <> 'visual' then return new; end if;
    new.check_key := v_check;
    insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
      values (new.inspection_id, new.component_id, v_check, null, 'ok', r.rules_version_id, auth.uid())
      on conflict (inspection_id, component_id, check_key) do nothing;
    delete from component_status where inspection_id = new.inspection_id and component_id = new.component_id;
    return new;
  end if;
  new.check_key := v_check;
  insert into check_result (inspection_id, component_id, check_key, value, rating, rules_version_id, recorded_by)
    values (new.inspection_id, new.component_id, v_check, null, v_rating, r.rules_version_id, auth.uid())
    on conflict (inspection_id, component_id, check_key) do update
      set rating = case when check_result.rating = 'immediate' or excluded.rating = 'immediate' then 'immediate' else 'monitor' end,
          recorded_by = excluded.recorded_by, recorded_at = now();
  delete from component_status where inspection_id = new.inspection_id and component_id = new.component_id;
  return new;
end $$;

revoke all on function public.noted_at_ok(int, text, text) from public, anon;
grant execute on function public.set_check_findings(uuid, text, text, text[]) to authenticated;
