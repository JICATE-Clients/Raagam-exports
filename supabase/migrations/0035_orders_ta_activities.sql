-- ============================================================================
-- Raagam ERP — 0035 Orders ▸ TA Masters (Activities)
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ TA ▸ "TA Activity" +
-- "TA Department Assign"). Master catalogue of Time & Action activities, each
-- owned by a department, with a default planned offset (days vs ship date).
-- Gated by 'orders'.
-- ============================================================================

create table if not exists public.ta_activities (
  id                  uuid primary key default gen_random_uuid(),
  short_name          text not null,
  name                text not null,
  department          text,
  sequence            int not null default 0,
  default_offset_days int not null default 0,   -- negative = before ship date
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ta_activity_updated before update on public.ta_activities
  for each row execute function public.set_updated_at();
create index if not exists idx_ta_activities_active on public.ta_activities(is_active);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_activities'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
