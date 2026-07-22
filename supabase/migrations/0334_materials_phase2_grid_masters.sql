-- ============================================================================
-- Raagam ERP — 0334 Materials Phase 2: Grid Masters
--
-- Masters with child grids: Count Groups, Constructions, Yarn Purchase Rates,
-- Yarn Debit Rates, Costing Rate for Sizing, Warp Length Allowances,
-- Process Sequences, Process Sequence Groups.
-- ============================================================================

-- ==========================================================================
-- 1. Count Groups (CountGroup + child counts)
--    Groups yarn counts for reporting/filtering.
-- ==========================================================================
create table if not exists public.count_groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  category_id uuid references public.categories(id) on delete set null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint count_groups_code_unique unique (code),
  constraint count_groups_name_unique unique (name)
);
create trigger trg_count_group_updated before update on public.count_groups
  for each row execute function public.set_updated_at();

create table if not exists public.count_group_counts (
  id              uuid primary key default gen_random_uuid(),
  count_group_id  uuid not null references public.count_groups(id) on delete cascade,
  sno             integer not null,
  count_lookup_id uuid references public.config_lookups(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_count_group_count_updated before update on public.count_group_counts
  for each row execute function public.set_updated_at();
create index if not exists idx_count_group_counts_group on public.count_group_counts(count_group_id);

-- ==========================================================================
-- 2. Constructions (Construction + Warp Counts + Weft Counts)
--    Fabric construction types. ShortName/Name auto-generated from
--    Warps + Wefts + Reed + Pick pattern.
-- ==========================================================================
create table if not exists public.constructions (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null,
  reed                integer not null default 0,
  epi_on_loom         integer not null default 0,
  reed_count          text,
  pick                numeric(8,2) not null default 0,
  construct_for       text not null default 'G',
  weave_tech_desc     text,
  category_id         uuid references public.categories(id) on delete set null,
  is_direct_purchase  boolean not null default false,
  is_active           boolean not null default true,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint constructions_code_unique unique (code)
);
create trigger trg_construction_updated before update on public.constructions
  for each row execute function public.set_updated_at();

create table if not exists public.construction_counts (
  id              uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  sno             integer not null,
  count_type      text not null check (count_type in ('P','T')),
  count_lookup_id uuid references public.config_lookups(id) on delete set null,
  item_id         uuid references public.items(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_construction_count_updated before update on public.construction_counts
  for each row execute function public.set_updated_at();
create index if not exists idx_construction_counts_parent on public.construction_counts(construction_id);

-- ==========================================================================
-- 3. Yarn Purchase Rates (Cost_YarnPurchaseRate header + detail)
--    Effective-dated yarn rates: Category → Yarn → Purity → Rate.
--    UOM defaults to KGS. HO-only in VB.NET.
-- ==========================================================================
create sequence if not exists public.seq_yarn_purchase_rate;

create table if not exists public.yarn_purchase_rates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  entry_date      date not null default current_date,
  effective_from  date not null default current_date,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ypr_entry_date_check check (entry_date <= current_date)
);
create trigger trg_ypr_code before insert on public.yarn_purchase_rates
  for each row execute function public.assign_code('YPR','public.seq_yarn_purchase_rate');
create trigger trg_ypr_updated before update on public.yarn_purchase_rates
  for each row execute function public.set_updated_at();

create table if not exists public.yarn_purchase_rate_items (
  id              uuid primary key default gen_random_uuid(),
  rate_id         uuid not null references public.yarn_purchase_rates(id) on delete cascade,
  sno             integer not null,
  category_id     uuid references public.categories(id) on delete set null,
  item_id         uuid references public.items(id) on delete set null,
  purity_id       uuid references public.config_lookups(id) on delete set null,
  uom             text not null default 'KGS',
  rate            numeric(12,4) not null default 0 check (rate > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_ypr_item_updated before update on public.yarn_purchase_rate_items
  for each row execute function public.set_updated_at();
create index if not exists idx_ypr_items_rate on public.yarn_purchase_rate_items(rate_id);

-- ==========================================================================
-- 4. Yarn Debit Rates (YarnDebitRate header + detail)
--    RatePerKG + RatePerBundle. At least one rate must be > 0.
--    No duplicate yarn in same entry.
-- ==========================================================================
create sequence if not exists public.seq_yarn_debit_rate;

create table if not exists public.yarn_debit_rates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  entry_date      date not null default current_date,
  effective_from  date not null default current_date,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ydr_entry_date_check check (entry_date <= current_date)
);
create trigger trg_ydr_code before insert on public.yarn_debit_rates
  for each row execute function public.assign_code('YDR','public.seq_yarn_debit_rate');
create trigger trg_ydr_updated before update on public.yarn_debit_rates
  for each row execute function public.set_updated_at();

create table if not exists public.yarn_debit_rate_items (
  id              uuid primary key default gen_random_uuid(),
  rate_id         uuid not null references public.yarn_debit_rates(id) on delete cascade,
  sno             integer not null,
  item_id         uuid not null references public.items(id) on delete cascade,
  rate_per_kg     numeric(12,4) not null default 0 check (rate_per_kg >= 0),
  rate_per_bundle numeric(12,4) not null default 0 check (rate_per_bundle >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ydr_items_at_least_one_rate check (rate_per_kg > 0 or rate_per_bundle > 0),
  constraint ydr_items_no_dup_yarn unique (rate_id, item_id)
);
create trigger trg_ydr_item_updated before update on public.yarn_debit_rate_items
  for each row execute function public.set_updated_at();
create index if not exists idx_ydr_items_rate on public.yarn_debit_rate_items(rate_id);

-- ==========================================================================
-- 5. Costing Rate for Sizing (CostingRateForSizing header + detail)
--    Rate_EndsUpto (≤10,000 ends) and Rate_EndsMore (>10,000 ends).
-- ==========================================================================
create sequence if not exists public.seq_sizing_rate;

create table if not exists public.sizing_rates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  entry_date      date not null default current_date,
  effective_from  date not null default current_date,
  entry_type      text not null default 'N',
  base_rate       numeric(12,4) not null default 0,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sr_entry_date_check check (entry_date <= current_date)
);
create trigger trg_sr_code before insert on public.sizing_rates
  for each row execute function public.assign_code('SZR','public.seq_sizing_rate');
create trigger trg_sr_updated before update on public.sizing_rates
  for each row execute function public.set_updated_at();

create table if not exists public.sizing_rate_yarns (
  id              uuid primary key default gen_random_uuid(),
  sizing_rate_id  uuid not null references public.sizing_rates(id) on delete cascade,
  sno             integer not null,
  category_id     uuid references public.categories(id) on delete set null,
  item_id         uuid references public.items(id) on delete set null,
  rate_ends_upto  numeric(12,4) not null default 0 check (rate_ends_upto >= 0),
  rate_ends_more  numeric(12,4) not null default 0 check (rate_ends_more >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_sr_yarn_updated before update on public.sizing_rate_yarns
  for each row execute function public.set_updated_at();
create index if not exists idx_sr_yarns_parent on public.sizing_rate_yarns(sizing_rate_id);

-- ==========================================================================
-- 6. Warp Length Allowances (header + detail)
--    Range-based warp length → fabric length conversion allowances.
-- ==========================================================================
create sequence if not exists public.seq_warp_length_allowance;

create table if not exists public.warp_length_allowances (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  entry_date      date not null default current_date,
  effective_from  date not null default current_date,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wla_entry_date_check check (entry_date <= current_date)
);
create trigger trg_wla_code before insert on public.warp_length_allowances
  for each row execute function public.assign_code('WLA','public.seq_warp_length_allowance');
create trigger trg_wla_updated before update on public.warp_length_allowances
  for each row execute function public.set_updated_at();

create table if not exists public.warp_length_allowance_details (
  id                uuid primary key default gen_random_uuid(),
  allowance_id      uuid not null references public.warp_length_allowances(id) on delete cascade,
  sno               integer not null,
  range_type        text not null check (range_type in ('U','B','A')),
  from_warp_length  numeric(12,2) not null default 0,
  to_warp_length    numeric(12,2) not null default 0,
  warp_length       integer not null default 0,
  fabric_length     integer not null default 0,
  weft_waste_pct    numeric(6,2) not null default 0 check (weft_waste_pct >= 0 and weft_waste_pct <= 100),
  shuttle_loom      boolean not null default false,
  shuttleless_loom  boolean not null default false,
  hand_loom         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_wla_detail_updated before update on public.warp_length_allowance_details
  for each row execute function public.set_updated_at();
create index if not exists idx_wla_details_parent on public.warp_length_allowance_details(allowance_id);

-- ==========================================================================
-- 7. Process Sequences (ProcessSequence + child processes)
--    Ordered process steps with loss %. Loss only on last step.
-- ==========================================================================
create table if not exists public.process_sequences (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text not null,
  item_class_type text not null,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint process_sequences_code_unique unique (code)
);
create trigger trg_proc_seq_updated before update on public.process_sequences
  for each row execute function public.set_updated_at();

create table if not exists public.process_sequence_steps (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.process_sequences(id) on delete cascade,
  sno             integer not null,
  stage           text,
  process_id      uuid references public.processes(id) on delete set null,
  process_group   text,
  loss_pct        numeric(6,2) not null default 0,
  loss_for        text not null default 'P',
  rate            numeric(12,4) not null default 0,
  expected_loss_pct numeric(6,2) not null default 0,
  vendor_id       uuid references public.vendors(id) on delete set null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_proc_seq_step_updated before update on public.process_sequence_steps
  for each row execute function public.set_updated_at();
create index if not exists idx_proc_seq_steps_parent on public.process_sequence_steps(sequence_id);

-- ==========================================================================
-- 8. Process Sequence Groups (ProcessSequenceGroup + child sequences)
-- ==========================================================================
create table if not exists public.process_sequence_groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint process_sequence_groups_code_unique unique (code)
);
create trigger trg_proc_seq_group_updated before update on public.process_sequence_groups
  for each row execute function public.set_updated_at();

create table if not exists public.process_sequence_group_members (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.process_sequence_groups(id) on delete cascade,
  sno             integer not null,
  sequence_id     uuid references public.process_sequences(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_proc_seq_group_member_updated before update on public.process_sequence_group_members
  for each row execute function public.set_updated_at();
create index if not exists idx_proc_seq_group_members_group on public.process_sequence_group_members(group_id);

-- ==========================================================================
-- RLS policies for all Phase 2 tables
-- ==========================================================================
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'count_groups','count_group_counts',
      'constructions','construction_counts',
      'yarn_purchase_rates','yarn_purchase_rate_items',
      'yarn_debit_rates','yarn_debit_rate_items',
      'sizing_rates','sizing_rate_yarns',
      'warp_length_allowances','warp_length_allowance_details',
      'process_sequences','process_sequence_steps',
      'process_sequence_groups','process_sequence_group_members'
    ])
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (true)',
      tbl, tbl);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_permission(''masters'',''create''))',
      tbl, tbl);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_permission(''masters'',''edit'')) with check (public.has_permission(''masters'',''edit''))',
      tbl, tbl);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_permission(''masters'',''delete''))',
      tbl, tbl);
  end loop;
end $$;
