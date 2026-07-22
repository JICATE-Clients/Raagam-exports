-- ============================================================================
-- Raagam ERP — 0337 Packing List Format Column Configuration
--
-- Stores per-format column visibility and ordering for packing list output.
-- Each packing_list_format (config_lookups) can have its own column layout.
-- ============================================================================

create table if not exists public.packing_list_format_columns (
  id                      uuid primary key default gen_random_uuid(),
  packing_list_format_id  uuid not null references public.config_lookups(id) on delete cascade,
  column_key              text not null,
  display_name            text not null,
  display_order           integer not null default 0,
  is_visible              boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint packing_cols_unique unique (packing_list_format_id, column_key)
);

create trigger trg_packing_cols_updated before update on public.packing_list_format_columns
  for each row execute function public.set_updated_at();

create index if not exists idx_packing_cols_format
  on public.packing_list_format_columns(packing_list_format_id);

-- RLS
alter table public.packing_list_format_columns enable row level security;

create policy packing_cols_read on public.packing_list_format_columns
  for select to authenticated using (true);
create policy packing_cols_insert on public.packing_list_format_columns
  for insert to authenticated with check (public.has_permission('masters','create'));
create policy packing_cols_update on public.packing_list_format_columns
  for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy packing_cols_delete on public.packing_list_format_columns
  for delete to authenticated using (public.has_permission('masters','delete'));
