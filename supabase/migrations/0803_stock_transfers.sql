-- 0803 · STOCK TRANSFER — phase 2 (doc/stores/stock-transfer-plan.md; user 2026-11-03
-- "go with your recommendations on all three" → "okay do").
--
-- One document moves stock between OWNERS (General Stock ↔ RE / IWO / SWO) and / or between
-- STORES of one unit — the legacy "Material Transfer Entry". It replaces the old two-insert
-- transferStock(), which could leave half a transfer behind.
--
--   draft → posted     stock_transfer_post: per line, a transfer_out from the source layer and
--                      a transfer_in to the target — every line or none, in one transaction
--   draft → cancelled  nothing moved; read-only after
--
-- WHAT IS ENFORCED HERE, NOT JUST ON THE SCREEN
--   * the four types, and what each needs:
--       general_to_order   General → an RE / IWO / SWO
--       order_to_order     one order → another (Remarks mandatory)
--       order_to_general   an order's leftover → General (Remarks mandatory, the order CLOSED:
--                          RE = sales order shipped / closed / cancelled or an Order Completion
--                          entry; IWO / SWO = completed / cancelled) — user decision 2
--       store_to_store     same owner, another store
--     No approval step (user decision 1).
--   * a line names a LAYER (a stock_ledger row still holding stock, 0793) of the From store
--     and the From owner; qty ≤ that layer's balance on the transfer date AND today, checked
--     with the store · item balance row locked so two posts cannot both take the last kg;
--   * rate is the layer's, never typed; both legs post at it, so value is moved, not made;
--   * Processing and In Transit stores are refused — stock there belongs to a DC in flight;
--   * only stock_transfer_post can set `posted` (transaction-local flag, 0795's shape).
--
-- FIFO KEEPS THE RECEIPT (plan §1.3). Both legs carry origin_ledger_id = the receipt the stock
-- first came in on. report_stock_layers__all_units now (a) files an incoming transfer at its
-- receipt's date, not the transfer's, and (b) drains a transfer_out from layers of that receipt
-- and owner first. report_stock_statement__all_units reads GRN, in-date, age, PO and vendor
-- off the receipt, and the order off the LAYER's own owner (0802). Re-created from 0801's body,
-- the latest; verified to return the same rows for every existing layer.
--
-- RAISE PO. A transfer line may name the target order's requirement line (req_key, the key PO
-- lines and 0799 closures use); po_requirement_lines then subtracts the posted qty from that
-- line's balance like ordered and closed qty. Patched IN PLACE on its live body (anchors
-- asserted) rather than re-created from a file copy, so a newer body is never overwritten.
--
-- Bags and cones / rolls are printed only (user decision 3) — never a balance.

-- =============================================================================
-- 1. Tables
-- =============================================================================
create sequence if not exists public.seq_stock_transfer;

create table if not exists public.stock_transfers (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                                       -- STR-0001
  transfer_date          date not null default current_date,
  transfer_type          text not null
                           check (transfer_type in ('general_to_order', 'order_to_order', 'order_to_general', 'store_to_store')),
  from_store_id          uuid not null references public.stores(id),
  to_store_id            uuid not null references public.stores(id),
  from_garment_order_id  uuid references public.garment_order_amendments(id),
  from_iwo_id            uuid references public.internal_work_orders(id),
  to_garment_order_id    uuid references public.garment_order_amendments(id),
  to_iwo_id              uuid references public.internal_work_orders(id),
  remarks                text,
  status                 text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  posted_at              timestamptz,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (from_garment_order_id is null or from_iwo_id is null),
  check (to_garment_order_id is null or to_iwo_id is null)
);
create index if not exists idx_str_from_store on public.stock_transfers(from_store_id);
create index if not exists idx_str_to_store   on public.stock_transfers(to_store_id);
create index if not exists idx_str_to_re      on public.stock_transfers(to_garment_order_id) where to_garment_order_id is not null;
create index if not exists idx_str_to_iwo     on public.stock_transfers(to_iwo_id) where to_iwo_id is not null;
create index if not exists idx_str_from_re    on public.stock_transfers(from_garment_order_id) where from_garment_order_id is not null;
create index if not exists idx_str_from_iwo   on public.stock_transfers(from_iwo_id) where from_iwo_id is not null;
create index if not exists idx_str_status     on public.stock_transfers(status);

drop trigger if exists trg_str_code on public.stock_transfers;
create trigger trg_str_code before insert on public.stock_transfers
  for each row execute function public.assign_code('STR', 'public.seq_stock_transfer');
drop trigger if exists trg_str_updated on public.stock_transfers;
create trigger trg_str_updated before update on public.stock_transfers
  for each row execute function public.set_updated_at();

create table if not exists public.stock_transfer_lines (
  id               uuid primary key default gen_random_uuid(),
  transfer_id      uuid not null references public.stock_transfers(id) on delete cascade,
  source_ledger_id uuid not null references public.stock_ledger(id),   -- the LAYER drawn from
  item_id          uuid not null references public.items(id),          -- copied from the layer
  quantity         numeric(14,3) not null check (quantity > 0),
  to_bin_id        uuid references public.bins(id),
  req_key          text,                                               -- target order's requirement line
  bags             integer check (bags is null or bags >= 0),          -- printed only
  cones            integer check (cones is null or cones >= 0),        -- cones (yarn) / rolls (fabric); printed only
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (transfer_id, source_ledger_id)
);
create index if not exists idx_str_lines_transfer on public.stock_transfer_lines(transfer_id);
create index if not exists idx_str_lines_source   on public.stock_transfer_lines(source_ledger_id);
create index if not exists idx_str_lines_bin      on public.stock_transfer_lines(to_bin_id);
create index if not exists idx_str_lines_item     on public.stock_transfer_lines(item_id);

drop trigger if exists trg_str_lines_updated on public.stock_transfer_lines;
create trigger trg_str_lines_updated before update on public.stock_transfer_lines
  for each row execute function public.set_updated_at();

comment on table public.stock_transfers is
  'Stock Transfer (0803): moves stock between owners (General ↔ RE / IWO / SWO) and / or stores of one unit. Posted only by stock_transfer_post.';
comment on column public.stock_transfer_lines.bags is 'Printed on the slip only (user 2026-11-03) — never a stock balance.';
comment on column public.stock_transfer_lines.cones is 'Cones (yarn) or rolls (fabric). Printed only — never a stock balance.';

-- =============================================================================
-- 2. Is an order closed? (Release to General Stock — user decision 2)
-- =============================================================================
create or replace function public.stock_owner_is_closed(p_garment_order_id uuid, p_iwo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_iwo_id is not null then exists (
      select 1 from public.internal_work_orders w
       where w.id = p_iwo_id and w.status in ('completed', 'cancelled'))
    when p_garment_order_id is not null then exists (
      select 1 from public.garment_order_amendments g
        join public.sales_orders so on so.id = g.sales_order_id
       where g.id = p_garment_order_id
         and (so.status in ('shipped', 'closed', 'cancelled')
              or exists (select 1 from public.order_completions c where c.order_id = so.id)))
    else false
  end
$$;
revoke all on function public.stock_owner_is_closed(uuid, uuid) from public, anon;
grant execute on function public.stock_owner_is_closed(uuid, uuid) to authenticated;

-- =============================================================================
-- 3. Header guard
-- =============================================================================
create or replace function public.stock_transfer_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from_type text;
  v_to_type   text;
  v_from_loc  uuid;
  v_to_loc    uuid;
  v_has_from  boolean;
  v_has_to    boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'A posted stock transfer cannot be deleted — the stock has moved';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'This stock transfer is % — it can no longer be changed', old.status;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.posted_at := null;
  elsif new.status = 'posted' and old.status = 'draft' then
    if coalesce(current_setting('raagam.str_posting', true), '') <> new.id::text then
      raise exception 'Post a stock transfer with Post — it moves the stock';
    end if;
    return new;
  elsif new.status <> old.status and not (old.status = 'draft' and new.status = 'cancelled') then
    raise exception 'A stock transfer cannot move from % to %', old.status, new.status;
  end if;

  select s.store_type, s.location_id into v_from_type, v_from_loc from public.stores s where s.id = new.from_store_id;
  select s.store_type, s.location_id into v_to_type,   v_to_loc   from public.stores s where s.id = new.to_store_id;
  if v_from_type in ('processing', 'transit') or v_to_type in ('processing', 'transit') then
    raise exception 'Stock in a Processing or In Transit store belongs to a DC — move it with the DC, not a transfer';
  end if;
  if v_from_loc is distinct from v_to_loc then
    raise exception 'Both stores must be in the same unit — use a Production DC to move stock between units';
  end if;

  v_has_from := new.from_garment_order_id is not null or new.from_iwo_id is not null;
  v_has_to   := new.to_garment_order_id is not null or new.to_iwo_id is not null;

  if new.transfer_type = 'store_to_store' then
    if new.from_store_id = new.to_store_id then
      raise exception 'Pick a different To store — a store-to-store transfer moves stock between two stores';
    end if;
    -- The owner travels with the stock.
    new.to_garment_order_id := new.from_garment_order_id;
    new.to_iwo_id := new.from_iwo_id;
  elsif new.transfer_type = 'general_to_order' then
    if v_has_from then raise exception 'General → Order draws from General Stock — clear the From order'; end if;
    if not v_has_to then raise exception 'Pick the order the stock goes to'; end if;
  elsif new.transfer_type = 'order_to_order' then
    if not v_has_from then raise exception 'Pick the order the stock comes from'; end if;
    if not v_has_to then raise exception 'Pick the order the stock goes to'; end if;
    if new.from_garment_order_id is not distinct from new.to_garment_order_id
       and new.from_iwo_id is not distinct from new.to_iwo_id then
      raise exception 'From and To are the same order — nothing would move';
    end if;
  elsif new.transfer_type = 'order_to_general' then
    if not v_has_from then raise exception 'Pick the order whose leftover stock is released'; end if;
    new.to_garment_order_id := null;
    new.to_iwo_id := null;
  end if;

  new.remarks := nullif(upper(btrim(coalesce(new.remarks, ''))), '');
  if new.transfer_type in ('order_to_order', 'order_to_general') and new.remarks is null then
    raise exception 'Remarks are required — this moves cost from one order''s books';
  end if;
  return new;
end;
$$;
revoke all on function public.stock_transfer_guard() from public, anon;

drop trigger if exists trg_str_guard on public.stock_transfers;
create trigger trg_str_guard before insert or update or delete on public.stock_transfers
  for each row execute function public.stock_transfer_guard();

-- =============================================================================
-- 4. Line guard — parent draft; item comes from the layer; the layer is the From store's
--    and the From owner's; the bin is the To store's.
-- =============================================================================
create or replace function public.stock_transfer_line_guard()
returns trigger
language plpgsql
-- DEFINER: reads the source ledger row and the bin past the caller's per-store RLS.
security definer
set search_path = ''
as $$
declare
  h   record;
  src record;
  v_bin_store uuid;
begin
  select t.* into h from public.stock_transfers t
   where t.id = case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;   -- cascade from a deleted header
  end if;
  if h.status <> 'draft' then
    raise exception 'This stock transfer is % — its lines can no longer be changed', h.status;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select sl.* into src from public.stock_ledger sl where sl.id = new.source_ledger_id;
  if not found then
    raise exception 'The stock picked on a line no longer exists';
  end if;
  if src.store_id <> h.from_store_id then
    raise exception 'A line''s stock is not in the From store';
  end if;
  if src.garment_order_id is distinct from h.from_garment_order_id or src.iwo_id is distinct from h.from_iwo_id then
    raise exception 'A line''s stock does not belong to the From owner';
  end if;
  new.item_id := src.item_id;

  if new.to_bin_id is not null then
    select b.store_id into v_bin_store from public.bins b where b.id = new.to_bin_id;
    if v_bin_store is distinct from h.to_store_id then
      raise exception 'The To bin is not in the To store';
    end if;
  end if;

  new.req_key := nullif(upper(btrim(coalesce(new.req_key, ''))), '');
  if new.req_key is not null then
    if h.to_garment_order_id is null and h.to_iwo_id is null then
      raise exception 'A requirement line can only be named when the stock goes to an order';
    end if;
    if split_part(new.req_key, '|', 1) <> upper(new.item_id::text) then
      raise exception 'The requirement line is for a different item';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stock_transfer_line_guard() from public, anon;

drop trigger if exists trg_str_lines_guard on public.stock_transfer_lines;
create trigger trg_str_lines_guard before insert or update or delete on public.stock_transfer_lines
  for each row execute function public.stock_transfer_line_guard();

-- =============================================================================
-- 5. Unit predicate + RLS (0795's shape; line DELETE follows edit — 0678)
-- =============================================================================
create or replace function public.lv_stock_transfers(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select p_id is null or exists (select 1 from public.stock_transfers x where x.id = p_id and public.lv_stores(x.from_store_id)) $$;
revoke all on function public.lv_stock_transfers(uuid) from public, anon;
grant execute on function public.lv_stock_transfers(uuid) to authenticated;

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

drop policy if exists stock_transfers_read on public.stock_transfers;
create policy stock_transfers_read on public.stock_transfers for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_stores(from_store_id));
drop policy if exists stock_transfers_insert on public.stock_transfers;
create policy stock_transfers_insert on public.stock_transfers for insert to authenticated
  with check (public.has_permission('stores', 'create') and public.lv_stores(from_store_id) and public.lv_stores(to_store_id));
drop policy if exists stock_transfers_update on public.stock_transfers;
create policy stock_transfers_update on public.stock_transfers for update to authenticated
  using (public.has_permission('stores', 'edit') and public.lv_stores(from_store_id))
  with check (public.has_permission('stores', 'edit') and public.lv_stores(from_store_id) and public.lv_stores(to_store_id));
drop policy if exists stock_transfers_delete on public.stock_transfers;
create policy stock_transfers_delete on public.stock_transfers for delete to authenticated
  using (public.has_permission('stores', 'delete') and public.lv_stores(from_store_id));

drop policy if exists stock_transfer_lines_read on public.stock_transfer_lines;
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_stock_transfers(transfer_id));
drop policy if exists stock_transfer_lines_insert on public.stock_transfer_lines;
create policy stock_transfer_lines_insert on public.stock_transfer_lines for insert to authenticated
  with check ((public.has_permission('stores', 'create') or public.has_permission('stores', 'edit'))
              and public.lv_stock_transfers(transfer_id));
drop policy if exists stock_transfer_lines_update on public.stock_transfer_lines;
create policy stock_transfer_lines_update on public.stock_transfer_lines for update to authenticated
  using (public.has_permission('stores', 'edit') and public.lv_stock_transfers(transfer_id))
  with check (public.has_permission('stores', 'edit') and public.lv_stock_transfers(transfer_id));
drop policy if exists stock_transfer_lines_delete on public.stock_transfer_lines;
create policy stock_transfer_lines_delete on public.stock_transfer_lines for delete to authenticated
  using ((public.has_permission('stores', 'edit') or public.has_permission('stores', 'delete'))
         and public.lv_stock_transfers(transfer_id));

-- =============================================================================
-- 6. FIFO engine — a transfer keeps its receipt's place in the queue (body from 0793)
-- =============================================================================
create or replace function public.report_stock_layers__all_units(p_as_of date, p_location uuid)
returns table (ledger_id uuid, qty_on_hand numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  k_store uuid;
  k_item uuid;
  l_id   uuid[] := '{}';
  l_bin  uuid[] := '{}';
  l_lot  text[] := '{}';
  l_rem  numeric[] := '{}';
  l_root uuid[] := '{}';   -- the receipt the layer descends from (0803)
  l_key  date[] := '{}';   -- that receipt's date: the layer's place in the FIFO queue
  l_re   uuid[] := '{}';   -- owner (0802)
  l_iwo  uuid[] := '{}';
  v_debt numeric := 0;
  v_need numeric;
  v_take numeric;
  v_pos  int;
  v_ok   boolean;
  i int;
  pass int;
begin
  for r in
    select sl.id, sl.store_id, sl.item_id, sl.bin_id, sl.lot_no, sl.quantity,
           sl.garment_order_id, sl.iwo_id,
           coalesce(sl.origin_ledger_id, sl.id) as root,
           sl.origin_ledger_id is not null as has_origin,
           coalesce(src.txn_date, sl.txn_date) as key_date,
           sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') as is_in
      from public.stock_ledger sl
      left join public.stock_ledger src on src.id = sl.origin_ledger_id
     where sl.txn_date <= p_as_of
       and (p_location is null or sl.location_id = p_location)
     order by sl.store_id, sl.item_id, sl.txn_date, sl.created_at, sl.id
  loop
    if k_store is distinct from r.store_id or k_item is distinct from r.item_id then
      for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
        if l_rem[i] > 0 then
          ledger_id := l_id[i]; qty_on_hand := l_rem[i]; return next;
        end if;
      end loop;
      k_store := r.store_id; k_item := r.item_id;
      l_id := '{}'; l_bin := '{}'; l_lot := '{}'; l_rem := '{}';
      l_root := '{}'; l_key := '{}'; l_re := '{}'; l_iwo := '{}';
      v_debt := 0;
    end if;

    if r.is_in then
      v_take := least(v_debt, r.quantity);
      v_debt := v_debt - v_take;
      -- File the layer after every layer dated on or before its receipt. A normal inflow lands
      -- at the end (rows arrive in date order); a transfer lands where its receipt stood.
      v_pos := 1;
      for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
        if l_key[i] <= r.key_date then v_pos := i + 1; end if;
      end loop;
      l_id   := l_id[1:v_pos - 1]   || r.id               || l_id[v_pos:];
      l_bin  := l_bin[1:v_pos - 1]  || r.bin_id           || l_bin[v_pos:];
      l_lot  := l_lot[1:v_pos - 1]  || r.lot_no           || l_lot[v_pos:];
      l_rem  := l_rem[1:v_pos - 1]  || (r.quantity - v_take) || l_rem[v_pos:];
      l_root := l_root[1:v_pos - 1] || r.root             || l_root[v_pos:];
      l_key  := l_key[1:v_pos - 1]  || r.key_date         || l_key[v_pos:];
      l_re   := l_re[1:v_pos - 1]   || r.garment_order_id || l_re[v_pos:];
      l_iwo  := l_iwo[1:v_pos - 1]  || r.iwo_id           || l_iwo[v_pos:];
    else
      v_need := r.quantity;
      -- pass 0: a transfer_out drains its own receipt's layers of its own owner (0803)
      -- pass 1: an outflow naming a bin / lot drains those, same owner (0793 + owner)
      -- pass 2: any layer of the same owner
      -- pass 3: any layer (a back-dated document, or an outflow nobody owned)
      for pass in 0 .. 3 loop
        exit when v_need <= 0;
        continue when pass = 0 and not r.has_origin;
        continue when pass = 1 and r.bin_id is null and r.lot_no is null;
        for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
          exit when v_need <= 0;
          continue when l_rem[i] <= 0;
          v_ok := case pass
            when 3 then true
            else l_re[i] is not distinct from r.garment_order_id
             and l_iwo[i] is not distinct from r.iwo_id
             and case pass
                   when 0 then l_root[i] = r.root and (r.bin_id is null or l_bin[i] is not distinct from r.bin_id)
                   when 1 then (r.bin_id is null or l_bin[i] is not distinct from r.bin_id)
                           and (r.lot_no is null or l_lot[i] is not distinct from r.lot_no)
                   else true
                 end
          end;
          if v_ok then
            v_take := least(l_rem[i], v_need);
            l_rem[i] := l_rem[i] - v_take;
            v_need := v_need - v_take;
          end if;
        end loop;
      end loop;
      v_debt := v_debt + greatest(v_need, 0);
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
    if l_rem[i] > 0 then
      ledger_id := l_id[i]; qty_on_hand := l_rem[i]; return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.report_stock_layers__all_units(date, uuid) from public, anon, authenticated;

-- =============================================================================
-- 7. Stock Statement — provenance from the RECEIPT, owner from the LAYER (body from 0801)
-- =============================================================================
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
      when src.reference_type = 'grn' then 'grn'
      when src.reference_type = 'opening_stock' then 'opening'
      when src.movement_type = 'transfer_in' or src.reference_type = 'delivery_challan' then 'transfer'
      when src.reference_type = 'dc_receipt' then 'process_receipt'
      when src.movement_type = 'adjust_in' then 'adjust'
      when src.movement_type = 'return' then 'return'
      else 'other'
    end,
    g.id, g.code, src.txn_date, (p_as_of - src.txn_date)::int,
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
    coalesce(sl.rate, src.rate, pl.unit_price, public.resolve_item_rate(sl.item_id, p_as_of))
  from public.report_stock_layers__all_units(p_as_of, p_location) lay
  join public.stock_ledger sl on sl.id = lay.ledger_id
  -- the receipt the layer descends from (itself, unless it arrived by transfer — 0803)
  join public.stock_ledger src on src.id = coalesce(sl.origin_ledger_id, sl.id)
  join public.stores st on st.id = sl.store_id
  join public.stores src_st on src_st.id = src.store_id
  left join public.locations loc on loc.id = sl.location_id
  left join public.bins b on b.id = sl.bin_id
  left join public.items it on it.id = sl.item_id
  left join public.config_lookups cls on cls.id = it.item_class_id
  left join public.uoms u on u.id = coalesce(sl.uom_id, it.uom_id)
  left join public.grns g on src.reference_type = 'grn' and g.id = src.reference_id
  left join public.opening_stocks os on src.reference_type = 'opening_stock' and os.id = src.reference_id
  -- the GRN line the receipt was posted from: same item, the rejected line for a
  -- rejection-store row, the line's own bin for a bin row
  left join lateral (
    select gl.*
      from public.grn_line_items gl
      left join public.po_line_items p2 on p2.id = gl.po_line_item_id
     where gl.grn_id = g.id
       and coalesce(gl.item_id, p2.item_id) = sl.item_id
     order by ((src_st.store_type = 'rejection') = (coalesce(gl.rejected_qty, 0) > 0)) desc,
              (gl.bin_id is not distinct from src.bin_id) desc,
              gl.sort_order
     limit 1
  ) gl on true
  left join public.po_line_items pl on pl.id = gl.po_line_item_id
  -- the order the stock BELONGS TO now: the layer's own owner (0802 stamps every row; a
  -- transfer states it), not the order it was first bought for
  left join lateral (
    select sl.garment_order_id as gid, sl.iwo_id as iid
  ) o on true
  left join public.purchase_orders po on po.id = pl.purchase_order_id
  left join public.master_vendors mv on mv.id = coalesce(po.master_vendor_id, g.master_vendor_id)
  left join public.garment_order_amendments ga on ga.id = o.gid
  left join public.sales_orders so on so.id = case when o.gid is not null then coalesce(ga.sales_order_id, pl.sales_order_id) end
  left join public.customers cu on cu.id = ga.customer_id
  left join public.internal_work_orders w on w.id = o.iid
  left join public.sample_product_groups sg on sg.accessories_iwo_id = o.iid
$$;
revoke all on function public.report_stock_statement__all_units(date, uuid) from public, anon, authenticated;

-- =============================================================================
-- 8. The layers a transfer can draw from — the screen's picker
-- =============================================================================
create or replace function public.stock_transfer_layers(
  p_store_id uuid,
  p_garment_order_id uuid default null,
  p_iwo_id uuid default null,
  p_as_of date default current_date
)
returns table (
  layer_id uuid, item_id uuid, item_name text, item_class text, category text, uom_code text,
  bin_id uuid, bin_code text, lot_no text, grn_code text, in_date date, age_days int,
  qty_on_hand numeric, rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money boolean;
begin
  if not public.has_permission('stores', 'view') then
    raise exception 'Forbidden';
  end if;
  -- Rate (and so value) only to whoever may see the money on Stock Statement with Value (0793).
  v_money := public.can_view_report_screen('/reports/stock-statement-value');
  return query
    select s.layer_id, s.item_id, s.item_name, s.item_class, cat.name, s.uom_code,
           s.bin_id, s.bin_code, s.lot_no, s.grn_code, s.in_date, s.age_days,
           s.qty_on_hand, case when v_money then s.rate end
      from public.report_stock_statement__all_units(least(coalesce(p_as_of, current_date), current_date), public.current_location()) s
      join public.stock_ledger sl on sl.id = s.layer_id
      left join public.items it on it.id = s.item_id
      left join public.categories cat on cat.id = it.category_id
     where s.store_id = p_store_id
       and public.lv_stores(s.store_id)
       and sl.garment_order_id is not distinct from p_garment_order_id
       and sl.iwo_id is not distinct from p_iwo_id
       and s.qty_on_hand > 0
     order by s.item_name, s.in_date, s.lot_no;
end;
$$;
revoke all on function public.stock_transfer_layers(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.stock_transfer_layers(uuid, uuid, uuid, date) to authenticated;

-- =============================================================================
-- 9. Post — every line or none
-- =============================================================================
create or replace function public.stock_transfer_post(p_id uuid)
returns void
language plpgsql
-- DEFINER: reads the FIFO engine (never granted) and writes both legs of each line; makes the
-- two checks RLS would have made — stores:edit, and both stores in the caller's current unit.
security definer
set search_path = ''
as $$
declare
  h        record;
  l        record;
  src      record;
  v_root   uuid;
  v_avail  numeric;
  v_now    numeric;
  v_rate   numeric;
  v_uom    uuid;
  v_label  text;
  v_n      int := 0;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'Forbidden';
  end if;

  select * into h from public.stock_transfers where id = p_id for update;
  if not found then
    raise exception 'Stock transfer not found';
  end if;
  if h.status <> 'draft' then
    raise exception 'Only a draft stock transfer can be posted (this one is %)', h.status;
  end if;
  if not (public.lv_stores(h.from_store_id) and public.lv_stores(h.to_store_id)) then
    raise exception 'This transfer is not in the unit you are working in';
  end if;
  if h.transfer_date > current_date then
    raise exception 'A transfer cannot be dated in the future';
  end if;
  if h.transfer_type = 'order_to_general'
     and not public.stock_owner_is_closed(h.from_garment_order_id, h.from_iwo_id) then
    raise exception 'The order is still open — its stock can be released to General Stock once the order is closed (or move it to another order)';
  end if;

  -- One store · item at a time: lock every balance row this post drains, in a fixed order.
  perform 1
     from public.stock_balances bal
    where bal.store_id = h.from_store_id
      and bal.item_id in (select x.item_id from public.stock_transfer_lines x where x.transfer_id = p_id)
    order by bal.item_id
      for update;

  -- What each layer holds on the transfer date and today (a back-dated transfer must not take
  -- stock a later document already used).
  create temporary table if not exists pg_temp._str_avail (layer_id uuid primary key, at_date numeric, now_qty numeric) on commit drop;
  delete from pg_temp._str_avail;
  insert into pg_temp._str_avail (layer_id, at_date)
    select a.ledger_id, a.qty_on_hand from public.report_stock_layers__all_units(h.transfer_date, public.current_location()) a;
  insert into pg_temp._str_avail (layer_id, now_qty)
    select a.ledger_id, a.qty_on_hand from public.report_stock_layers__all_units(current_date, public.current_location()) a
  on conflict (layer_id) do update set now_qty = excluded.now_qty;

  for l in
    select x.*, it.name as item_name
      from public.stock_transfer_lines x
      join public.items it on it.id = x.item_id
     where x.transfer_id = p_id
     order by x.sort_order, x.created_at
  loop
    select sl.* into src from public.stock_ledger sl where sl.id = l.source_ledger_id;
    if src.store_id <> h.from_store_id
       or src.garment_order_id is distinct from h.from_garment_order_id
       or src.iwo_id is distinct from h.from_iwo_id then
      raise exception '%: the stock picked is no longer the From store''s / owner''s', l.item_name;
    end if;

    select coalesce(a.at_date, 0), coalesce(a.now_qty, 0) into v_avail, v_now
      from pg_temp._str_avail a where a.layer_id = l.source_ledger_id;
    v_avail := least(coalesce(v_avail, 0), coalesce(v_now, 0));
    v_label := l.item_name || coalesce(' · lot ' || src.lot_no, '');
    if l.quantity > v_avail then
      raise exception '%: only % left in that stock on % — transfer qty is %',
        v_label, round(v_avail, 3), to_char(h.transfer_date, 'DD/MM/YYYY'), l.quantity;
    end if;

    v_root := coalesce(src.origin_ledger_id, src.id);
    select coalesce(sl.rate, r.rate) into v_rate
      from public.stock_ledger sl
      left join public.stock_ledger r on r.id = v_root
     where sl.id = src.id;
    if v_rate is null then
      select s.rate into v_rate
        from public.report_stock_statement__all_units(h.transfer_date, public.current_location()) s
       where s.layer_id = src.id;
    end if;
    v_uom := src.uom_id;

    insert into public.stock_ledger
      (store_id, bin_id, item_id, lot_no, movement_type, quantity, txn_date, rate, value, uom_id,
       location_id, counterparty_store_id, reference_type, reference_id, note,
       garment_order_id, iwo_id, origin_ledger_id)
    values
      (h.from_store_id, src.bin_id, l.item_id, src.lot_no, 'transfer_out', l.quantity, h.transfer_date,
       v_rate, round(l.quantity * coalesce(v_rate, 0), 2), v_uom,
       src.location_id, h.to_store_id, 'stock_transfer', p_id, 'Stock transfer ' || coalesce(h.code, ''),
       h.from_garment_order_id, h.from_iwo_id, v_root);

    insert into public.stock_ledger
      (store_id, bin_id, item_id, lot_no, movement_type, quantity, txn_date, rate, value, uom_id,
       location_id, counterparty_store_id, reference_type, reference_id, note,
       garment_order_id, iwo_id, origin_ledger_id)
    values
      (h.to_store_id,
       coalesce(l.to_bin_id, case when h.to_store_id = h.from_store_id then src.bin_id end),
       l.item_id, src.lot_no, 'transfer_in', l.quantity, h.transfer_date,
       v_rate, round(l.quantity * coalesce(v_rate, 0), 2), v_uom,
       src.location_id, h.from_store_id, 'stock_transfer', p_id, 'Stock transfer ' || coalesce(h.code, ''),
       h.to_garment_order_id, h.to_iwo_id, v_root);

    -- the next line drawing the same layer sees what this one left
    update pg_temp._str_avail set at_date = at_date - l.quantity, now_qty = now_qty - l.quantity
     where layer_id = l.source_ledger_id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Add at least one line before posting';
  end if;

  perform set_config('raagam.str_posting', p_id::text, true);
  update public.stock_transfers set status = 'posted', posted_at = now() where id = p_id;
  perform set_config('raagam.str_posting', '', true);
end;
$$;
revoke all on function public.stock_transfer_post(uuid) from public, anon;
grant execute on function public.stock_transfer_post(uuid) to authenticated;

-- 0802's resolver learns the new reference: a caller always states the owner on a transfer,
-- so nothing to resolve — listed so the next reader does not wonder.
comment on function public.stock_owner_for(text, uuid, uuid) is
  'Owner of a ledger row from its document (0802). stock_transfer rows state their owner explicitly (0803).';

-- =============================================================================
-- 10. Raise PO: a posted transfer into an order answers its requirement line
--     (patched in place on the live body — every anchor must be found)
-- =============================================================================
do $mig$
declare
  v_def text := pg_get_functiondef('public.po_requirement_lines(uuid[])'::regprocedure);
  v_new text;
  a1 text := E'    from public.po_requirement_closures c\n    group by 1, 2\n  )';
  a2 text := '- coalesce(closed.q, 0), 0)';
  a3 text := E'  left join closed on closed.source_id = grp.source_id and closed.req_key = grp.req_key\n';
begin
  if position('transferred as (' in v_def) > 0 then
    raise notice 'po_requirement_lines already subtracts transfers — skipped';
    return;
  end if;
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 then
    raise exception 'po_requirement_lines has changed since 0799 — patch it by hand from its latest body';
  end if;
  v_new := replace(v_def, a1, a1 || E',\n  transferred as (\n'
    || E'    -- 0803: stock moved INTO the order against this requirement line counts like ordered qty\n'
    || E'    select coalesce(t.to_garment_order_id, t.to_iwo_id) as source_id, x.req_key, sum(x.quantity) as q\n'
    || E'    from public.stock_transfer_lines x\n'
    || E'    join public.stock_transfers t on t.id = x.transfer_id\n'
    || E'    where t.status = ''posted'' and x.req_key is not null\n'
    || E'    group by 1, 2\n'
    || E'  )');
  v_new := replace(v_new, a2, '- coalesce(closed.q, 0) - coalesce(transferred.q, 0), 0)');
  v_new := replace(v_new, a3, a3 || E'  left join transferred on transferred.source_id = grp.source_id and transferred.req_key = grp.req_key\n');
  execute v_new;
end
$mig$;
