-- ============================================================================
-- Raagam ERP — 0244 Master Data ▸ Associates ▸ Account Group
-- Legacy EDP2 "Account Group" form (chart-of-accounts groups):
--   Under            → self-reference to a parent account_group  — ⓘ picker
--   Blocked          → checkbox
--   Short Name       → text
--   Name             → text (required identity)
--   Nature of Group  → fixed list (ASSETS / LIABILITIES / INCOME / EXPENSES)
--   Debit Schedule   → config_lookups kind 'account_schedule'    — ⓘ picker
--   Credit Schedule  → config_lookups kind 'account_schedule'    — ⓘ picker
--
-- "Schedule" is a small Code/Name list (balance-sheet / P&L schedule grouping),
-- so it is backed by a reusable config_lookups kind rather than its own table.
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK: add 'account_schedule'
--    (re-add every existing kind — 0243 shape — plus the new one).
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute',
    'levy',
    'material_category',
    'material_attribute',
    'yarn_count',
    'yarn_purity',
    'composition',
    'process',
    'component',
    'gauge',
    'knitting_dia',
    'out_doc_term',
    'commodity',
    'item_class',
    'hsn_code',
    'city',
    'state',
    'department',
    'designation',
    'internal_department',
    'ship_type',
    'payment_term',
    'employee_category',
    'team',
    'account_schedule'
  ));

-- 2) Account Groups master (self-referencing hierarchy).
create table if not exists public.account_groups (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid references public.account_groups(id) on delete set null,  -- "Under"
  short_name          text,
  name                text not null,
  nature_of_group     text check (nature_of_group is null or nature_of_group in (
                        'ASSETS','LIABILITIES','INCOME','EXPENSES')),
  debit_schedule_id   uuid references public.config_lookups(id) on delete set null,
  credit_schedule_id  uuid references public.config_lookups(id) on delete set null,
  blocked             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_account_groups_parent on public.account_groups(parent_id);
create trigger trg_account_groups_updated before update on public.account_groups
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy account_groups_read on public.account_groups for select to authenticated using (true);
    create policy account_groups_insert on public.account_groups for insert to authenticated with check (public.has_permission('masters','create'));
    create policy account_groups_update on public.account_groups for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy account_groups_delete on public.account_groups for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.account_groups enable row level security;
end $$;
