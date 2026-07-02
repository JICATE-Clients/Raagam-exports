-- ============================================================================
-- Raagam ERP — 0114 Finance ▸ Party Openings
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Payables/Receivables ▸ "Party Openings"). Opening
-- balance per vendor / buyer. Gated by 'finance'.
-- ============================================================================

create table if not exists public.party_openings (
  id              uuid primary key default gen_random_uuid(),
  party_type      text not null check (party_type in ('vendor','buyer')),
  vendor_id       uuid references public.vendors(id),
  buyer_id        uuid references public.buyers(id),
  currency_code   text references public.currencies(code),
  opening_balance numeric(16,2) not null default 0,
  balance_type    text not null default 'dr' check (balance_type in ('dr','cr')),
  as_of_date      date,
  remarks         text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_popening_updated before update on public.party_openings
  for each row execute function public.set_updated_at();
create index if not exists idx_popening_vendor on public.party_openings(vendor_id);
create index if not exists idx_popening_buyer  on public.party_openings(buyer_id);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['party_openings'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('finance','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('finance','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('finance','edit'))
        with check (public.has_permission('finance','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('finance','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
