-- ============================================================================
-- Raagam ERP — 0334 Planning ▸ Indent Approval + Indent to Purchase
--
-- Indent Approval = multi-level approval workflow for material indents.
-- Authority matrix: Purchase/Store/Department levels.
--
-- Indent to Purchase = convert approved indents into purchase orders.
-- Links indent items to vendor assignment, rate finalization, PO creation.
--
-- Note: purchase_indents table already exists (from earlier migrations).
-- This adds the approval tracking and conversion workflow tables.
-- ============================================================================

-- ==========================================================================
-- 1. Indent Approvals (tracks approval status per indent)
-- ==========================================================================
create table if not exists public.indent_approvals (
  id                    uuid primary key default gen_random_uuid(),
  indent_id             uuid not null references public.purchase_indents(id) on delete cascade,
  approval_type         text not null check (approval_type in ('purchase','store','department')),
  approval_status       text not null default 'pending'
    check (approval_status in ('pending','approved','rejected')),
  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,
  remarks               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ia_updated before update on public.indent_approvals
  for each row execute function public.set_updated_at();
create index if not exists idx_ia_indent on public.indent_approvals(indent_id);
create index if not exists idx_ia_status on public.indent_approvals(approval_status);

-- ==========================================================================
-- 2. Indent Approval Items (per-item approval within an indent)
-- ==========================================================================
create table if not exists public.indent_approval_items (
  id                    uuid primary key default gen_random_uuid(),
  indent_approval_id    uuid not null references public.indent_approvals(id) on delete cascade,
  sno                   integer not null default 0,
  category_name         text,
  item_description      text,
  uom_id                text,
  qty                   numeric(14,3) default 0,
  last_po_rate          numeric(14,4),
  stock_qty             numeric(14,3),
  is_approved           boolean,
  remarks               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_iai_updated before update on public.indent_approval_items
  for each row execute function public.set_updated_at();
create index if not exists idx_iai_approval on public.indent_approval_items(indent_approval_id);

-- ==========================================================================
-- 3. Indent to Purchase Conversions (tracks which indents became POs)
-- ==========================================================================
create sequence if not exists public.seq_indent_conversion;
create table if not exists public.indent_conversions (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  indent_id             uuid not null references public.purchase_indents(id) on delete cascade,
  conversion_date       date not null default current_date,
  purchase_order_id     uuid references public.purchase_orders(id) on delete set null,
  status                text not null default 'pending'
    check (status in ('pending','converted','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ic_code before insert on public.indent_conversions
  for each row execute function public.assign_code('ITC','public.seq_indent_conversion');
create trigger trg_ic_updated before update on public.indent_conversions
  for each row execute function public.set_updated_at();
create index if not exists idx_ic_indent on public.indent_conversions(indent_id);
create index if not exists idx_ic_po on public.indent_conversions(purchase_order_id);

-- ==========================================================================
-- 4. Indent Conversion Items (per-item vendor/rate assignment)
-- ==========================================================================
create table if not exists public.indent_conversion_items (
  id                    uuid primary key default gen_random_uuid(),
  conversion_id         uuid not null references public.indent_conversions(id) on delete cascade,
  sno                   integer not null default 0,
  item_class_name       text,
  category_name         text,
  item_description      text,
  uom_id                text,
  qty                   numeric(14,3) default 0,
  wt                    numeric(14,4),
  rate                  numeric(14,4) default 0,
  po_value              numeric(14,2) default 0,
  vendor_name           text,
  supply_type           text,
  required_date         date,
  is_sizewise           boolean not null default false,
  is_approval_required  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ici_updated before update on public.indent_conversion_items
  for each row execute function public.set_updated_at();
create index if not exists idx_ici_conv on public.indent_conversion_items(conversion_id);

-- ==========================================================================
-- 5. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'indent_approvals','indent_approval_items',
    'indent_conversions','indent_conversion_items'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('planning','delete'));
    $f$, t);
  end loop;
end $$;
