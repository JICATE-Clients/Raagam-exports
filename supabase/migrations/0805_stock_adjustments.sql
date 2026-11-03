-- 0805 · STOCK ADJUSTMENT (user 2026-11-03, pasted spec on legacy Screenshot 4029 + "stock
-- adjust using our existing screen layout, plan this and implement it").
--
-- Re-aligns the ledger with the scale: yarn and fabric gain weight in the rainy season and lose
-- it in summer, a recount finds more or less than the book. Before this the screen wrote ONE
-- anonymous adjust_in / adjust_out row (store × item × qty) — no lot, no bin, no owner, no
-- value, no document — so an adjustment could not be found again, and an adjust_in started a
-- brand-new FIFO layer aged 0 days.
--
-- SHAPE — Stock Transfer's (0803), minus the "to" side:
--   header   date · stock type (Accepted / Rejected / Replacement) · store · group (General /
--            RE / IWO / SWO, i.e. the stock OWNER, 0802) · remarks (mandatory)
--   line     one LAYER (a lot as it came in, 0793) of that store and owner · Increase or
--            Decrease · reason · qty · bags (printed only)
--   draft → posted     stock_adjustment_post, every line or none
--   draft → cancelled  nothing moved
--
-- WHAT IS ENFORCED HERE, NOT JUST ON THE SCREEN
--   * remarks are required to post — an adjustment changes stock value with no paper behind it;
--   * a line's layer is the header store's and the header owner's, and its status matches the
--     header stock type (Rejected / Replacement live in the Rejection store, 0801's rule);
--   * Decrease ≤ that layer's balance on the adjustment date AND today, with the store · item
--     balance row locked (0803's check);
--   * RATE IS THE LAYER'S, NEVER TYPED, and both directions post with origin_ledger_id = the
--     lot's receipt — so an Increase joins its lot in the FIFO queue at the receipt's date (a
--     moisture gain is not new stock 0 days old) and a Decrease drains that lot first (0803's
--     pass 0). Value moves at the lot's cost: Stock Statement with Value rises and falls with it;
--   * posted is immutable (no delete, no edit) — the spec's audit rule;
--   * Processing / In Transit stores refused — that stock belongs to a DC in flight.

-- =============================================================================
-- 1. Tables
-- =============================================================================
create sequence if not exists public.seq_stock_adjustment;

create table if not exists public.stock_adjustments (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                   -- SA-0001
  adjustment_date   date not null default current_date,
  stock_type        text not null default 'accepted'
                      check (stock_type in ('accepted', 'rejected', 'replacement')),
  store_id          uuid not null references public.stores(id),
  garment_order_id  uuid references public.garment_order_amendments(id),
  iwo_id            uuid references public.internal_work_orders(id),
  remarks           text,
  status            text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  posted_at         timestamptz,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (garment_order_id is null or iwo_id is null)
);
create index if not exists idx_sadj_store  on public.stock_adjustments(store_id);
create index if not exists idx_sadj_re     on public.stock_adjustments(garment_order_id) where garment_order_id is not null;
create index if not exists idx_sadj_iwo    on public.stock_adjustments(iwo_id) where iwo_id is not null;
create index if not exists idx_sadj_status on public.stock_adjustments(status);

drop trigger if exists trg_sadj_code on public.stock_adjustments;
create trigger trg_sadj_code before insert on public.stock_adjustments
  for each row execute function public.assign_code('SA', 'public.seq_stock_adjustment');
drop trigger if exists trg_sadj_updated on public.stock_adjustments;
create trigger trg_sadj_updated before update on public.stock_adjustments
  for each row execute function public.set_updated_at();

create table if not exists public.stock_adjustment_lines (
  id               uuid primary key default gen_random_uuid(),
  adjustment_id    uuid not null references public.stock_adjustments(id) on delete cascade,
  source_ledger_id uuid not null references public.stock_ledger(id),   -- the LAYER adjusted
  item_id          uuid not null references public.items(id),          -- copied from the layer
  direction        text not null check (direction in ('increase', 'decrease')),
  reason           text not null default 'moisture'
                     check (reason in ('moisture', 'recount', 'damage', 'other')),
  quantity         numeric(14,3) not null check (quantity > 0),
  bags             integer check (bags is null or bags >= 0),          -- printed only
  rate             numeric(14,4),                                      -- stamped at post
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (adjustment_id, source_ledger_id)
);
create index if not exists idx_sadj_lines_adj    on public.stock_adjustment_lines(adjustment_id);
create index if not exists idx_sadj_lines_source on public.stock_adjustment_lines(source_ledger_id);
create index if not exists idx_sadj_lines_item   on public.stock_adjustment_lines(item_id);

drop trigger if exists trg_sadj_lines_updated on public.stock_adjustment_lines;
create trigger trg_sadj_lines_updated before update on public.stock_adjustment_lines
  for each row execute function public.set_updated_at();

comment on table public.stock_adjustments is
  'Stock Adjustment (0805): Increase / Decrease a lot (layer) to match the scale — moisture, recount, damage. Posted only by stock_adjustment_post; immutable after.';
comment on column public.stock_adjustment_lines.rate is
  'Stamped by stock_adjustment_post (0805): the lot rate the ledger row was posted at. Null on a draft.';
comment on column public.stock_adjustment_lines.bags is 'Printed only — never a stock balance.';

-- =============================================================================
-- 2. Header guard
-- =============================================================================
create or replace function public.stock_adjustment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'A posted stock adjustment cannot be deleted — the stock has changed';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'This stock adjustment is % — it can no longer be changed', old.status;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.posted_at := null;
  elsif new.status = 'posted' and old.status = 'draft' then
    if coalesce(current_setting('raagam.sadj_posting', true), '') <> new.id::text then
      raise exception 'Post a stock adjustment with Post — it changes the stock';
    end if;
    return new;
  elsif new.status <> old.status and not (old.status = 'draft' and new.status = 'cancelled') then
    raise exception 'A stock adjustment cannot move from % to %', old.status, new.status;
  end if;

  select s.store_type into v_type from public.stores s where s.id = new.store_id;
  if v_type in ('processing', 'transit') then
    raise exception 'Stock in a Processing or In Transit store belongs to a DC — adjust it on the DC';
  end if;
  if new.stock_type = 'accepted' and v_type = 'rejection' then
    raise exception 'Accepted stock is not kept in the Rejection store — pick Rejected or Replacement';
  end if;
  if new.stock_type <> 'accepted' and v_type is distinct from 'rejection' then
    raise exception '% stock is kept in the Rejection store', initcap(new.stock_type);
  end if;

  new.remarks := nullif(upper(btrim(coalesce(new.remarks, ''))), '');
  return new;
end;
$$;
revoke all on function public.stock_adjustment_guard() from public, anon;

drop trigger if exists trg_sadj_guard on public.stock_adjustments;
create trigger trg_sadj_guard before insert or update or delete on public.stock_adjustments
  for each row execute function public.stock_adjustment_guard();

-- =============================================================================
-- 3. Line guard — parent draft; item comes from the layer; the layer is the header store's
--    and the header owner's.
-- =============================================================================
create or replace function public.stock_adjustment_line_guard()
returns trigger
language plpgsql
-- DEFINER: reads the source ledger row past the caller's per-store RLS.
security definer
set search_path = ''
as $$
declare
  h   record;
  src record;
begin
  select a.* into h from public.stock_adjustments a
   where a.id = case when tg_op = 'DELETE' then old.adjustment_id else new.adjustment_id end;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;   -- cascade from a deleted header
  end if;
  -- post stamps each line's rate while the header is still draft: allow exactly that write
  if tg_op = 'UPDATE' and coalesce(current_setting('raagam.sadj_stamping', true), '') = h.id::text then
    return new;
  end if;
  if h.status <> 'draft' then
    raise exception 'This stock adjustment is % — its lines can no longer be changed', h.status;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select sl.* into src from public.stock_ledger sl where sl.id = new.source_ledger_id;
  if not found then
    raise exception 'The stock picked on a line no longer exists';
  end if;
  if src.store_id <> h.store_id then
    raise exception 'A line''s stock is not in the adjustment''s store';
  end if;
  if src.garment_order_id is distinct from h.garment_order_id or src.iwo_id is distinct from h.iwo_id then
    raise exception 'A line''s stock does not belong to the group picked';
  end if;
  new.item_id := src.item_id;
  new.rate := null;   -- stamped by post only
  return new;
end;
$$;
revoke all on function public.stock_adjustment_line_guard() from public, anon;

drop trigger if exists trg_sadj_lines_guard on public.stock_adjustment_lines;
create trigger trg_sadj_lines_guard before insert or update or delete on public.stock_adjustment_lines
  for each row execute function public.stock_adjustment_line_guard();

-- =============================================================================
-- 4. Unit predicate + RLS (0803's shape; line DELETE follows edit — 0678)
-- =============================================================================
create or replace function public.lv_stock_adjustments(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select p_id is null or exists (select 1 from public.stock_adjustments x where x.id = p_id and public.lv_stores(x.store_id)) $$;
revoke all on function public.lv_stock_adjustments(uuid) from public, anon;
grant execute on function public.lv_stock_adjustments(uuid) to authenticated;

alter table public.stock_adjustments enable row level security;
alter table public.stock_adjustment_lines enable row level security;

drop policy if exists stock_adjustments_read on public.stock_adjustments;
create policy stock_adjustments_read on public.stock_adjustments for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_stores(store_id));
drop policy if exists stock_adjustments_insert on public.stock_adjustments;
create policy stock_adjustments_insert on public.stock_adjustments for insert to authenticated
  with check (public.has_permission('stores', 'create') and public.lv_stores(store_id));
drop policy if exists stock_adjustments_update on public.stock_adjustments;
create policy stock_adjustments_update on public.stock_adjustments for update to authenticated
  using (public.has_permission('stores', 'edit') and public.lv_stores(store_id))
  with check (public.has_permission('stores', 'edit') and public.lv_stores(store_id));
drop policy if exists stock_adjustments_delete on public.stock_adjustments;
create policy stock_adjustments_delete on public.stock_adjustments for delete to authenticated
  using (public.has_permission('stores', 'delete') and public.lv_stores(store_id));

drop policy if exists stock_adjustment_lines_read on public.stock_adjustment_lines;
create policy stock_adjustment_lines_read on public.stock_adjustment_lines for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_stock_adjustments(adjustment_id));
drop policy if exists stock_adjustment_lines_insert on public.stock_adjustment_lines;
create policy stock_adjustment_lines_insert on public.stock_adjustment_lines for insert to authenticated
  with check ((public.has_permission('stores', 'create') or public.has_permission('stores', 'edit'))
              and public.lv_stock_adjustments(adjustment_id));
drop policy if exists stock_adjustment_lines_update on public.stock_adjustment_lines;
create policy stock_adjustment_lines_update on public.stock_adjustment_lines for update to authenticated
  using (public.has_permission('stores', 'edit') and public.lv_stock_adjustments(adjustment_id))
  with check (public.has_permission('stores', 'edit') and public.lv_stock_adjustments(adjustment_id));
drop policy if exists stock_adjustment_lines_delete on public.stock_adjustment_lines;
create policy stock_adjustment_lines_delete on public.stock_adjustment_lines for delete to authenticated
  using ((public.has_permission('stores', 'edit') or public.has_permission('stores', 'delete'))
         and public.lv_stock_adjustments(adjustment_id));

-- =============================================================================
-- 5. The lots a line can adjust — the screen's picker
--    Same rows as stock_transfer_layers (0803), narrowed to the header's stock type.
-- =============================================================================
create or replace function public.stock_adjustment_layers(
  p_store_id uuid,
  p_garment_order_id uuid default null,
  p_iwo_id uuid default null,
  p_stock_type text default 'accepted',
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
       and s.stock_status = coalesce(nullif(p_stock_type, ''), 'accepted')
       and s.qty_on_hand > 0
     order by s.item_name, s.in_date, s.lot_no;
end;
$$;
revoke all on function public.stock_adjustment_layers(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.stock_adjustment_layers(uuid, uuid, uuid, text, date) to authenticated;

-- =============================================================================
-- 6. Post — every line or none
-- =============================================================================
create or replace function public.stock_adjustment_post(p_id uuid)
returns void
language plpgsql
-- DEFINER: reads the FIFO engine (never granted) and writes the ledger; makes the two checks
-- RLS would have made — stores:edit, and the store in the caller's current unit.
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
  v_label  text;
  v_n      int := 0;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'Forbidden';
  end if;

  select * into h from public.stock_adjustments where id = p_id for update;
  if not found then
    raise exception 'Stock adjustment not found';
  end if;
  if h.status <> 'draft' then
    raise exception 'Only a draft stock adjustment can be posted (this one is %)', h.status;
  end if;
  if not public.lv_stores(h.store_id) then
    raise exception 'This adjustment is not in the unit you are working in';
  end if;
  if h.adjustment_date > current_date then
    raise exception 'An adjustment cannot be dated in the future';
  end if;
  if h.remarks is null then
    raise exception 'Remarks are required — say why the stock is being adjusted';
  end if;

  -- One store · item at a time: lock every balance row this post touches, in a fixed order.
  perform 1
     from public.stock_balances bal
    where bal.store_id = h.store_id
      and bal.item_id in (select x.item_id from public.stock_adjustment_lines x where x.adjustment_id = p_id)
    order by bal.item_id
      for update;

  create temporary table if not exists pg_temp._sadj_avail (layer_id uuid primary key, at_date numeric, now_qty numeric) on commit drop;
  delete from pg_temp._sadj_avail;
  insert into pg_temp._sadj_avail (layer_id, at_date)
    select a.ledger_id, a.qty_on_hand from public.report_stock_layers__all_units(h.adjustment_date, public.current_location()) a;
  insert into pg_temp._sadj_avail (layer_id, now_qty)
    select a.ledger_id, a.qty_on_hand from public.report_stock_layers__all_units(current_date, public.current_location()) a
  on conflict (layer_id) do update set now_qty = excluded.now_qty;

  for l in
    select x.*, it.name as item_name
      from public.stock_adjustment_lines x
      join public.items it on it.id = x.item_id
     where x.adjustment_id = p_id
     order by x.sort_order, x.created_at
  loop
    select sl.* into src from public.stock_ledger sl where sl.id = l.source_ledger_id;
    if src.store_id <> h.store_id
       or src.garment_order_id is distinct from h.garment_order_id
       or src.iwo_id is distinct from h.iwo_id then
      raise exception '%: the stock picked is no longer this store''s / group''s', l.item_name;
    end if;
    v_label := l.item_name || coalesce(' · lot ' || src.lot_no, '');

    if l.direction = 'decrease' then
      select coalesce(a.at_date, 0), coalesce(a.now_qty, 0) into v_avail, v_now
        from pg_temp._sadj_avail a where a.layer_id = l.source_ledger_id;
      v_avail := least(coalesce(v_avail, 0), coalesce(v_now, 0));
      if l.quantity > v_avail then
        raise exception '%: only % left in that lot on % — the decrease is %',
          v_label, round(v_avail, 3), to_char(h.adjustment_date, 'DD/MM/YYYY'), l.quantity;
      end if;
    end if;

    v_root := coalesce(src.origin_ledger_id, src.id);
    select coalesce(sl.rate, r.rate) into v_rate
      from public.stock_ledger sl
      left join public.stock_ledger r on r.id = v_root
     where sl.id = src.id;
    if v_rate is null then
      select s.rate into v_rate
        from public.report_stock_statement__all_units(h.adjustment_date, public.current_location()) s
       where s.layer_id = src.id;
    end if;

    insert into public.stock_ledger
      (store_id, bin_id, item_id, lot_no, movement_type, quantity, txn_date, rate, value, uom_id,
       location_id, reference_type, reference_id, note,
       garment_order_id, iwo_id, origin_ledger_id)
    values
      (h.store_id, src.bin_id, l.item_id, src.lot_no,
       case when l.direction = 'increase' then 'adjust_in' else 'adjust_out' end,
       l.quantity, h.adjustment_date, v_rate, round(l.quantity * coalesce(v_rate, 0), 2), src.uom_id,
       src.location_id, 'stock_adjustment', p_id,
       'Stock adjustment ' || coalesce(h.code, '') || ' · ' || l.reason,
       h.garment_order_id, h.iwo_id, v_root);

    perform set_config('raagam.sadj_stamping', p_id::text, true);
    update public.stock_adjustment_lines set rate = v_rate where id = l.id;
    perform set_config('raagam.sadj_stamping', '', true);
    -- the next line on the same lot sees what this one left
    update pg_temp._sadj_avail
       set at_date = at_date + case when l.direction = 'increase' then l.quantity else -l.quantity end,
           now_qty = now_qty + case when l.direction = 'increase' then l.quantity else -l.quantity end
     where layer_id = l.source_ledger_id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Add at least one line before posting';
  end if;

  perform set_config('raagam.sadj_posting', p_id::text, true);
  update public.stock_adjustments set status = 'posted', posted_at = now() where id = p_id;
  perform set_config('raagam.sadj_posting', '', true);
end;
$$;
revoke all on function public.stock_adjustment_post(uuid) from public, anon;
grant execute on function public.stock_adjustment_post(uuid) to authenticated;
