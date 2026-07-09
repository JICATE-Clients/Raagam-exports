-- ============================================================================
-- Raagam ERP — 0253 Master Data ▸ Currencies ▸ Exchange-rate registers
-- Legacy EDP2 "Exchange rate (Quotes / Orders)" form (and its Customs / Imports
-- siblings): a master-detail entry —
--   Header : Entry No (auto, per register) · Date · For (Quotes/Orders/…) ·
--            Effective From
--   Grid   : S No · Currency (→ currencies) · Ex-Rate (numeric, 4 dp)
-- One table pair serves all three registers, discriminated by `register`.
-- Distinct from Finance's daily `exchange_rates` (0115) — this is the masters
-- rate register the legacy Configure module owns. RLS = masters.
-- ============================================================================

create table if not exists public.exchange_rate_entries (
  id             uuid primary key default gen_random_uuid(),
  register       text not null check (register in ('quotes_orders','customs','imports')),
  entry_no       bigint not null,               -- sequential within a register
  entry_date     date not null default current_date,
  rate_for       text,                           -- the "For" dropdown value
  effective_from date,                            -- period for Quotes/Orders
  rate_month     smallint check (rate_month is null or rate_month between 1 and 12),
  rate_year      integer,                         -- period for Customs/Imports (Month + Year)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (register, entry_no)
);
create trigger trg_exchange_rate_entries_updated before update on public.exchange_rate_entries
  for each row execute function public.set_updated_at();
create index if not exists idx_exchange_rate_entries_register on public.exchange_rate_entries(register);

create table if not exists public.exchange_rate_lines (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.exchange_rate_entries(id) on delete cascade,
  sno           integer not null default 0,
  currency_code text not null references public.currencies(code),
  ex_rate       numeric(18,4) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_exchange_rate_lines_updated before update on public.exchange_rate_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_exchange_rate_lines_entry on public.exchange_rate_lines(entry_id);
create index if not exists idx_exchange_rate_lines_currency on public.exchange_rate_lines(currency_code);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['exchange_rate_entries','exchange_rate_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
