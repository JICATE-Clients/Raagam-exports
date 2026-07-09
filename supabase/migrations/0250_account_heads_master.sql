-- ============================================================================
-- Raagam ERP — 0250 Master Data ▸ Associates ▸ Account Head
-- Legacy EDP2 "Account Head" form (ledger account heads): Short Name · Blocked ·
-- Name (required) · Group Under [ If Debits ⓘ · If Credits ⓘ ] · Cost head ⓘ.
--
-- Part of the legacy chart-of-accounts master set (account_groups 0244 +
-- account_heads), kept distinct from the modern double-entry `gl_accounts`
-- ledger (0015, wired into journal_entries) — the two may be reconciled later.
--
-- Picker fields reference existing masters:
--   If Debits / If Credits (Group Under) → public.account_groups (0244)  [red ⓘ]
--   Cost head                            → public.cost_heads (0119)      [blue ⓘ]
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.account_heads (
  id               uuid primary key default gen_random_uuid(),
  short_name       text,
  name             text not null,
  blocked          boolean not null default false,
  debit_group_id   uuid references public.account_groups(id) on delete set null,  -- "If Debits"
  credit_group_id  uuid references public.account_groups(id) on delete set null,  -- "If Credits"
  cost_head_id     uuid references public.cost_heads(id) on delete set null,      -- "Cost head"
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_account_heads_updated before update on public.account_heads
  for each row execute function public.set_updated_at();
create index if not exists idx_account_heads_debit on public.account_heads(debit_group_id);
create index if not exists idx_account_heads_credit on public.account_heads(credit_group_id);
create index if not exists idx_account_heads_cost on public.account_heads(cost_head_id);

alter table public.account_heads enable row level security;
create policy account_heads_read on public.account_heads for select to authenticated using (true);
create policy account_heads_insert on public.account_heads for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy account_heads_update on public.account_heads for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy account_heads_delete on public.account_heads for delete to authenticated
  using (public.has_permission('masters','delete'));
