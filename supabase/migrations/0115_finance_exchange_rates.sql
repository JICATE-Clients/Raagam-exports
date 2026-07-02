-- ============================================================================
-- Raagam ERP — 0115 Finance ▸ Actual Exchange Rate Details
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Actual Exchange Rate Details").
-- Records booked vs actual realised forex rate for gain/loss. Gated by 'finance'.
-- ============================================================================

create table if not exists public.exchange_rate_details (
  id             uuid primary key default gen_random_uuid(),
  currency_code  text references public.currencies(code),
  reference      text,
  foreign_amount numeric(16,2) not null default 0,
  booked_rate    numeric(12,4) not null default 0,
  actual_rate    numeric(12,4) not null default 0,
  rate_date      date,
  remarks        text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_erd_updated before update on public.exchange_rate_details
  for each row execute function public.set_updated_at();
create index if not exists idx_erd_currency on public.exchange_rate_details(currency_code);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['exchange_rate_details'] loop
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
