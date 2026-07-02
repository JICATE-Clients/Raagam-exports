-- ============================================================================
-- Raagam ERP — 0108 Finance ▸ Cheque Management
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Payables ▸ Cheque Details / Cheque Opening /
-- Deposited / Cleared / Cancellation). Cheque register with lifecycle.
-- Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_cheque;
create table if not exists public.cheques (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- CHQ-0001 (assign_code)
  cheque_number text,
  bank_name     text,
  party_name    text,
  direction     text not null default 'outgoing'
                  check (direction in ('outgoing','incoming')),
  currency_code text references public.currencies(code),
  amount        numeric(16,2) not null default 0,
  cheque_date   date,
  cleared_date  date,
  status        text not null default 'issued'
                  check (status in ('issued','deposited','cleared','cancelled','bounced')),
  remarks       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_cheque_code before insert on public.cheques
  for each row execute function public.assign_code('CHQ','public.seq_cheque');
create trigger trg_cheque_updated before update on public.cheques
  for each row execute function public.set_updated_at();
create index if not exists idx_cheque_status on public.cheques(status);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['cheques'] loop
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
