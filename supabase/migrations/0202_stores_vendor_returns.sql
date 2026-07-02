-- ============================================================================
-- Raagam ERP — 0202 Stores ▸ Return to Vendor (+ Replacement)   [Lane B]
-- Additive sub-module (legacy EDP2: Materials ▸ Store ▸ "Replacement
-- Deliveries/Receipts, Rejection/Return Deliveries"). Return rejected/excess
-- material to a vendor (posts `issue`) and record the replacement (posts
-- `receipt`). Gated by the EXISTING 'stores' permission.
-- ============================================================================

create sequence if not exists public.seq_vendor_return;
create table if not exists public.vendor_returns (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,                                    -- VRT-0001
  store_id    uuid not null references public.stores(id) on delete cascade,
  vendor_id   uuid references public.vendors(id) on delete set null,
  reason      text,
  return_date date,
  status      text not null default 'draft'
                check (status in ('draft','returned','replaced','closed','cancelled')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_vrt_code before insert on public.vendor_returns
  for each row execute function public.assign_code('VRT','public.seq_vendor_return');
create trigger trg_vrt_updated before update on public.vendor_returns
  for each row execute function public.set_updated_at();
create index if not exists idx_vrt_store  on public.vendor_returns(store_id);
create index if not exists idx_vrt_status on public.vendor_returns(status);

create table if not exists public.vendor_return_lines (
  id               uuid primary key default gen_random_uuid(),
  vendor_return_id uuid not null references public.vendor_returns(id) on delete cascade,
  item_id          uuid not null references public.items(id),
  return_qty       numeric(14,3) not null default 0,
  replacement_qty  numeric(14,3) not null default 0,
  sort_order       int not null default 0
);
create index if not exists idx_vrt_lines on public.vendor_return_lines(vendor_return_id);

do $$
declare t text;
begin
  foreach t in array array['vendor_returns','vendor_return_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('stores','edit')) with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
