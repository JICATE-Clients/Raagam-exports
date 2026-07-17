-- ============================================================================
-- Raagam ERP — 0307 Master Data ▸ Style Names, Style Levels, Packing
--                                   Instructions, Packing Methods & Default
--                                   Account Heads
--
-- style_names          — garment style naming master
-- style_levels         — style level classification (1/2/3)
-- packing_instructions — packing instruction specifications
-- packing_methods      — packing method definitions
-- packing_method_categories — child categories of packing_methods
-- default_account_heads — singleton config mapping default GL accounts
--
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. style_names
-- --------------------------------------------------------------------------
create table if not exists public.style_names (
  id          uuid primary key default gen_random_uuid(),
  short_name  text not null unique,
  inactive    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_style_names_updated before update on public.style_names
  for each row execute function public.set_updated_at();

alter table public.style_names enable row level security;
create policy style_names_read on public.style_names for select to authenticated using (true);
create policy style_names_insert on public.style_names for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy style_names_update on public.style_names for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy style_names_delete on public.style_names for delete to authenticated
  using (public.has_permission('masters','delete'));

-- --------------------------------------------------------------------------
-- 2. style_levels
-- --------------------------------------------------------------------------
create table if not exists public.style_levels (
  id               uuid primary key default gen_random_uuid(),
  level_short_name text not null,
  level_name       text,
  level            integer not null default 1 check (level in (1, 2, 3)),
  inactive         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_style_levels_updated before update on public.style_levels
  for each row execute function public.set_updated_at();

alter table public.style_levels enable row level security;
create policy style_levels_read on public.style_levels for select to authenticated using (true);
create policy style_levels_insert on public.style_levels for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy style_levels_update on public.style_levels for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy style_levels_delete on public.style_levels for delete to authenticated
  using (public.has_permission('masters','delete'));

-- --------------------------------------------------------------------------
-- 3. packing_instructions
-- --------------------------------------------------------------------------
create table if not exists public.packing_instructions (
  id                    uuid primary key default gen_random_uuid(),
  packing_no            text,
  packing_type          text not null,
  packing_type_new_old  text not null default 'N' check (packing_type_new_old in ('N', 'O')),
  reference             text,
  instructions          text,
  packing_charges       numeric default 0,
  inactive              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_packing_instructions_updated before update on public.packing_instructions
  for each row execute function public.set_updated_at();

alter table public.packing_instructions enable row level security;
create policy packing_instructions_read on public.packing_instructions for select to authenticated using (true);
create policy packing_instructions_insert on public.packing_instructions for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy packing_instructions_update on public.packing_instructions for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy packing_instructions_delete on public.packing_instructions for delete to authenticated
  using (public.has_permission('masters','delete'));

-- --------------------------------------------------------------------------
-- 4. packing_methods
-- --------------------------------------------------------------------------
create table if not exists public.packing_methods (
  id               uuid primary key default gen_random_uuid(),
  packing_type     text not null,
  reference        text,
  description      text,
  packing_charges  numeric default 0,
  effective_from   date,
  inactive         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_packing_methods_updated before update on public.packing_methods
  for each row execute function public.set_updated_at();

alter table public.packing_methods enable row level security;
create policy packing_methods_read on public.packing_methods for select to authenticated using (true);
create policy packing_methods_insert on public.packing_methods for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy packing_methods_update on public.packing_methods for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy packing_methods_delete on public.packing_methods for delete to authenticated
  using (public.has_permission('masters','delete'));

-- --------------------------------------------------------------------------
-- 5. packing_method_categories (child of packing_methods)
-- --------------------------------------------------------------------------
create table if not exists public.packing_method_categories (
  id                uuid primary key default gen_random_uuid(),
  packing_method_id uuid not null references public.packing_methods(id) on delete cascade,
  sort_order        integer,
  category_name     text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_packing_method_categories_updated before update on public.packing_method_categories
  for each row execute function public.set_updated_at();
create index if not exists idx_packing_method_categories_method on public.packing_method_categories(packing_method_id);

alter table public.packing_method_categories enable row level security;
create policy packing_method_categories_read on public.packing_method_categories for select to authenticated using (true);
create policy packing_method_categories_insert on public.packing_method_categories for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy packing_method_categories_update on public.packing_method_categories for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy packing_method_categories_delete on public.packing_method_categories for delete to authenticated
  using (public.has_permission('masters','delete'));

-- --------------------------------------------------------------------------
-- 6. default_account_heads (singleton config — default GL account mapping)
-- --------------------------------------------------------------------------
create table if not exists public.default_account_heads (
  id                        uuid primary key default gen_random_uuid(),
  discount_ac_id            uuid references public.account_heads(id) on delete set null,
  freight_ac_id             uuid references public.account_heads(id) on delete set null,
  insurance_ac_id           uuid references public.account_heads(id) on delete set null,
  agency_commission_ac_id   uuid references public.account_heads(id) on delete set null,
  round_off_ac_id           uuid references public.account_heads(id) on delete set null,
  exchange_gain_ac_id       uuid references public.account_heads(id) on delete set null,
  exchange_loss_ac_id       uuid references public.account_heads(id) on delete set null,
  qty_diff_ac_id            uuid references public.account_heads(id) on delete set null,
  rate_diff_ac_id           uuid references public.account_heads(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_default_account_heads_updated before update on public.default_account_heads
  for each row execute function public.set_updated_at();
create index if not exists idx_default_account_heads_discount on public.default_account_heads(discount_ac_id);
create index if not exists idx_default_account_heads_freight on public.default_account_heads(freight_ac_id);
create index if not exists idx_default_account_heads_insurance on public.default_account_heads(insurance_ac_id);
create index if not exists idx_default_account_heads_agency on public.default_account_heads(agency_commission_ac_id);
create index if not exists idx_default_account_heads_roundoff on public.default_account_heads(round_off_ac_id);
create index if not exists idx_default_account_heads_exgain on public.default_account_heads(exchange_gain_ac_id);
create index if not exists idx_default_account_heads_exloss on public.default_account_heads(exchange_loss_ac_id);
create index if not exists idx_default_account_heads_qtydiff on public.default_account_heads(qty_diff_ac_id);
create index if not exists idx_default_account_heads_ratediff on public.default_account_heads(rate_diff_ac_id);

alter table public.default_account_heads enable row level security;
create policy default_account_heads_read on public.default_account_heads for select to authenticated using (true);
create policy default_account_heads_insert on public.default_account_heads for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy default_account_heads_update on public.default_account_heads for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy default_account_heads_delete on public.default_account_heads for delete to authenticated
  using (public.has_permission('masters','delete'));
