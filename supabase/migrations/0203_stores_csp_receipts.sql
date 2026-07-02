-- ============================================================================
-- Raagam ERP — 0203 Stores ▸ CSP Receipt   [Lane B]
-- Additive sub-module (legacy EDP2: Materials ▸ Store ▸ "CSP Receipts" —
-- customer-supplied / consignment material). Receiving CSP stock into a store;
-- posting inserts `receipt` rows into the stock_ledger. Gated by 'stores'.
-- ============================================================================

create sequence if not exists public.seq_csp_receipt;
create table if not exists public.csp_receipts (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                                   -- CSP-0001
  store_id     uuid not null references public.stores(id) on delete cascade,
  buyer_id     uuid references public.buyers(id) on delete set null,
  receipt_date date,
  reference    text,
  status       text not null default 'draft'
                 check (status in ('draft','posted','cancelled')),
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_csp_code before insert on public.csp_receipts
  for each row execute function public.assign_code('CSP','public.seq_csp_receipt');
create trigger trg_csp_updated before update on public.csp_receipts
  for each row execute function public.set_updated_at();
create index if not exists idx_csp_store on public.csp_receipts(store_id);

create table if not exists public.csp_receipt_lines (
  id             uuid primary key default gen_random_uuid(),
  csp_receipt_id uuid not null references public.csp_receipts(id) on delete cascade,
  item_id        uuid not null references public.items(id),
  quantity       numeric(14,3) not null default 0,
  note           text,
  sort_order     int not null default 0
);
create index if not exists idx_csp_lines on public.csp_receipt_lines(csp_receipt_id);

do $$
declare t text;
begin
  foreach t in array array['csp_receipts','csp_receipt_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('stores','edit')) with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
