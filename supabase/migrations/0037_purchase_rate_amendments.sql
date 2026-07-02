-- ============================================================================
-- Raagam ERP — 0037 Purchase ▸ PO Rate Amendment
-- Additive sub-module (legacy EDP2: Materials ▸ Purchase ▸ "Rate Amendment").
-- Formally revise a purchase-order line rate with approval; on approve the
-- action applies the revised rate to the po_line_item and recomputes the PO
-- total. Gated by the EXISTING 'materials_purchase' permission.
-- ============================================================================

create sequence if not exists public.seq_po_rate_amendment;
create table if not exists public.po_rate_amendments (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                               -- PRA-0001
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  po_line_item_id   uuid references public.po_line_items(id) on delete set null,
  previous_rate     numeric(14,4) not null default 0,
  revised_rate      numeric(14,4) not null default 0,
  reason            text not null,
  status            text not null default 'draft'
                      check (status in ('draft','submitted','approved','rejected')),
  created_by        uuid references public.profiles(id) default auth.uid(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_pra_code before insert on public.po_rate_amendments
  for each row execute function public.assign_code('PRA','public.seq_po_rate_amendment');
create trigger trg_pra_updated before update on public.po_rate_amendments
  for each row execute function public.set_updated_at();
create index if not exists idx_pra_po     on public.po_rate_amendments(purchase_order_id);
create index if not exists idx_pra_status on public.po_rate_amendments(status);

do $$
declare t text;
begin
  foreach t in array array['po_rate_amendments'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
