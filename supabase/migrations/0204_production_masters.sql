-- ============================================================================
-- Raagam ERP — 0204 Production ▸ Planning masters (Work Types, Sewing Operations)
-- [Lane B · band 0200–0299]  Additive (legacy EDP2: Garmenting ▸ Production
-- Planning ▸ "Work Types", "Sewing Operations"). Config masters gated by the
-- EXISTING 'production' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_work_type;
create table if not exists public.work_types (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,                                     -- WT-0001
  stage      text,                                            -- CP / SW / PACK / etc.
  short_name text,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_wt_code before insert on public.work_types
  for each row execute function public.assign_code('WT','public.seq_work_type');
create trigger trg_wt_updated before update on public.work_types
  for each row execute function public.set_updated_at();

create sequence if not exists public.seq_sewing_operation;
create table if not exists public.sewing_operations (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,                                     -- SOP-0001
  name       text not null,
  smv        numeric(10,2),                                   -- standard minute value
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_sop_code before insert on public.sewing_operations
  for each row execute function public.assign_code('SOP','public.seq_sewing_operation');
create trigger trg_sop_updated before update on public.sewing_operations
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['work_types','sewing_operations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
