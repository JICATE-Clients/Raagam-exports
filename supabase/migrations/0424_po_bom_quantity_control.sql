-- ============================================================================
-- Raagam ERP — 0424 The Material BOM becomes a ceiling on purchasing
--
-- Client, 2026-08-13: "Once these details are fetched and the BOM is saved, the
-- system establishes a hard link. It will not allow a Purchase Order to be
-- created for any quantity exceeding the Calculated Quantity."
--
-- Nothing of the kind existed. A grep for `material_bom` / `required_qty` across
-- app/(app)/purchase and lib/purchase returned no true hit; PO lines take
-- `quantity` straight from the form into the insert with no ceiling lookup and
-- no refusal branch. The screen that SOUNDS like this control is
-- `over_budget_confirmations` (0036), and it is about RATE — it has no quantity
-- column at all, its budget rate is typed by the operator, and it is a post-hoc
-- justification document rather than a gate.
--
-- WARN AND RECORD, NOT REFUSE (client's choice, made against a hard block). A
-- refusal needs an answer for every case where the ceiling cannot be found, and
-- there are several. A buyer with a real reason at 6pm should not be stopped by
-- a plan; they should have to say why, and someone should approve it.
--
--
-- 1. A PO LINE HAD NO WAY TO NAME AN ORDER
--
-- `po_line_items` (0008) holds purchase_order_id, item_id, description,
-- quantity, uom, price. That is all. The only documented route to an order was
-- `purchase_orders.purchase_indent_id` (0373) then purchase_indents then
-- purchase_indent_lines.sales_order_id — indirect (the order sits on the
-- INDENT's lines, so a PO line matches only by item), ambiguous when one indent
-- covers two orders, and absent on a PO raised directly.
--
-- IT IS WORSE THAN THAT: 0373 WAS NEVER APPLIED. `purchase_indent_id` does not
-- exist in this database and `schema_migrations` has no row for it, so that path
-- is not lossy, it is missing. Putting the order on the LINE is therefore the
-- only honest link, and it is the right grain anyway — one PO legitimately
-- covers two orders, line by line.
--
-- NULLABLE, and that nullability is the feature. General stock purchasing names
-- no order, and a line with no order is simply UNCHECKED, never blocked. A guard
-- that refuses what it cannot measure would stop ordinary buying.
--
--
-- 2. THE CONFIRMATION IS QUANTITY-SHAPED
--
-- Deliberately a sibling of `over_budget_confirmations` rather than a column on
-- it: that table's variance is a PERCENTAGE OF A RATE, and overloading it would
-- mean one `variance_pct` meaning two things depending on which columns were
-- filled. Same four-state status, the same code trigger, the same permission
-- module, so the two read alike and neither is a special case.
--
-- `planned_qty` and `ordered_qty` are STORED, not recomputed at read time. The
-- BOM is a living document — a later amendment re-computes it — and a
-- confirmation has to stay explainable: it records what the ceiling WAS when
-- someone approved going past it. The same reason
-- `material_bom_amendment_requirements` freezes its own inputs (0418).
-- ============================================================================


alter table public.po_line_items
  add column if not exists sales_order_id uuid references public.sales_orders(id);

comment on column public.po_line_items.sales_order_id is
  'Which garment order this line buys for. NULL = general stock, and such a line is NOT quantity-checked against any BOM (0424).';

create index if not exists idx_poli_sales_order on public.po_line_items(sales_order_id);


create table if not exists public.over_quantity_confirmations (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  purchase_order_id uuid references public.purchase_orders(id) on delete cascade,
  po_line_item_id   uuid references public.po_line_items(id) on delete set null,
  sales_order_id    uuid references public.sales_orders(id),
  item_id           uuid references public.items(id),
  description       text not null,
  planned_qty       numeric(16,4) not null default 0,
  ordered_qty       numeric(16,4) not null default 0,
  variance_qty      numeric(16,4) not null default 0,
  reason            text,
  status            text not null default 'draft'
                      check (status in ('draft','submitted','approved','rejected')),
  created_by        uuid references public.profiles(id) default auth.uid(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create sequence if not exists public.seq_over_quantity;
drop trigger if exists trg_oqc_code on public.over_quantity_confirmations;
create trigger trg_oqc_code before insert on public.over_quantity_confirmations
  for each row execute function public.assign_code('OQC','public.seq_over_quantity');
drop trigger if exists trg_oqc_updated on public.over_quantity_confirmations;
create trigger trg_oqc_updated before update on public.over_quantity_confirmations
  for each row execute function public.set_updated_at();

create index if not exists idx_oqc_status on public.over_quantity_confirmations(status);
create index if not exists idx_oqc_po on public.over_quantity_confirmations(purchase_order_id);

-- Same module and same four policies as 0036's, so the two confirmation
-- documents answer to one permission rather than drifting apart.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
  $f$, 'over_quantity_confirmations');
  execute 'alter table public.over_quantity_confirmations enable row level security';
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- `sales_order_id` is asserted NULLABLE rather than merely present, because the
-- whole design rests on it: a NOT NULL would make every general-stock purchase
-- unsaveable, turning a warning into the hard block that was explicitly not
-- chosen. The status CHECK is asserted BY VIOLATING IT, since a fifth state
-- would silently escape the submit/approve routing.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_null text;
  n_pol    int;
begin
  select is_nullable into col_null
    from information_schema.columns
   where table_schema = 'public' and table_name = 'po_line_items'
     and column_name = 'sales_order_id';

  if col_null is null then
    raise exception '0424: po_line_items.sales_order_id was not added';
  end if;
  if col_null <> 'YES' then
    raise exception '0424: sales_order_id is NOT NULL — general stock purchasing names no order';
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'over_quantity_confirmations'
  ) then
    raise exception '0424: over_quantity_confirmations was not created';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'over_quantity_confirmations';
  if n_pol <> 4 then
    raise exception '0424: expected 4 policies on over_quantity_confirmations, got %', n_pol;
  end if;

  begin
    insert into public.over_quantity_confirmations (description, status)
    values ('__0424_probe', 'escalated');
    raise exception '0424: status admitted a value outside the four';
  exception when check_violation then
    null;  -- expected
  end;
  delete from public.over_quantity_confirmations where description = '__0424_probe';
end $verify$;
