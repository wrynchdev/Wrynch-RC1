-- Wrynch admin panel: what Wrynch staff (platform_admin) see across every shop. Pilot applications can now be
-- reviewed, approved and declined in the app instead of the SQL editor. Nobody else can read any of it.
-- To make someone staff: insert into public.platform_admin (user_id) values ('<auth user id>');

alter table public.pilot_request add column admin_note text check (length(admin_note) <= 2000);
alter table public.pilot_request add column decided_by uuid;
alter table public.pilot_request add column decided_at timestamptz;
alter table public.pilot_request add column link_emailed_at timestamptz;

create function public.pilot_request_doc(r public.pilot_request) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'id', r.id, 'shopName', r.shop_name, 'contactName', r.contact_name, 'email', r.email, 'phone', r.phone,
    'location', r.location, 'techs', r.techs, 'currentTool', r.current_tool, 'notes', r.notes,
    'templatePoints', case when r.template is null then null
      else coalesce(jsonb_array_length(case when jsonb_typeof(r.template -> 'points') = 'array' then r.template -> 'points' end), 0) end,
    'status', r.status, 'createdAt', r.created_at, 'approvedAt', r.approved_at, 'decidedAt', r.decided_at,
    'linkEmailedAt', r.link_emailed_at, 'adminNote', r.admin_note,
    -- The one-time sign-up token, only while the link can still be used.
    'token', case when r.status = 'approved' then r.token end,
    'linkExpiresAt', case when r.status = 'approved' then r.approved_at + interval '30 days' end,
    'usedAt', r.used_at,
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'number', s.number) from shop_member m join shop s on s.id = m.shop_id
              where m.user_id = r.used_by and m.role = 'owner' and r.used_by is not null order by s.created_at limit 1));
$$;

-- Staff: every pilot application, newest first, with counts by status.
create function public.admin_pilot_requests() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(pilot_request_doc(r) order by r.created_at desc) from pilot_request r), '[]'),
    'counts', (select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'), 'approved', count(*) filter (where status = 'approved'),
      'used', count(*) filter (where status = 'used'), 'declined', count(*) filter (where status = 'declined'),
      'total', count(*)) from pilot_request));
end $$;

-- Staff: approve (makes the one-time sign-up link), decline, or put back to pending. A used application can't change.
create function public.admin_set_pilot_status(p_id uuid, p_status text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r pilot_request;
begin
  perform require_platform_admin();
  if p_status not in ('pending', 'approved', 'declined') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  select * into r from pilot_request where id = p_id for update;
  if not found then raise exception 'No application with that id' using errcode = 'P0002'; end if;
  if r.status = 'used' then raise exception 'This shop has already signed up' using errcode = '55000'; end if;
  update pilot_request set status = p_status, decided_by = auth.uid(), decided_at = now(),
    approved_at = case when p_status = 'approved' then coalesce(case when r.status = 'approved' then approved_at end, now()) else approved_at end,
    token = case when p_status = 'approved' then coalesce(token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) else token end
   where id = p_id returning * into r;
  return pilot_request_doc(r);
end $$;

-- Staff: a private note on an application (who called them, what they said).
create function public.admin_set_pilot_note(p_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r pilot_request;
begin
  perform require_platform_admin();
  update pilot_request set admin_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id returning * into r;
  if not found then raise exception 'No application with that id' using errcode = 'P0002'; end if;
  return pilot_request_doc(r);
end $$;

-- Staff (through the server, which sends the email): record that the sign-up link was emailed.
create function public.admin_mark_pilot_emailed(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  update pilot_request set link_emailed_at = now() where id = p_id and status = 'approved';
end $$;

-- Staff: every shop with its size and activity.
create function public.admin_shops() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  return coalesce((select jsonb_agg(x order by x ->> 'createdAt' desc) from (
    select jsonb_build_object('id', s.id, 'name', s.name, 'number', s.number, 'createdAt', s.created_at,
      'owner', (select display_name from shop_member where shop_id = s.id and role = 'owner' order by created_at limit 1),
      'members', (select count(*) from shop_member where shop_id = s.id),
      'inspections', (select count(*) from inspection where shop_id = s.id),
      'last30', (select count(*) from inspection where shop_id = s.id and created_at > now() - interval '30 days'),
      'sent', (select count(*) from inspection where shop_id = s.id and status = 'sent'),
      'lastActivity', (select max(created_at) from inspection where shop_id = s.id)) x
    from shop s) q), '[]');
end $$;

revoke all on function public.pilot_request_doc(public.pilot_request), public.admin_pilot_requests(), public.admin_set_pilot_status(uuid, text),
  public.admin_set_pilot_note(uuid, text), public.admin_mark_pilot_emailed(uuid), public.admin_shops() from public, anon;
grant execute on function public.admin_pilot_requests(), public.admin_set_pilot_status(uuid, text), public.admin_set_pilot_note(uuid, text),
  public.admin_mark_pilot_emailed(uuid), public.admin_shops() to authenticated;
