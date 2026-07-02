-- ============================================================================
-- Raagam ERP — 0106 Finance ▸ Masters ▸ Cost Centres
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Masters ▸ "Cost Centre Groups" / "Cost Centres").
-- Department-wise cost-centre hierarchy. Gated by 'finance'.
-- ============================================================================

create table if not exists public.cost_centre_groups (
  id         uuid primary key default gen_random_uuid(),
  code       text,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_ccg_updated before update on public.cost_centre_groups
  for each row execute function public.set_updated_at();

create table if not exists public.cost_centres (
  id         uuid primary key default gen_random_uuid(),
  code       text,
  name       text not null,
  group_id   uuid references public.cost_centre_groups(id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cc_updated before update on public.cost_centres
  for each row execute function public.set_updated_at();
create index if not exists idx_cc_group on public.cost_centres(group_id);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['cost_centre_groups','cost_centres'] loop
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
