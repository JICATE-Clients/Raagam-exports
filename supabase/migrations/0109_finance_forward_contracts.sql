-- ============================================================================
-- Raagam ERP — 0109 Finance ▸ Forward Contracts
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Forward Contracts" /
-- "Forward Contract Cancellations"). Forex forward-cover register. Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_forward_contract;
create table if not exists public.forward_contracts (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,                              -- FC-0001 (assign_code)
  contract_number  text,
  bank_name        text,
  currency_code    text references public.currencies(code),
  amount           numeric(16,2) not null default 0,          -- foreign-currency cover
  forward_rate     numeric(12,4) not null default 0,
  utilised_amount  numeric(16,2) not null default 0,
  booking_date     date,
  maturity_date    date,
  status           text not null default 'booked'
                     check (status in ('booked','partially_utilised','utilised','cancelled','expired')),
  remarks          text,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_fc_code before insert on public.forward_contracts
  for each row execute function public.assign_code('FC','public.seq_forward_contract');
create trigger trg_fc_updated before update on public.forward_contracts
  for each row execute function public.set_updated_at();
create index if not exists idx_fc_status on public.forward_contracts(status);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['forward_contracts'] loop
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
