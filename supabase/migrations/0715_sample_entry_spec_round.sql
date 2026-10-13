-- 0715 · Sample Entry — the client's 2026-10-12 field round (spec §1–§2)
--
--   §1 Product Info: Fabric Structure becomes a MULTI-select, and GSM is entered
--      per structure picked ("fabric-based GSM … linked to the selected fabric
--      structure(s)"). New child table `sample_style_fabric_structures`, one
--      row per (style, structure) with its own GSM. `styles.fabric_structure_id`
--      and `styles.gsm` stay, written from the FIRST row, so every reader of
--      them — Costing, Grouping, the Fabric Plan's structure fill — is untouched.
--   §2 Sample Info: Merchandiser moves to the header (`opportunities.
--      merchandiser_id`, which already exists) and is stamped onto every style
--      line, so `styles.merchandiser_id` readers are untouched. Sample Type
--      (default Fit Sample) is a header field stamped onto `styles.sample_type`
--      (0268's column and CHECK: proto / fit / sms / pp / top).
--
-- save_sample_entry is re-created FROM THE LIVE BODY (pg_get_functiondef,
-- 2026-10-12) with exactly three additions, each marked "0715".

create table if not exists public.sample_style_fabric_structures (
  id           uuid primary key default gen_random_uuid(),
  style_id     uuid not null references public.styles(id) on delete cascade,
  sno          int  not null,
  structure_id uuid not null references public.categories(id) on delete restrict,
  gsm          numeric check (gsm is null or gsm >= 0),
  created_at   timestamptz not null default now(),
  unique (style_id, structure_id)
);
create index if not exists idx_sample_style_fabric_structures_style on public.sample_style_fabric_structures(style_id);

comment on table public.sample_style_fabric_structures is
  'Sample Entry ▸ Product Info (0715): the fabric structures a sample style is made in, each with its GSM. styles.fabric_structure_id / gsm mirror the first row.';

alter table public.sample_style_fabric_structures enable row level security;
-- Same gate as the style's other child rows (sample_style_files, 0686).
drop policy if exists sample_style_fabric_structures_read on public.sample_style_fabric_structures;
create policy sample_style_fabric_structures_read on public.sample_style_fabric_structures
  for select using (has_permission('sales', 'view'));
drop policy if exists sample_style_fabric_structures_insert on public.sample_style_fabric_structures;
create policy sample_style_fabric_structures_insert on public.sample_style_fabric_structures
  for insert with check (has_permission('sales', 'create') or has_permission('sales', 'edit'));
drop policy if exists sample_style_fabric_structures_update on public.sample_style_fabric_structures;
create policy sample_style_fabric_structures_update on public.sample_style_fabric_structures
  for update using (has_permission('sales', 'edit')) with check (has_permission('sales', 'edit'));
drop policy if exists sample_style_fabric_structures_delete on public.sample_style_fabric_structures;
create policy sample_style_fabric_structures_delete on public.sample_style_fabric_structures
  for delete using (has_permission('sales', 'edit') or has_permission('sales', 'delete'));

-- Existing styles keep their one structure as the first row.
insert into public.sample_style_fabric_structures (style_id, sno, structure_id, gsm)
select id, 1, fabric_structure_id, gsm from public.styles
 where fabric_structure_id is not null
on conflict (style_id, structure_id) do nothing;

CREATE OR REPLACE FUNCTION public.save_sample_entry(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  h          jsonb := p -> 'header';
  v_id       uuid := p_id;
  v_code     text;
  v_title    text;
  v_season   uuid := nullif(h ->> 'season_id', '')::uuid;
  v_seasontx text;
  s          jsonb;
  c          jsonb;
  q          jsonb;
  l          jsonb;
  v_sid      uuid;
  v_cid      uuid;
  v_qid      uuid;
  v_lid      uuid;
  v_keep     uuid[] := '{}';
begin
  if nullif(h ->> 'customer_id', '') is null then
    raise exception 'Choose the Customer before saving the sample entry.' using errcode = '23502';
  end if;

  select name into v_title from public.customers where id = (h ->> 'customer_id')::uuid;
  if v_title is null then
    raise exception 'That customer no longer exists.' using errcode = '23503';
  end if;

  if v_season is not null then
    select coalesce(nullif(season_name, ''), season) into v_seasontx from public.seasons where id = v_season;
    if v_seasontx is null then
      raise exception 'That season no longer exists.' using errcode = '23503';
    end if;
  end if;

  if v_id is null then
    insert into public.opportunities (
      title, customer_id, stage, received_date, enquiry_against, enquiry_action,
      country_id, season_id, season, season_year, customer_reference, agent_id,
      receipt_mode, receipt_date, delivery_to, delivery_mode, is_draft, multi_order,
      merchandiser_id  -- 0715
    ) values (
      v_title,
      (h ->> 'customer_id')::uuid,
      'enquiry',
      nullif(h ->> 'received_date', '')::date,
      nullif(h ->> 'enquiry_against', ''),
      nullif(h ->> 'enquiry_action', ''),
      nullif(h ->> 'country_id', '')::uuid,
      v_season,
      v_seasontx,
      nullif(h ->> 'season_year', '')::int,
      nullif(h ->> 'customer_reference', ''),
      nullif(h ->> 'agent_id', '')::uuid,
      nullif(h ->> 'receipt_mode', ''),
      nullif(h ->> 'receipt_date', '')::date,
      nullif(h ->> 'delivery_to', ''),
      nullif(h ->> 'delivery_mode', ''),
      coalesce((h ->> 'is_draft')::boolean, false),
      coalesce((h ->> 'multi_order')::boolean, false),
      nullif(h ->> 'merchandiser_id', '')::uuid  -- 0715
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
      season_id          = v_season,
      season             = v_seasontx,
      season_year        = nullif(h ->> 'season_year', '')::int,
      customer_reference = nullif(h ->> 'customer_reference', ''),
      agent_id           = nullif(h ->> 'agent_id', '')::uuid,
      receipt_mode       = nullif(h ->> 'receipt_mode', ''),
      receipt_date       = nullif(h ->> 'receipt_date', '')::date,
      delivery_to        = nullif(h ->> 'delivery_to', ''),
      delivery_mode      = nullif(h ->> 'delivery_mode', ''),
      is_draft           = coalesce((h ->> 'is_draft')::boolean, false),
      multi_order        = coalesce((h ->> 'multi_order')::boolean, false),
      merchandiser_id    = nullif(h ->> 'merchandiser_id', '')::uuid  -- 0715
    where id = v_id
    returning code into v_code;
    if not found then
      raise exception 'This sample entry no longer exists, or you do not have permission to edit it.'
        using errcode = '42501';
    end if;
  end if;

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
        price = nullif(s ->> 'price', '')::numeric,
        exchange_rate = nullif(s ->> 'exchange_rate', '')::numeric,
        sample_type = nullif(s ->> 'sample_type', '')  -- 0715
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
        delivery_through, accessories_reqd, billable, ship_type_id, ship_mode, currency_code, price,
        exchange_rate,
        sample_type  -- 0715
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
        nullif(s ->> 'currency_code', ''), nullif(s ->> 'price', '')::numeric,
        nullif(s ->> 'exchange_rate', '')::numeric,
        nullif(s ->> 'sample_type', '')  -- 0715
      )
      returning id into v_sid;
    end if;

    delete from public.sample_style_coordinates where style_id = v_sid;
    delete from public.style_sizes where style_id = v_sid;
    delete from public.style_combos where style_id = v_sid;
    delete from public.sample_style_quantities where style_id = v_sid;
    delete from public.sample_style_files where style_id = v_sid;
    delete from public.sample_style_fabric_structures where style_id = v_sid;  -- 0715

    insert into public.sample_style_coordinates (style_id, sno, coordinate_id)
    select v_sid, (x ->> 'sno')::int, (x ->> 'coordinate_id')::uuid
      from jsonb_array_elements(coalesce(s -> 'coordinates', '[]'::jsonb)) x
     where nullif(x ->> 'coordinate_id', '') is not null;

    insert into public.style_sizes (style_id, sno, garment_size)
    select v_sid, (x ->> 'sno')::int, x ->> 'garment_size'
      from jsonb_array_elements(coalesce(s -> 'sizes', '[]'::jsonb)) x
     where nullif(x ->> 'garment_size', '') is not null;

    insert into public.sample_style_files (style_id, sno, doc_kind, file_name, storage_path, mime_type, size_bytes)
    select v_sid, (x ->> 'sno')::int, nullif(x ->> 'doc_kind', ''), x ->> 'file_name', x ->> 'storage_path',
           nullif(x ->> 'mime_type', ''), nullif(x ->> 'size_bytes', '')::bigint
      from jsonb_array_elements(coalesce(s -> 'files', '[]'::jsonb)) x
     where nullif(x ->> 'storage_path', '') is not null;

    -- 0715: the fabric structures, each with its GSM.
    insert into public.sample_style_fabric_structures (style_id, sno, structure_id, gsm)
    select v_sid, (x ->> 'sno')::int, (x ->> 'structure_id')::uuid, nullif(x ->> 'gsm', '')::numeric
      from jsonb_array_elements(coalesce(s -> 'structures', '[]'::jsonb)) x
     where nullif(x ->> 'structure_id', '') is not null;

    for c in select * from jsonb_array_elements(coalesce(s -> 'combos', '[]'::jsonb)) loop
      insert into public.style_combos (style_id, sno, combo, order_qty)
      values (v_sid, (c ->> 'sno')::int, c ->> 'combo', nullif(c ->> 'order_qty', '')::numeric)
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
$function$;
