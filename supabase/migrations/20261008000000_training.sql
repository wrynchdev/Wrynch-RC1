-- Training data for a part-detection model.
-- Shops opt in (owner switch, off by default). Wrynch staff ("platform admins", added by hand in the database)
-- draw boxes around the parts technicians already confirmed on those shops' photos, and export the approved
-- boxes for training. Only technician-confirmed photos from opted-in shops are ever offered for labeling.

create table public.platform_admin (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.platform_admin enable row level security;
revoke all on public.platform_admin from anon, authenticated;

create function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from platform_admin where user_id = auth.uid()) $$;

create function public.require_platform_admin() returns void
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_platform_admin() then raise exception 'Only Wrynch staff can do that' using errcode = '42501'; end if;
end $$;

alter table public.shop add column share_training boolean not null default false;

-- Owners: share (or stop sharing) the shop's confirmed photos for training. Members can read the setting.
create function public.set_share_training(p_shop uuid, p_on boolean) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  update shop set share_training = coalesce(p_on, false) where id = p_shop;
end $$;

create function public.shop_training_info(p_shop uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('shared', s.share_training, 'admin', public.is_platform_admin())
    from shop s where s.id = p_shop and s.id in (select public.my_shops());
$$;

create table public.training_label (
  media_id   uuid primary key references public.media(id) on delete cascade,
  status     text not null check (status in ('approved', 'skipped')),
  boxes      jsonb not null default '[]'::jsonb check (jsonb_typeof(boxes) = 'array'),
  width      integer check (width > 0),
  height     integer check (height > 0),
  labeled_by uuid,
  labeled_at timestamptz not null default now()
);
alter table public.training_label enable row level security;
revoke all on public.training_label from anon, authenticated;

-- A photo can be labeled when its shop shares training data, it isn't excluded, and a technician confirmed parts on it.
create function public.training_eligible(p_media uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from media m join inspection i on i.id = m.inspection_id join shop s on s.id = i.shop_id
     where m.id = p_media and s.share_training and not m.excluded
       and exists (select 1 from media_part mp where mp.media_id = m.id and mp.status in ('confirmed', 'technician_added')));
$$;

-- Admins: the next photos to label (oldest first), with their confirmed parts.
create function public.training_queue(p_limit int default 20) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('mediaId', q.id, 'path', q.storage_path, 'shop', q.number, 'vehicle', q.vehicle, 'stage', q.section_id,
             'parts', q.parts) order by q.created_at)
    from (
      select m.id, m.storage_path, m.created_at, m.section_id, s.number,
             trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle,
             (select jsonb_agg(comp_key(mp.component_id) order by mp.created_at) from media_part mp
               where mp.media_id = m.id and mp.status in ('confirmed', 'technician_added')) as parts
        from media m join inspection i on i.id = m.inspection_id join shop s on s.id = i.shop_id join vehicle v on v.id = i.vehicle_id
       where s.share_training and not m.excluded
         and not exists (select 1 from training_label t where t.media_id = m.id)
         and exists (select 1 from media_part mp where mp.media_id = m.id and mp.status in ('confirmed', 'technician_added'))
       order by m.created_at
       limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) q), '[]'::jsonb);
end $$;

-- Admins: save a photo's boxes (approved) or skip it. Boxes are [{classId, position, x, y, w, h, source}] in 0..1.
create function public.training_save(p_media uuid, p_status text, p_boxes jsonb, p_width int, p_height int) returns void
  language plpgsql security definer set search_path = public as
$$
declare b jsonb;
begin
  perform require_platform_admin();
  if p_status not in ('approved', 'skipped') then raise exception 'Unknown label status' using errcode = '22023'; end if;
  if not public.training_eligible(p_media) then raise exception 'This photo can''t be used for training' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_boxes, '[]')) <> 'array' then raise exception 'Boxes must be a list' using errcode = '22023'; end if;
  if p_status = 'approved' and jsonb_array_length(coalesce(p_boxes, '[]')) = 0 then raise exception 'Draw at least one box, or skip the photo' using errcode = '22023'; end if;
  for b in select * from jsonb_array_elements(coalesce(p_boxes, '[]')) loop
    if not exists (select 1 from component_class where id = (b ->> 'classId')::int) then raise exception 'Unknown part type in a box' using errcode = '22023'; end if;
    if (b ->> 'x')::numeric < 0 or (b ->> 'y')::numeric < 0 or (b ->> 'w')::numeric <= 0 or (b ->> 'h')::numeric <= 0
       or (b ->> 'x')::numeric + (b ->> 'w')::numeric > 1.0001 or (b ->> 'y')::numeric + (b ->> 'h')::numeric > 1.0001 then
      raise exception 'A box is outside the photo' using errcode = '22023';
    end if;
  end loop;
  insert into training_label (media_id, status, boxes, width, height, labeled_by)
  values (p_media, p_status, case when p_status = 'approved' then p_boxes else '[]'::jsonb end, p_width, p_height, auth.uid())
  on conflict (media_id) do update set status = excluded.status, boxes = excluded.boxes, width = excluded.width,
    height = excluded.height, labeled_by = excluded.labeled_by, labeled_at = now();
end $$;

-- Admins: progress. Approved boxes per part type, photos approved/skipped, and how many are waiting.
create function public.training_stats() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  return jsonb_build_object(
    'approved', (select count(*) from training_label where status = 'approved'),
    'skipped', (select count(*) from training_label where status = 'skipped'),
    'waiting', (select count(*) from media m join inspection i on i.id = m.inspection_id join shop s on s.id = i.shop_id
                 where s.share_training and not m.excluded and not exists (select 1 from training_label t where t.media_id = m.id)
                   and exists (select 1 from media_part mp where mp.media_id = m.id and mp.status in ('confirmed', 'technician_added'))),
    'shops', (select count(*) from shop where share_training),
    'classes', coalesce((select jsonb_object_agg(cid, n) from (
        select (b ->> 'classId') as cid, count(*) as n
          from training_label t
          join media m on m.id = t.media_id join inspection i on i.id = m.inspection_id join shop s on s.id = i.shop_id
          cross join lateral jsonb_array_elements(t.boxes) b
         where t.status = 'approved' and s.share_training group by 1) c), '{}'::jsonb));
end $$;

-- Admins: everything needed to export the dataset (approved labels from shops that still share).
create function public.training_export() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('mediaId', t.media_id, 'path', m.storage_path, 'width', t.width, 'height', t.height, 'boxes', t.boxes)
           order by t.labeled_at)
      from training_label t join media m on m.id = t.media_id join inspection i on i.id = m.inspection_id join shop s on s.id = i.shop_id
     where t.status = 'approved' and s.share_training and not m.excluded), '[]'::jsonb);
end $$;

-- Admins: the storage path of one photo they may label (for the AI pre-draw on the server).
create function public.training_photo(p_media uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform require_platform_admin();
  if not public.training_eligible(p_media) then raise exception 'This photo can''t be used for training' using errcode = '42501'; end if;
  return (select jsonb_build_object('path', m.storage_path,
            'parts', (select jsonb_agg(comp_key(mp.component_id)) from media_part mp where mp.media_id = m.id and mp.status in ('confirmed', 'technician_added')))
            from media m where m.id = p_media);
end $$;

revoke all on function public.is_platform_admin(), public.require_platform_admin(), public.set_share_training(uuid, boolean),
  public.shop_training_info(uuid), public.training_eligible(uuid), public.training_queue(int),
  public.training_save(uuid, text, jsonb, int, int), public.training_stats(), public.training_export(), public.training_photo(uuid) from public, anon;
grant execute on function public.is_platform_admin(), public.set_share_training(uuid, boolean), public.shop_training_info(uuid),
  public.training_queue(int), public.training_save(uuid, text, jsonb, int, int), public.training_stats(), public.training_export(),
  public.training_photo(uuid) to authenticated;
