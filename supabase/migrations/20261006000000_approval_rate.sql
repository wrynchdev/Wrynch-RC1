-- Approval rate: of the work recommended on reports sent to customers (parts rated Monitor or Immediate),
-- how much customers approve. The dashboard compares it with the shop's own "before Wrynch" estimate.

alter table public.shop add column approval_baseline numeric check (approval_baseline is null or approval_baseline between 0 and 100);

-- Owner: what share of recommended work customers approved before Wrynch (a percentage), or null to clear it.
create function public.set_approval_baseline(p_shop uuid, p_percent numeric) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform require_role(p_shop, array['owner']);
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then raise exception 'Enter a percentage from 0 to 100' using errcode = '22023'; end if;
  update shop set approval_baseline = round(p_percent, 1) where id = p_shop;
end $$;
revoke all on function public.set_approval_baseline(uuid, numeric) from public, anon;
grant execute on function public.set_approval_baseline(uuid, numeric) to authenticated;

-- The dashboard now counts approved items per inspection and returns the baseline.
create or replace function public.shop_dashboard(p_shop uuid, p_days int default 7) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text; v_money boolean; v_days int := least(greatest(coalesce(p_days, 7), 1), 90); v_from timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from shop_member where shop_id = p_shop and user_id = auth.uid();
  if v_role is null then raise exception 'You don''t have permission to do that in this shop' using errcode = '42501'; end if;
  v_money := v_role in ('owner', 'advisor');
  v_from := date_trunc('day', now()) - make_interval(days => v_days - 1);

  return jsonb_build_object(
    'days', v_days,
    'money', v_money,
    'baseline', (select approval_baseline from shop where id = p_shop),
    'rows', coalesce((
      select jsonb_agg(r order by r ->> 'createdAt' desc) from (
        select jsonb_build_object(
          'id', i.id, 'ro', coalesce(i.ro, ''), 'status', i.status, 'date', i.inspection_date,
          'createdAt', i.created_at, 'submittedAt', i.submitted_at, 'sentAt', i.sent_at,
          'vehicle', trim(concat_ws(' ', v.year, v.make, v.model)), 'customer', coalesce(c.name, ''),
          'technician', coalesce(i.technician_name, ''),
          'immediate', coalesce((i.summary ->> 'immediate')::int, 0), 'monitor', coalesce((i.summary ->> 'monitor')::int, 0),
          'approvedItems', (select count(*) from customer_approval a where a.inspection_id = i.id),
          'estimate', case when v_money then coalesce((select sum(e.parts + e.labor) from estimate_line e where e.inspection_id = i.id), 0) else 0 end,
          'approved', case when v_money then coalesce((select sum(e.parts + e.labor) from estimate_line e
                        join customer_approval a on a.inspection_id = e.inspection_id and a.component_id = e.component_id
                       where e.inspection_id = i.id), 0) else 0 end
        ) as r
        from inspection i
        join vehicle v on v.id = i.vehicle_id
        left join customer c on c.id = v.customer_id
        where i.shop_id = p_shop
          and (i.status in ('not_started', 'in_progress', 'submitted') or i.created_at >= v_from or i.sent_at >= v_from)
        order by i.created_at desc
        limit 1000
      ) x), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(ev order by ev ->> 'at' desc) from (
        select jsonb_build_object('at', at, 'kind', kind, 'inspectionId', i.id, 'ro', coalesce(i.ro, ''),
                                  'vehicle', trim(concat_ws(' ', v.year, v.make, v.model)), 'detail', detail) as ev
        from (
          select id as insp, created_at as at, 'created' as kind, null::text as detail from inspection where shop_id = p_shop and created_at >= v_from
          union all select id, submitted_at, 'submitted', null from inspection where shop_id = p_shop and submitted_at >= v_from
          union all select id, sent_at, 'sent', null from inspection where shop_id = p_shop and sent_at >= v_from
          union all select d.inspection_id, d.created_at, 'delivered', d.channel from delivery d join inspection i2 on i2.id = d.inspection_id
                     where i2.shop_id = p_shop and d.created_at >= v_from and d.status = 'sent'
          union all select a.inspection_id, max(a.approved_at), 'approved', count(*)::text from customer_approval a join inspection i3 on i3.id = a.inspection_id
                     where i3.shop_id = p_shop and a.approved_at >= v_from group by a.inspection_id, date_trunc('hour', a.approved_at)
        ) e
        join inspection i on i.id = e.insp
        join vehicle v on v.id = i.vehicle_id
        order by at desc
        limit 25
      ) y), '[]'::jsonb)
  );
end $$;
