-- ============================================================================
-- Raagam ERP — 0104 Logistics ▸ Pre-Shipment ▸ Export Categories
-- Commercial lane (band 0100–0199). Additive sub-modules of Logistics
-- (legacy EDP2: Logistics ▸ PreShipment ▸ "Category" / "Category Description" /
-- "Order Category Assignment"). Export commodity category master + per-order
-- category assignment. Gated by 'logistics'.
-- ============================================================================

create table if not exists public.export_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_export_cat_updated before update on public.export_categories
  for each row execute function public.set_updated_at();
create index if not exists idx_export_cat_active on public.export_categories(is_active);

create table if not exists public.order_category_assignments (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  category_id    uuid not null references public.export_categories(id) on delete cascade,
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (sales_order_id, category_id)
);
create index if not exists idx_oca_order    on public.order_category_assignments(sales_order_id);
create index if not exists idx_oca_category on public.order_category_assignments(category_id);

-- ---------- RLS (reuse the existing 'logistics' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['export_categories','order_category_assignments'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('logistics','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('logistics','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('logistics','edit'))
        with check (public.has_permission('logistics','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('logistics','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
