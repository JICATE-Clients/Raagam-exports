-- 0801 · OPENING STOCK BALANCE (user 2026-11-03, pasted spec + "field and logic take, UI
-- on our architecture"; decisions confirmed the same day).
--
-- 0200 built a thin document: a store, a date, and item × qty lines. Posting wrote anonymous
-- `adjust_in` rows — no bin, no lot, no rate — so opening stock had no place in a rack, no
-- FIFO age that meant anything, and no value on Stock Statement with Value. Both tables
-- held ZERO rows on the day, so they are widened in place rather than replaced.
--
-- HEADER (decisions 1–3):
--   stock_type   accepted | rejected | replacement. On the HEADER, not each line. Our
--                reports read stock status off the STORE TYPE, so rejected / replacement
--                stock must sit in the unit's Rejection store; the type is kept so the
--                report can tell the two apart (a GRN line says it with rejection_action).
--   group_kind   general | re | iwo | swo — the same four words GRN uses (0778). Buyer and
--                group description are NOT stored: they are read off the order.
--   garment_order_id / iwo_id   the order the stock is held for (RE, or IWO / SWO).
--   code         OPN-0001, unchanged (assign_code on insert, i.e. on Save).
--
-- LINE: store (header default, per-line override), lot, stock-take slip ref, bags × bag
-- weight (yarn), rate (typed — opening stock has no PO), uom. Bins live in
-- opening_stock_line_bins, one row per bin, same shape as grn_line_bins (0782).
--
-- SAVE + POST in SQL, SECURITY INVOKER: stock_ledger's own policy already asks
-- stores:create + the current unit, and opening_stocks asks lv_stores(store_id), so RLS
-- is the guard and no definer bypass is needed.

-- ---------- header ----------
alter table public.opening_stocks
  add column if not exists stock_type text not null default 'accepted',
  add column if not exists group_kind text not null default 'general',
  add column if not exists garment_order_id uuid references public.garment_order_amendments(id),
  add column if not exists iwo_id uuid references public.internal_work_orders(id),
  add column if not exists posted_at timestamptz;

alter table public.opening_stocks drop constraint if exists opening_stocks_stock_type_check;
alter table public.opening_stocks add constraint opening_stocks_stock_type_check
  check (stock_type in ('accepted', 'rejected', 'replacement'));
alter table public.opening_stocks drop constraint if exists opening_stocks_group_kind_check;
alter table public.opening_stocks add constraint opening_stocks_group_kind_check
  check (group_kind in ('general', 're', 'iwo', 'swo'));
-- One group, one order column: General names none, RE the garment order, IWO / SWO the IWO.
alter table public.opening_stocks drop constraint if exists opening_stocks_group_order_check;
alter table public.opening_stocks add constraint opening_stocks_group_order_check check (
  (group_kind = 'general' and garment_order_id is null and iwo_id is null)
  or (group_kind = 're' and garment_order_id is not null and iwo_id is null)
  or (group_kind in ('iwo', 'swo') and iwo_id is not null and garment_order_id is null)
);

comment on column public.opening_stocks.stock_type is 'Accepted / Rejected / Replacement (0801). Rejected and Replacement post into the unit''s Rejection store; the report reads this to tell them apart.';
comment on column public.opening_stocks.group_kind is 'General / RE / IWO / SWO (0801) — the order the opening stock is held for. Buyer is read off the order, never typed.';

-- ---------- lines ----------
alter table public.opening_stock_lines
  add column if not exists store_id uuid references public.stores(id),
  add column if not exists lot_no text,
  add column if not exists ref_no text,
  add column if not exists ref_date date,
  add column if not exists bags numeric(12,3),
  add column if not exists bag_weight numeric(12,3),
  add column if not exists rate numeric(14,4),
  add column if not exists uom_id uuid references public.uoms(id);
create index if not exists idx_opn_lines_item on public.opening_stock_lines(item_id);

comment on column public.opening_stock_lines.rate is 'Valuation rate per stock UOM (0801), typed — opening stock has no PO. Written to stock_ledger.rate, which Stock Statement with Value reads first.';
comment on column public.opening_stock_lines.bags is 'Yarn: bags × bag_weight = quantity (kg). Kept for the record; quantity is what posts.';

-- A LINE OF THE DOCUMENT IS DELETABLE BY stores:edit (AGENTS.md, 0678's line shape): the save
-- replaces the line set, and a delete refused by RLS is silent — the re-insert would double it.
drop policy if exists opening_stock_lines_delete on public.opening_stock_lines;
create policy opening_stock_lines_delete on public.opening_stock_lines for delete to authenticated
  using ((public.has_permission('stores', 'edit') or public.has_permission('stores', 'delete'))
         and public.lv_opening_stocks(opening_stock_id));

-- ---------- bins of a line (grn_line_bins' shape) ----------
create table if not exists public.opening_stock_line_bins (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references public.opening_stock_lines(id) on delete cascade,
  bin_id     uuid not null references public.bins(id),
  qty        numeric(14,3) not null check (qty > 0),
  sort_order int not null default 0,
  unique (line_id, bin_id)
);
create index if not exists idx_opn_line_bins_line on public.opening_stock_line_bins(line_id);
alter table public.opening_stock_line_bins enable row level security;

create policy opening_stock_line_bins_read on public.opening_stock_line_bins for select to authenticated
  using (public.has_permission('stores', 'view') and exists (
    select 1 from public.opening_stock_lines l where l.id = line_id and public.lv_opening_stocks(l.opening_stock_id)));
create policy opening_stock_line_bins_insert on public.opening_stock_line_bins for insert to authenticated
  with check (public.has_permission('stores', 'create') and exists (
    select 1 from public.opening_stock_lines l where l.id = line_id and public.lv_opening_stocks(l.opening_stock_id)));
create policy opening_stock_line_bins_update on public.opening_stock_line_bins for update to authenticated
  using (public.has_permission('stores', 'edit') and exists (
    select 1 from public.opening_stock_lines l where l.id = line_id and public.lv_opening_stocks(l.opening_stock_id)))
  with check (public.has_permission('stores', 'edit') and exists (
    select 1 from public.opening_stock_lines l where l.id = line_id and public.lv_opening_stocks(l.opening_stock_id)));
create policy opening_stock_line_bins_delete on public.opening_stock_line_bins for delete to authenticated
  using ((public.has_permission('stores', 'edit') or public.has_permission('stores', 'delete')) and exists (
    select 1 from public.opening_stock_lines l where l.id = line_id and public.lv_opening_stocks(l.opening_stock_id)));

-- ---------- the orders a header may name ----------
-- RE = a saved garment order (not a draft); IWO / SWO = an internal work order, SWO when a
-- sample group carries it as its accessories IWO. Labels are the ones Stock Statement prints
-- (0793). A cancelled / closed order is INACTIVE, not absent — a document that already names
-- one must keep reading it (AGENTS.md "Disabled rows"). Invoker: each table's RLS scopes it.
create or replace function public.opening_stock_group_options()
returns table (kind text, id uuid, label text, customer_name text, inactive boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select 're', ga.id, coalesce(so.order_number, ga.code, '—'), cu.name,
         coalesce(so.status, '') in ('cancelled', 'closed')
    from public.garment_order_amendments ga
    left join public.sales_orders so on so.id = ga.sales_order_id
    left join public.customers cu on cu.id = ga.customer_id
   where not coalesce(ga.is_draft, false)
  union all
  select case when sg.id is not null then 'swo' else 'iwo' end,
         w.id,
         case when sg.id is not null then sg.group_code || ' · ' || w.code else coalesce(w.code, '—') end,
         case when sg.id is not null
              then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample') end,
         coalesce(w.status, '') in ('cancelled', 'closed')
    from public.internal_work_orders w
    left join public.sample_product_groups sg on sg.accessories_iwo_id = w.id
$$;
revoke all on function public.opening_stock_group_options() from public, anon;
grant execute on function public.opening_stock_group_options() to authenticated;

-- ---------- post: one adjust_in row per bin (or per line with no bin) ----------
create or replace function public.opening_stock_post(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  d record;
  l record;
  b record;
  v_unit uuid;
  v_store record;
  v_split numeric;
  v_n int := 0;
begin
  select o.*, st.location_id as unit_id into d
    from public.opening_stocks o join public.stores st on st.id = o.store_id
   where o.id = p_id
   for update of o;
  if not found then raise exception 'Opening stock not found'; end if;
  if d.status <> 'draft' then raise exception 'Only a draft opening stock can be posted'; end if;
  if d.opening_date is null then raise exception 'Opening date is required'; end if;
  v_unit := d.unit_id;

  for l in
    select ol.*, coalesce(it.name, 'Line ' || (ol.sort_order + 1)) as item_name
      from public.opening_stock_lines ol
      left join public.items it on it.id = ol.item_id
     where ol.opening_stock_id = p_id
     order by ol.sort_order
  loop
    if coalesce(l.quantity, 0) <= 0 then
      raise exception '%: the opening qty must be more than zero', l.item_name;
    end if;
    if l.rate is null or l.rate < 0 then
      raise exception '%: the rate is required', l.item_name;
    end if;

    select id, location_id, store_type, name into v_store
      from public.stores where id = coalesce(l.store_id, d.store_id);
    if v_store.location_id is distinct from v_unit then
      raise exception '%: % is in another unit', l.item_name, v_store.name;
    end if;
    -- Status is read off the store type (0793): Rejected / Replacement must sit in the
    -- Rejection store, and Accepted stock must not.
    if d.stock_type = 'accepted' and v_store.store_type = 'rejection' then
      raise exception '%: Accepted stock cannot go into %', l.item_name, v_store.name;
    end if;
    if d.stock_type <> 'accepted' and v_store.store_type <> 'rejection' then
      raise exception '%: % stock goes into the Rejection store', l.item_name, initcap(d.stock_type);
    end if;

    select coalesce(sum(qty), 0) into v_split from public.opening_stock_line_bins where line_id = l.id;
    if v_split > 0 then
      if v_split <> l.quantity then
        raise exception '%: the bins hold %, the opening qty is %', l.item_name, v_split, l.quantity;
      end if;
      for b in
        select ob.bin_id, ob.qty, bn.store_id as bin_store, bn.bin_code
          from public.opening_stock_line_bins ob join public.bins bn on bn.id = ob.bin_id
         where ob.line_id = l.id order by ob.sort_order
      loop
        if b.bin_store is distinct from v_store.id then
          raise exception '%: bin % is not in %', l.item_name, b.bin_code, v_store.name;
        end if;
        insert into public.stock_ledger
          (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, uom_id, lot_no,
           location_id, reference_type, reference_id, note)
        values
          (v_store.id, b.bin_id, l.item_id, 'adjust_in', b.qty, d.opening_date, l.rate, l.uom_id,
           nullif(upper(btrim(l.lot_no)), ''), v_unit, 'opening_stock', p_id, 'Opening stock ' || d.code);
      end loop;
    else
      insert into public.stock_ledger
        (store_id, item_id, movement_type, quantity, txn_date, rate, uom_id, lot_no,
         location_id, reference_type, reference_id, note)
      values
        (v_store.id, l.item_id, 'adjust_in', l.quantity, d.opening_date, l.rate, l.uom_id,
         nullif(upper(btrim(l.lot_no)), ''), v_unit, 'opening_stock', p_id, 'Opening stock ' || d.code);
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Nothing to post — add at least one line'; end if;
  update public.opening_stocks set status = 'posted', posted_at = now() where id = p_id;
end;
$$;
revoke all on function public.opening_stock_post(uuid) from public, anon;
grant execute on function public.opening_stock_post(uuid) to authenticated;

-- ---------- save (and optionally post) in one transaction ----------
-- p_doc:   { store_id, opening_date, stock_type, group_kind, garment_order_id, iwo_id, notes }
-- p_lines: [ { item_id, store_id, lot_no, ref_no, ref_date, bags, bag_weight, quantity, rate,
--              uom_id, note, bins: [ { bin_id, qty } ] } ]
-- A failed post rolls the whole save back (one statement = one transaction), so "Save & Post"
-- never leaves a half-posted draft behind — GRN's rule.
create or replace function public.opening_stock_save(p_id uuid, p_doc jsonb, p_lines jsonb, p_post boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_status text;
  v_line jsonb;
  v_bin jsonb;
  v_line_id uuid;
  v_i int := 0;
  v_j int;
  v_kind text := coalesce(nullif(p_doc->>'group_kind', ''), 'general');
begin
  if v_id is null then
    insert into public.opening_stocks
      (store_id, opening_date, stock_type, group_kind, garment_order_id, iwo_id, notes, status)
    values (
      (p_doc->>'store_id')::uuid,
      (p_doc->>'opening_date')::date,
      coalesce(nullif(p_doc->>'stock_type', ''), 'accepted'),
      v_kind,
      case when v_kind = 're' then nullif(p_doc->>'garment_order_id', '')::uuid end,
      case when v_kind in ('iwo', 'swo') then nullif(p_doc->>'iwo_id', '')::uuid end,
      nullif(btrim(p_doc->>'notes'), ''),
      'draft')
    returning id into v_id;
  else
    select status into v_status from public.opening_stocks where id = v_id for update;
    if not found then raise exception 'Opening stock not found'; end if;
    if v_status <> 'draft' then raise exception 'A posted opening stock cannot be changed'; end if;
    update public.opening_stocks set
      store_id = (p_doc->>'store_id')::uuid,
      opening_date = (p_doc->>'opening_date')::date,
      stock_type = coalesce(nullif(p_doc->>'stock_type', ''), 'accepted'),
      group_kind = v_kind,
      garment_order_id = case when v_kind = 're' then nullif(p_doc->>'garment_order_id', '')::uuid end,
      iwo_id = case when v_kind in ('iwo', 'swo') then nullif(p_doc->>'iwo_id', '')::uuid end,
      notes = nullif(btrim(p_doc->>'notes'), '')
    where id = v_id;
    delete from public.opening_stock_lines where opening_stock_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.opening_stock_lines
      (opening_stock_id, item_id, store_id, lot_no, ref_no, ref_date, bags, bag_weight,
       quantity, rate, uom_id, note, sort_order)
    values (
      v_id,
      (v_line->>'item_id')::uuid,
      nullif(v_line->>'store_id', '')::uuid,
      nullif(upper(btrim(v_line->>'lot_no')), ''),
      nullif(upper(btrim(v_line->>'ref_no')), ''),
      nullif(v_line->>'ref_date', '')::date,
      nullif(v_line->>'bags', '')::numeric,
      nullif(v_line->>'bag_weight', '')::numeric,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      nullif(v_line->>'rate', '')::numeric,
      nullif(v_line->>'uom_id', '')::uuid,
      nullif(btrim(v_line->>'note'), ''),
      v_i)
    returning id into v_line_id;
    v_j := 0;
    for v_bin in select * from jsonb_array_elements(coalesce(v_line->'bins', '[]'::jsonb)) loop
      insert into public.opening_stock_line_bins (line_id, bin_id, qty, sort_order)
      values (v_line_id, (v_bin->>'bin_id')::uuid, (v_bin->>'qty')::numeric, v_j);
      v_j := v_j + 1;
    end loop;
    v_i := v_i + 1;
  end loop;

  if p_post then perform public.opening_stock_post(v_id); end if;
  return v_id;
end;
$$;
revoke all on function public.opening_stock_save(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.opening_stock_save(uuid, jsonb, jsonb, boolean) to authenticated;

-- ---------- Stock Statement: an opening layer carries its own group, order and status ----------
-- Body copied from 0793 (latest). Changes: `os` joins the opening document behind an
-- `opening_stock` row; the order ids are coalesced through `o` so every downstream CASE and
-- join reads the PO line's order OR the opening document's; the status CASE reads the
-- document's stock_type for an opening row in the Rejection store.
create or replace function public.report_stock_statement__all_units(p_as_of date, p_location uuid)
returns table (
  layer_id uuid, location_id uuid, unit_name text,
  store_id uuid, store_name text, store_type text, bin_id uuid, bin_code text,
  item_id uuid, item_name text, item_class_id uuid, item_class text, uom_code text,
  lot_no text, source_type text, grn_id uuid, grn_code text, in_date date, age_days int,
  po_id uuid, po_code text, vendor_id uuid, vendor_name text,
  group_kind text, order_id uuid, order_no text, customer_id uuid, customer_name text,
  stock_status text, qty_on_hand numeric, rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sl.id, sl.location_id, loc.name,
    sl.store_id, st.name, st.store_type, sl.bin_id, b.bin_code,
    sl.item_id, it.name, it.item_class_id, cls.name, u.code,
    sl.lot_no,
    case
      when sl.reference_type = 'grn' then 'grn'
      when sl.reference_type = 'opening_stock' then 'opening'
      when sl.movement_type = 'transfer_in' or sl.reference_type = 'delivery_challan' then 'transfer'
      when sl.reference_type = 'dc_receipt' then 'process_receipt'
      when sl.movement_type = 'adjust_in' then 'adjust'
      when sl.movement_type = 'return' then 'return'
      else 'other'
    end,
    g.id, g.code, sl.txn_date, (p_as_of - sl.txn_date)::int,
    po.id, po.code, coalesce(po.master_vendor_id, g.master_vendor_id), mv.name,
    case
      when o.gid is not null then 're'
      when o.iid is not null and sg.id is not null then 'swo'
      when o.iid is not null then 'iwo'
      else 'general'
    end,
    coalesce(o.gid, o.iid),
    case
      when o.gid is not null then so.order_number
      when sg.id is not null then sg.group_code || ' · ' || w.code
      else w.code
    end,
    ga.customer_id,
    case
      when o.gid is not null then cu.name
      when sg.id is not null then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample')
    end,
    case
      when st.store_type = 'rejection' and os.id is not null then
        case when os.stock_type = 'rejected' then 'rejected' else 'replacement' end
      when st.store_type = 'rejection' and coalesce(gl.rejection_action, 'replace') = 'return' then 'rejected'
      when st.store_type = 'rejection' then 'replacement'
      when st.store_type = 'processing' then 'processing'
      when st.store_type = 'transit' then 'transit'
      else 'accepted'
    end,
    lay.qty_on_hand,
    coalesce(sl.rate, pl.unit_price, public.resolve_item_rate(sl.item_id, p_as_of))
  from public.report_stock_layers__all_units(p_as_of, p_location) lay
  join public.stock_ledger sl on sl.id = lay.ledger_id
  join public.stores st on st.id = sl.store_id
  left join public.locations loc on loc.id = sl.location_id
  left join public.bins b on b.id = sl.bin_id
  left join public.items it on it.id = sl.item_id
  left join public.config_lookups cls on cls.id = it.item_class_id
  left join public.uoms u on u.id = coalesce(sl.uom_id, it.uom_id)
  left join public.grns g on sl.reference_type = 'grn' and g.id = sl.reference_id
  left join public.opening_stocks os on sl.reference_type = 'opening_stock' and os.id = sl.reference_id
  -- the GRN line this row was posted from: same item, the rejected line for a
  -- rejection-store row, the line's own bin for a bin row
  left join lateral (
    select gl.*
      from public.grn_line_items gl
      left join public.po_line_items p2 on p2.id = gl.po_line_item_id
     where gl.grn_id = g.id
       and coalesce(gl.item_id, p2.item_id) = sl.item_id
     order by ((st.store_type = 'rejection') = (coalesce(gl.rejected_qty, 0) > 0)) desc,
              (gl.bin_id is not distinct from sl.bin_id) desc,
              gl.sort_order
     limit 1
  ) gl on true
  left join public.po_line_items pl on pl.id = gl.po_line_item_id
  -- the order behind the layer: the PO line's, else the opening document's (0801)
  left join lateral (
    select coalesce(pl.garment_order_id, os.garment_order_id) as gid,
           coalesce(pl.iwo_id, os.iwo_id) as iid
  ) o on true
  left join public.purchase_orders po on po.id = pl.purchase_order_id
  left join public.master_vendors mv on mv.id = coalesce(po.master_vendor_id, g.master_vendor_id)
  left join public.garment_order_amendments ga on ga.id = o.gid
  left join public.sales_orders so on so.id = coalesce(pl.sales_order_id, ga.sales_order_id)
  left join public.customers cu on cu.id = ga.customer_id
  left join public.internal_work_orders w on w.id = o.iid
  left join public.sample_product_groups sg on sg.accessories_iwo_id = o.iid
$$;
revoke all on function public.report_stock_statement__all_units(date, uuid) from public, anon, authenticated;
