-- 0685 — Sample Entry ▸ Quantities to Order Entry parity (user 2026-10-06:
-- "if billable is enabled the quantities tab should open the qty tab from order
-- module order entry ... copy to here same").
--
-- Order Entry's Quantities carries four things 0683's tables could not hold.
-- ALL ADDITIVE AND NULLABLE (or defaulted) — no existing row changes meaning:
--
--   opportunities.multi_order             the "Multi Order" switch (OE 0427):
--                                         each destination names its buyer PO
--   sample_style_quantities.po_no         …that PO, kept as typed (CAPITALS
--                                         exemption, AGENTS.md: buyer PO no.)
--   sample_style_quantities.ratio_for     'master' | 'inner' — what one size
--                                         ratio fills on an assorted-size pack
--   sample_style_quantities.is_single_style_pack   Single / Multiple Style
--   sample_quantity_assort_lines.style_ref         the line's style BY NAME on a
--                                         Multiple Style pack — text, as Order
--                                         Entry keys styles (style_ref_no), so a
--                                         style first created in the same save
--                                         can be named before it has an id
--   sample_quantity_assort_lines.no_of_cartons / inners_per_carton
--                                         the ratio-pack arithmetic:
--                                         pcs = cartons × (inners if ratio_for
--                                         = inner) × Σ size ratio
--
-- save_sample_entry is re-created FROM 0683'S BODY with only those columns
-- added (header insert/update, quantity insert, line insert).

alter table public.opportunities
  add column if not exists multi_order boolean not null default false;

alter table public.sample_style_quantities
  add column if not exists po_no text,
  add column if not exists ratio_for text,
  add column if not exists is_single_style_pack boolean not null default true;

alter table public.sample_style_quantities drop constraint if exists sample_style_quantities_ratio_for_check;
alter table public.sample_style_quantities add constraint sample_style_quantities_ratio_for_check
  check (ratio_for is null or ratio_for in ('master', 'inner'));

alter table public.sample_quantity_assort_lines
  add column if not exists style_ref text,
  add column if not exists no_of_cartons numeric,
  add column if not exists inners_per_carton numeric;

alter table public.sample_quantity_assort_lines drop constraint if exists sample_quantity_assort_lines_counts_check;
alter table public.sample_quantity_assort_lines add constraint sample_quantity_assort_lines_counts_check
  check ((no_of_cartons is null or no_of_cartons >= 0) and (inners_per_carton is null or inners_per_carton >= 0));

create or replace function public.save_sample_entry(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  h        jsonb := p -> 'header';
  v_id     uuid := p_id;
  v_code   text;
  v_title  text;
  s        jsonb;
  c        jsonb;
  q        jsonb;
  l        jsonb;
  v_sid    uuid;
  v_cid    uuid;
  v_qid    uuid;
  v_lid    uuid;
  v_keep   uuid[] := '{}';
begin
  if nullif(h ->> 'customer_id', '') is null then
    raise exception 'Choose the Customer before saving the sample entry.' using errcode = '23502';
  end if;

  select name into v_title from public.customers where id = (h ->> 'customer_id')::uuid;
  if v_title is null then
    raise exception 'That customer no longer exists.' using errcode = '23503';
  end if;

  if v_id is null then
    insert into public.opportunities (
      title, customer_id, stage, received_date, enquiry_against, enquiry_action,
      country_id, season, season_year, customer_reference, agent_id,
      receipt_mode, delivery_to, delivery_mode, is_draft, multi_order
    ) values (
      v_title,
      (h ->> 'customer_id')::uuid,
      'enquiry',
      nullif(h ->> 'received_date', '')::date,
      nullif(h ->> 'enquiry_against', ''),
      nullif(h ->> 'enquiry_action', ''),
      nullif(h ->> 'country_id', '')::uuid,
      nullif(h ->> 'season', ''),
      nullif(h ->> 'season_year', '')::int,
      nullif(h ->> 'customer_reference', ''),
      nullif(h ->> 'agent_id', '')::uuid,
      nullif(h ->> 'receipt_mode', ''),
      nullif(h ->> 'delivery_to', ''),
      nullif(h ->> 'delivery_mode', ''),
      coalesce((h ->> 'is_draft')::boolean, false),
      coalesce((h ->> 'multi_order')::boolean, false)
    )
    returning id, code into v_id, v_code;
  else
    update public.opportunities set
      title              = v_title,
      customer_id        = (h ->> 'customer_id')::uuid,
      received_date      = nullif(h ->> 'received_date', '')::date,
      enquiry_against    = nullif(h ->> 'enquiry_against', ''),
      enquiry_action     = nullif(h ->> 'enquiry_action', ''),
      country_id         = nullif(h ->> 'country_id', '')::uuid,
      season             = nullif(h ->> 'season', ''),
      season_year        = nullif(h ->> 'season_year', '')::int,
      customer_reference = nullif(h ->> 'customer_reference', ''),
      agent_id           = nullif(h ->> 'agent_id', '')::uuid,
      receipt_mode       = nullif(h ->> 'receipt_mode', ''),
      delivery_to        = nullif(h ->> 'delivery_to', ''),
      delivery_mode      = nullif(h ->> 'delivery_mode', ''),
      is_draft           = coalesce((h ->> 'is_draft')::boolean, false),
      multi_order        = coalesce((h ->> 'multi_order')::boolean, false)
    where id = v_id
    returning code into v_code;
    -- RLS hides a row the caller may not edit: zero rows is a refusal, not a
    -- success with nothing to do.
    if not found then
      raise exception 'This sample entry no longer exists, or you do not have permission to edit it.'
        using errcode = '42501';
    end if;
  end if;

  -- Which existing lines survive this save.
  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    if nullif(s ->> 'id', '') is not null then
      v_keep := v_keep || (s ->> 'id')::uuid;
    end if;
  end loop;
  delete from public.styles where opportunity_id = v_id and not (id = any (v_keep));

  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    v_sid := nullif(s ->> 'id', '')::uuid;
    if v_sid is not null then
      update public.styles set
        sno = (s ->> 'sno')::int,
        name = s ->> 'name',
        article_no = nullif(s ->> 'article_no', ''),
        description = nullif(s ->> 'description', ''),
        unit_kind = nullif(s ->> 'unit_kind', ''),
        sample_qty = nullif(s ->> 'sample_qty', '')::numeric,
        delivery_date = nullif(s ->> 'delivery_date', '')::date,
        merchandiser_id = nullif(s ->> 'merchandiser_id', '')::uuid,
        order_date = nullif(s ->> 'order_date', '')::date,
        fabric_structure_id = nullif(s ->> 'fabric_structure_id', '')::uuid,
        fabric_id = nullif(s ->> 'fabric_id', '')::uuid,
        gsm = nullif(s ->> 'gsm', '')::numeric,
        tech_pack = nullif(s ->> 'tech_pack', ''),
        customer_reference = nullif(s ->> 'customer_reference', ''),
        receipt_mode = nullif(s ->> 'receipt_mode', ''),
        receipt_date = nullif(s ->> 'receipt_date', '')::date,
        delivery_to = nullif(s ->> 'delivery_to', ''),
        agent_id = nullif(s ->> 'agent_id', '')::uuid,
        delivery_mode = nullif(s ->> 'delivery_mode', ''),
        delivery_through = nullif(s ->> 'delivery_through', ''),
        accessories_reqd = coalesce((s ->> 'accessories_reqd')::boolean, false),
        billable = coalesce((s ->> 'billable')::boolean, false),
        ship_type_id = nullif(s ->> 'ship_type_id', '')::uuid,
        ship_mode = nullif(s ->> 'ship_mode', ''),
        currency_code = nullif(s ->> 'currency_code', ''),
        price = nullif(s ->> 'price', '')::numeric
      where id = v_sid and opportunity_id = v_id;
      if not found then
        raise exception 'A style line on this entry was removed by someone else. Reopen the entry and try again.'
          using errcode = '40001';
      end if;
    else
      insert into public.styles (
        opportunity_id, sno, name, article_no, description, unit_kind, sample_qty, delivery_date,
        merchandiser_id, order_date, fabric_structure_id, fabric_id, gsm, tech_pack,
        customer_reference, receipt_mode, receipt_date, delivery_to, agent_id, delivery_mode,
        delivery_through, accessories_reqd, billable, ship_type_id, ship_mode, currency_code, price
      ) values (
        v_id, (s ->> 'sno')::int, s ->> 'name', nullif(s ->> 'article_no', ''),
        nullif(s ->> 'description', ''), nullif(s ->> 'unit_kind', ''),
        nullif(s ->> 'sample_qty', '')::numeric, nullif(s ->> 'delivery_date', '')::date,
        nullif(s ->> 'merchandiser_id', '')::uuid, nullif(s ->> 'order_date', '')::date,
        nullif(s ->> 'fabric_structure_id', '')::uuid, nullif(s ->> 'fabric_id', '')::uuid,
        nullif(s ->> 'gsm', '')::numeric, nullif(s ->> 'tech_pack', ''),
        nullif(s ->> 'customer_reference', ''), nullif(s ->> 'receipt_mode', ''),
        nullif(s ->> 'receipt_date', '')::date, nullif(s ->> 'delivery_to', ''),
        nullif(s ->> 'agent_id', '')::uuid, nullif(s ->> 'delivery_mode', ''),
        nullif(s ->> 'delivery_through', ''),
        coalesce((s ->> 'accessories_reqd')::boolean, false),
        coalesce((s ->> 'billable')::boolean, false),
        nullif(s ->> 'ship_type_id', '')::uuid, nullif(s ->> 'ship_mode', ''),
        nullif(s ->> 'currency_code', ''), nullif(s ->> 'price', '')::numeric
      )
      returning id into v_sid;
    end if;

    -- Child trees, rewritten whole.
    delete from public.sample_style_coordinates where style_id = v_sid;
    delete from public.style_sizes where style_id = v_sid;
    delete from public.style_combos where style_id = v_sid;
    delete from public.sample_style_quantities where style_id = v_sid;

    insert into public.sample_style_coordinates (style_id, sno, coordinate_id)
    select v_sid, (x ->> 'sno')::int, (x ->> 'coordinate_id')::uuid
      from jsonb_array_elements(coalesce(s -> 'coordinates', '[]'::jsonb)) x
     where nullif(x ->> 'coordinate_id', '') is not null;

    insert into public.style_sizes (style_id, sno, garment_size)
    select v_sid, (x ->> 'sno')::int, x ->> 'garment_size'
      from jsonb_array_elements(coalesce(s -> 'sizes', '[]'::jsonb)) x
     where nullif(x ->> 'garment_size', '') is not null;

    for c in select * from jsonb_array_elements(coalesce(s -> 'combos', '[]'::jsonb)) loop
      insert into public.style_combos (style_id, sno, combo, order_qty, extra_qty)
      values (v_sid, (c ->> 'sno')::int, c ->> 'combo',
              nullif(c ->> 'order_qty', '')::numeric, nullif(c ->> 'extra_qty', '')::numeric)
      returning id into v_cid;
      insert into public.style_combo_sizes (style_combo_id, sno, garment_size, order_qty)
      select v_cid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'order_qty', '')::numeric
        from jsonb_array_elements(coalesce(c -> 'sizes', '[]'::jsonb)) x
       where nullif(x ->> 'garment_size', '') is not null;
    end loop;

    for q in select * from jsonb_array_elements(coalesce(s -> 'quantities', '[]'::jsonb)) loop
      insert into public.sample_style_quantities (
        style_id, sno, country_id, ref_no, consignee_id, assortment_type_id, po_qty,
        delivery_date, earlier_shipment_date, discharge_port_id, final_destination_id,
        pack, no_of_cartons, master_carton_name, po_no, ratio_for, is_single_style_pack
      ) values (
        v_sid, (q ->> 'sno')::int, nullif(q ->> 'country_id', '')::uuid, nullif(q ->> 'ref_no', ''),
        nullif(q ->> 'consignee_id', '')::uuid, nullif(q ->> 'assortment_type_id', '')::uuid,
        nullif(q ->> 'po_qty', '')::numeric, nullif(q ->> 'delivery_date', '')::date,
        nullif(q ->> 'earlier_shipment_date', '')::date, nullif(q ->> 'discharge_port_id', '')::uuid,
        nullif(q ->> 'final_destination_id', '')::uuid, nullif(q ->> 'pack', ''),
        nullif(q ->> 'no_of_cartons', '')::int, nullif(q ->> 'master_carton_name', ''),
        nullif(q ->> 'po_no', ''), nullif(q ->> 'ratio_for', ''),
        coalesce((q ->> 'is_single_style_pack')::boolean, true)
      )
      returning id into v_qid;
      for l in select * from jsonb_array_elements(coalesce(q -> 'lines', '[]'::jsonb)) loop
        insert into public.sample_quantity_assort_lines (
          quantity_id, sno, combo, style_ref, no_of_cartons, inners_per_carton
        ) values (
          v_qid, (l ->> 'sno')::int, nullif(l ->> 'combo', ''), nullif(l ->> 'style_ref', ''),
          nullif(l ->> 'no_of_cartons', '')::numeric, nullif(l ->> 'inners_per_carton', '')::numeric
        )
        returning id into v_lid;
        insert into public.sample_quantity_assort_sizes (line_id, sno, garment_size, qty)
        select v_lid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'qty', '')::numeric
          from jsonb_array_elements(coalesce(l -> 'sizes', '[]'::jsonb)) x
         where nullif(x ->> 'garment_size', '') is not null;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

comment on function public.save_sample_entry(uuid, jsonb) is
  'Sample Entry (0683, quantities to Order Entry parity 0685): writes the enquiry header, its style lines (updated in place by id) and every '
  'child tree in one transaction. SECURITY INVOKER — every write passes RLS.';

revoke all on function public.save_sample_entry(uuid, jsonb) from public, anon;
grant execute on function public.save_sample_entry(uuid, jsonb) to authenticated;
