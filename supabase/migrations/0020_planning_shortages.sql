-- ============================================================================
-- Raagam ERP — 0020 Planning ▸ Shortages
-- Additive sub-module of the existing Planning module (legacy EDP2:
-- Planning ▸ Materials ▸ "Shortage / Shortages to approve / Garment Shortage").
--
-- Flags a material- or garment-level gap on an order (required vs available)
-- → submit → approve/reject → resolve. Gated by the EXISTING 'planning'
-- permission — no new module, no changes to any existing table.
-- Follows the `code` + assign_code() + set_updated_at() conventions (see 0007).
-- ============================================================================

create sequence if not exists public.seq_material_shortage;
create table if not exists public.material_shortages (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                  -- SHT-0001 (assign_code)
  sales_order_id  uuid references public.sales_orders(id) on delete set null,
  item_id         uuid references public.items(id) on delete set null,
  kind            text not null default 'material'
                    check (kind in ('material','garment')),
  description     text not null,
  uom_id          uuid references public.uoms(id),
  required_qty    numeric(14,3) not null default 0,
  available_qty   numeric(14,3) not null default 0,
  shortage_qty    numeric(14,3) not null default 0,             -- max(required-available,0); set by action
  status          text not null default 'open'
                    check (status in ('open','submitted','approved','rejected','resolved')),
  reason          text,
  resolution_note text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_shortage_code before insert on public.material_shortages
  for each row execute function public.assign_code('SHT','public.seq_material_shortage');
create trigger trg_shortage_updated before update on public.material_shortages
  for each row execute function public.set_updated_at();
create index if not exists idx_shortage_order  on public.material_shortages(sales_order_id);
create index if not exists idx_shortage_status on public.material_shortages(status);
create index if not exists idx_shortage_kind   on public.material_shortages(kind);

-- ---------- RLS (reuse the existing 'planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['material_shortages'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
