-- ============================================================================
-- Raagam ERP — 0119 Finance ▸ Masters ▸ Cost Heads & Cost Items
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Masters ▸ "Cost Heads" / "Cost Categories" /
-- "Cost Items"). Cost-head catalogue + granular cost items. Gated by 'finance'.
-- ============================================================================

create table if not exists public.cost_heads (
  id         uuid primary key default gen_random_uuid(),
  code       text,
  name       text not null,
  category   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_costhead_updated before update on public.cost_heads
  for each row execute function public.set_updated_at();

create table if not exists public.cost_items (
  id           uuid primary key default gen_random_uuid(),
  code         text,
  name         text not null,
  cost_head_id uuid references public.cost_heads(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_costitem_updated before update on public.cost_items
  for each row execute function public.set_updated_at();
create index if not exists idx_costitem_head on public.cost_items(cost_head_id);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['cost_heads','cost_items'] loop
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
