-- ============================================================================
-- Raagam ERP — 0038 Purchase ▸ Cancel Purchase Order
-- Additive sub-module (legacy EDP2: Materials ▸ Purchase ▸ "Cancel Purchase
-- Order"). Upgrades the bare cancel-status (◐) with a reason-logged
-- cancellation record; the action also sets purchase_orders.status='cancelled'.
-- One cancellation per PO. Gated by the EXISTING 'materials_purchase' permission.
-- ============================================================================

create sequence if not exists public.seq_po_cancellation;
create table if not exists public.po_cancellations (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                               -- POC-0001
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  reason            text not null,
  cancelled_by      uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (purchase_order_id)
);
create trigger trg_poc_code before insert on public.po_cancellations
  for each row execute function public.assign_code('POC','public.seq_po_cancellation');
create index if not exists idx_poc_po on public.po_cancellations(purchase_order_id);

do $$
declare t text;
begin
  foreach t in array array['po_cancellations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
