-- 0837 · DC CAP KG, MANUAL OVERRIDE (client 2026-11-12, user go-ahead "draft and issued").
--
-- The most one yarn row of a Knitting Order may send on Job Work DCs was always CALCULATED:
-- Required Kg rounded up to whole bags (0825, decision D2), stored as
-- `process_order_lines.sent_qty`, which `process_dc_dispatch` enforces ("only X left to send").
-- The store now sets it by hand when the truck or the lot released says otherwise — up or down.
--
-- 1. `process_order_knit_yarns.dc_cap_override_kg` — the typed cap; NULL = the calculated one.
-- 2. `knitting_order_save` (a DRAFT): each yarn may carry `dc_cap_kg`. Re-created from the LIVE
--    body (0836) with two statements changed, each matched exactly once.
-- 3. `knitting_set_dc_cap(yarn, kg)` (an ISSUED / open order, which `knitting_order_save` refuses):
--    sets or clears the override and rewrites the line's cap in one statement. Never below what
--    has already left on DCs; not on an order waiting for the MD to approve its close.
--    The audit row is written by the server action that calls it.

alter table public.process_order_knit_yarns
  add column if not exists dc_cap_override_kg numeric(12,3)
    check (dc_cap_override_kg is null or dc_cap_override_kg > 0);

do $$
declare
  v_def text := pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure);
  r record;
begin
  for r in
    select * from (values
      ('      v_cap   := case when v_bag > 0 then ceil(v_req / v_bag) * v_bag else v_req end;',
       E'      v_cap   := case when v_bag > 0 then ceil(v_req / v_bag) * v_bag else v_req end;\n      -- DC CAP OVERRIDE (0837): the store''s typed cap replaces the calculated one.\n      if nullif(y->>''dc_cap_kg'', '''')::numeric <= 0 then\n        raise exception ''%: the DC Cap must be more than 0 kg, or left blank'', v_name using errcode = ''P0001'';\n      end if;\n      v_cap   := coalesce(round(nullif(y->>''dc_cap_kg'', '''')::numeric, 3), v_cap);'),
      ('v_bag, v_line);',
       E'v_bag, v_line);\n      update public.process_order_knit_yarns set dc_cap_override_kg = round(nullif(y->>''dc_cap_kg'', '''')::numeric, 3)\n       where process_order_line_id = v_line;')
    ) t(old_s, new_s)
  loop
    if (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s) <> 1 then
      raise exception '0837: knitting_order_save — expected exactly one match for: %', r.old_s;
    end if;
    v_def := replace(v_def, r.old_s, r.new_s);
  end loop;
  execute v_def;
end $$;

create or replace function public.knitting_set_dc_cap(p_yarn uuid, p_kg numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  y      record;
  o      record;
  v_kg   numeric := round(p_kg, 3);
  v_calc numeric;
  v_cap  numeric;
  v_sent numeric;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to change a DC Cap' using errcode = '42501';
  end if;
  select py.*, pf.process_order_id, i.name as yarn_name into y
    from public.process_order_knit_yarns py
    join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
    join public.items i on i.id = py.yarn_item_id
   where py.id = p_yarn;
  if y.id is null then
    raise exception 'Yarn line not found' using errcode = 'P0002';
  end if;
  select * into o from public.process_orders where id = y.process_order_id for update;
  if o.process_type <> 'knitting' or not public.is_current_location(o.location_id) then
    raise exception 'That knitting order is not in your unit' using errcode = '42501';
  end if;
  if o.status not in ('draft', 'issued', 'in_process', 'partially_received') or o.close_pending then
    raise exception 'Knitting order % is %: its DC Cap can no longer change', coalesce(o.code, ''),
      case when o.close_pending then 'waiting for the MD to approve its close' else o.status end using errcode = 'P0001';
  end if;
  if v_kg is not null and v_kg <= 0 then
    raise exception 'The DC Cap must be more than 0 kg, or left blank' using errcode = 'P0001';
  end if;

  v_calc := case when y.bag_weight_kg > 0 then ceil(y.required_kg / y.bag_weight_kg) * y.bag_weight_kg else y.required_kg end;
  v_cap := coalesce(v_kg, v_calc);
  select coalesce(sum(x.sent_qty), 0) into v_sent
    from public.dc_line_items x join public.delivery_challans d on d.id = x.delivery_challan_id
   where x.process_order_line_id = y.process_order_line_id and d.status not in ('draft', 'cancelled');
  if v_cap < v_sent - 0.0005 then
    raise exception '%: % kg has already been sent — the DC Cap cannot go below it', y.yarn_name, round(v_sent, 3)
      using errcode = 'P0001';
  end if;

  update public.process_order_knit_yarns set dc_cap_override_kg = v_kg where id = y.id;
  update public.process_order_lines set sent_qty = v_cap where id = y.process_order_line_id;
  return v_cap;
end;
$$;
revoke all on function public.knitting_set_dc_cap(uuid, numeric) from public, anon;
grant execute on function public.knitting_set_dc_cap(uuid, numeric) to authenticated;

do $$
begin
  if position('dc_cap_kg' in pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception '0837: knitting_order_save was not replaced';
  end if;
end $$;
