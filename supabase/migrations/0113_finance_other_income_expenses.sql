-- ============================================================================
-- Raagam ERP — 0113 Finance ▸ Other Income & Expenses
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Other Income Expenses"). Misc
-- income / expense entries not tied to a bill or invoice. Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_other_entry;
create table if not exists public.other_income_expenses (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- OIE-0001 (assign_code)
  entry_type    text not null default 'expense'
                  check (entry_type in ('income','expense')),
  category      text,
  description   text not null,
  amount        numeric(16,2) not null default 0,
  currency_code text references public.currencies(code),
  entry_date    date,
  remarks       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_oie_code before insert on public.other_income_expenses
  for each row execute function public.assign_code('OIE','public.seq_other_entry');
create trigger trg_oie_updated before update on public.other_income_expenses
  for each row execute function public.set_updated_at();
create index if not exists idx_oie_type on public.other_income_expenses(entry_type);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['other_income_expenses'] loop
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
