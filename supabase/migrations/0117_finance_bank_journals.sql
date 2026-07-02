-- ============================================================================
-- Raagam ERP — 0117 Finance ▸ Bank Journals
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Bank Journals" / "Bank Journals (Opening)").
-- Bank transaction log (deposits / withdrawals / charges / interest). Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_bank_journal;
create table if not exists public.bank_journals (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- BJ-0001 (assign_code)
  bank_name     text,
  entry_type    text not null default 'deposit'
                  check (entry_type in ('deposit','withdrawal','charge','interest','transfer')),
  amount        numeric(16,2) not null default 0,
  currency_code text references public.currencies(code),
  entry_date    date,
  reference     text,
  narration     text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_bj_code before insert on public.bank_journals
  for each row execute function public.assign_code('BJ','public.seq_bank_journal');
create trigger trg_bj_updated before update on public.bank_journals
  for each row execute function public.set_updated_at();
create index if not exists idx_bj_type on public.bank_journals(entry_type);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['bank_journals'] loop
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
