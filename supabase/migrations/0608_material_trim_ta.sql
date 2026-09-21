-- ============================================================================
-- 0608 · Material BOM (trims) T&A — steps 12–17
-- Spec: doc/order/materialbomtana.md · plan: doc/order/materialbomtana-plan.md
-- ============================================================================
--
-- ## WHY THIS IS SO MUCH SMALLER THAN THE SPEC'S DDL
--
-- The spec creates a schedule table keyed on `material_bom_item_id … ON DELETE
-- CASCADE` plus a store ledger of PO / GRN / DC documents. Neither is built:
--
--   * The Material BOM editor saves by DELETE-AND-REINSERT (`writeChildren`),
--     so a line id lives exactly one save — the cascade would wipe every
--     schedule every time the BOM was touched.
--   * The "ledger" is the PO, GRN and DC tables this ERP already holds. A second
--     copy of them drifts the first time a GRN is edited.
--
-- So the schedule is DERIVED on read (`lib/orders/trim-ta/engine.ts`) at the
-- grain purchasing already speaks — (order, material): `po_line_items` names
-- `sales_order_id + item_id` (0424) and nothing finer. Status, quantities,
-- OVERDUE and the actual date all come from the documents.
--
-- What IS stored is only what a PERSON decides, and one date the documents
-- never recorded:
--
--   1. order_trim_ta_marks       — tolerance, a manual done date, remarks, owner
--   2. dc_line_items.returned_on — the day a job-work return last arrived
--   3. SEWTRIM / PACKTRIM default Days 2 → 1 (the spec's "start − 1 day")
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Per-step human input. One row only once somebody has said something about
--    the step; an absent row means "tolerance 0, nothing manual, unowned".
--
--    Keyed on (sales_order_id, item_id, step_code) — the derived schedule's own
--    address — so it survives any number of BOM saves. `item_id` cascades: a
--    deleted material has no schedule left to annotate.
-- ----------------------------------------------------------------------------
create table if not exists public.order_trim_ta_marks (
  id                 uuid primary key default gen_random_uuid(),
  sales_order_id     uuid not null references public.sales_orders(id) on delete cascade,
  item_id            uuid not null references public.items(id) on delete cascade,
  step_code          text not null check (step_code in (
                       'SEWING_PO','SEWING_GRN','SEWING_PROCESS_DC','SEWING_PROCESS_GRN',
                       'PACKING_PO','PACKING_GRN')),
  -- Rule 3.3's receipt allowance. Capped at 10 %: past that it is not a
  -- tolerance, it is a different required quantity, and that belongs on the BOM.
  tolerance_pct      numeric(5,2) not null default 0
                       check (tolerance_pct >= 0 and tolerance_pct <= 10),
  -- A person's word that the step is done, for what the documents cannot show
  -- (a PO raised outside the ERP, a free-issue receipt with no GRN). Wins over
  -- the derivation, and the tracker labels it manual.
  done_on            date,
  remarks            text,
  assigned_staff_id  uuid references public.employees(id) on delete set null,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint order_trim_ta_marks_step_unique unique (sales_order_id, item_id, step_code)
);

create index if not exists idx_order_trim_ta_marks_staff
  on public.order_trim_ta_marks(assigned_staff_id) where assigned_staff_id is not null;

drop trigger if exists trg_order_trim_ta_marks_updated on public.order_trim_ta_marks;
create trigger trg_order_trim_ta_marks_updated
  before update on public.order_trim_ta_marks
  for each row execute function public.set_updated_at();

alter table public.order_trim_ta_marks enable row level security;

drop policy if exists ottm_read   on public.order_trim_ta_marks;
drop policy if exists ottm_insert on public.order_trim_ta_marks;
drop policy if exists ottm_update on public.order_trim_ta_marks;
drop policy if exists ottm_delete on public.order_trim_ta_marks;
create policy ottm_read on public.order_trim_ta_marks
  for select to authenticated using (public.has_permission('orders','view'));
create policy ottm_insert on public.order_trim_ta_marks
  for insert to authenticated with check (public.has_permission('orders','edit'));
create policy ottm_update on public.order_trim_ta_marks
  for update to authenticated
  using (public.has_permission('orders','edit'))
  with check (public.has_permission('orders','edit'));
create policy ottm_delete on public.order_trim_ta_marks
  for delete to authenticated using (public.has_permission('orders','edit'));

revoke all on public.order_trim_ta_marks from anon;
grant select, insert, update, delete on public.order_trim_ta_marks to authenticated;


-- ----------------------------------------------------------------------------
-- 2. The day a job-work return arrived.
--
--    `recordDcReturn` adds to `returned_qty` and records no date, so step 15
--    ("process receipts") would have no actual date to stamp. A TRIGGER rather
--    than an edit to the action, because every writer of `returned_qty` — the
--    action, a BOM save that syncs it, a future import — must stamp it, and
--    only the table sees all of them. The factory's day (IST), not UTC's:
--    `lib/calendar.today()`'s reason, one layer down.
--
--    Only a RISE stamps. A correction downwards is not an arrival.
-- ----------------------------------------------------------------------------
alter table public.dc_line_items add column if not exists returned_on date;

comment on column public.dc_line_items.returned_on is
  '0608: the factory date returned_qty last ROSE — the actual date of trims T&A step 15. Stamped by trg_dc_line_returned_on; NULL on rows returned before 0608.';

create or replace function public.dc_line_stamp_returned_on()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.returned_qty, 0) > coalesce(old.returned_qty, 0) then
    new.returned_on := (now() at time zone 'Asia/Kolkata')::date;
  end if;
  return new;
end;
$$;

revoke all on function public.dc_line_stamp_returned_on() from public, anon;

drop trigger if exists trg_dc_line_returned_on on public.dc_line_items;
create trigger trg_dc_line_returned_on
  before update of returned_qty on public.dc_line_items
  for each row execute function public.dc_line_stamp_returned_on();


-- ----------------------------------------------------------------------------
-- 3. The spec's "−1 day", for NEW orders.
--
--    The order's T&A tab already dates SEWING / PACKING TRIMS INWARD N working
--    days before CUT / PACK (0561, N seeded at 2). The trims tracker reads that
--    date rather than computing a second one, so the spec's rule is met by
--    moving the SEED to 1.
--
--    Only where it still holds the seeded 2 — an operator who has since chosen
--    a different default keeps it. Orders already saved keep their own Days:
--    a master default is a starting value, never a rewrite of committed plans.
-- ----------------------------------------------------------------------------
update public.ta_activities
   set default_offset_days = 1
 where short_name in ('SEWTRIM','PACKTRIM')
   and default_offset_days = 2;


-- ----------------------------------------------------------------------------
-- Verify.
-- ----------------------------------------------------------------------------
do $v$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='dc_line_items'
                    and column_name='returned_on' and data_type='date') then
    raise exception '0608: dc_line_items.returned_on missing or not a date';
  end if;
  if exists (select 1 from public.ta_activities
              where short_name in ('SEWTRIM','PACKTRIM') and default_offset_days = 2) then
    raise exception '0608: SEWTRIM/PACKTRIM default still 2';
  end if;
  if has_function_privilege('anon', 'public.dc_line_stamp_returned_on()', 'execute') then
    raise exception '0608: dc_line_stamp_returned_on is anon-executable';
  end if;
end;
$v$;
