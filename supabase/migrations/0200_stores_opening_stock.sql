-- ============================================================================
-- Raagam ERP — 0200 Stores ▸ Opening Stock   [Lane B · band 0200–0299]
-- Additive sub-module (legacy EDP2: Materials ▸ Store ▸ "Opening Stocks").
-- A document that sets initial on-hand balances for a store; posting inserts
-- `adjust_in` rows into the existing append-only stock_ledger (trigger maintains
-- stock_balances). Gated by the EXISTING 'stores' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_opening_stock;
create table if not exists public.opening_stocks (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                                   -- OPN-0001
  store_id     uuid not null references public.stores(id) on delete cascade,
  opening_date date,
  status       text not null default 'draft'
                 check (status in ('draft','posted','cancelled')),
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_opn_code before insert on public.opening_stocks
  for each row execute function public.assign_code('OPN','public.seq_opening_stock');
create trigger trg_opn_updated before update on public.opening_stocks
  for each row execute function public.set_updated_at();
create index if not exists idx_opn_store on public.opening_stocks(store_id);

create table if not exists public.opening_stock_lines (
  id               uuid primary key default gen_random_uuid(),
  opening_stock_id uuid not null references public.opening_stocks(id) on delete cascade,
  item_id          uuid not null references public.items(id),
  quantity         numeric(14,3) not null default 0,
  note             text,
  sort_order       int not null default 0
);
create index if not exists idx_opn_lines on public.opening_stock_lines(opening_stock_id);

do $$
declare t text;
begin
  foreach t in array array['opening_stocks','opening_stock_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('stores','edit')) with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
