-- ============================================================================
-- Raagam ERP — 0120 Finance ▸ Masters ▸ Bank Limits & Interests
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Masters ▸ "Bank Limits and Interests"). Bank credit
-- facilities (CC / OD / packing credit) with limit + interest rate. Gated by 'finance'.
-- ============================================================================

create table if not exists public.bank_limits (
  id            uuid primary key default gen_random_uuid(),
  bank_name     text not null,
  facility_type text not null default 'cc'
                  check (facility_type in ('cc','od','packing_credit','term_loan','bg','lc','other')),
  limit_amount  numeric(16,2) not null default 0,
  interest_rate numeric(7,3) not null default 0,
  currency_code text references public.currencies(code),
  valid_until   date,
  remarks       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_banklimit_updated before update on public.bank_limits
  for each row execute function public.set_updated_at();
create index if not exists idx_banklimit_type on public.bank_limits(facility_type);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['bank_limits'] loop
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
