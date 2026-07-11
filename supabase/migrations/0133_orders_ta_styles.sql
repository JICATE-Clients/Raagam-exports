-- ============================================================================
-- Raagam ERP — 0133 Orders ▸ TA ▸ TA Style (Time & Action template)
-- Legacy "TA Style": a reusable T&A template document — header (Style Ref No auto
-- code · Customer · Description · Lead/Start Days) + an Activity grid (S No ·
-- Activity · From Activity · Days Required) + computed Target Days / No of Days.
-- Activities reference the ta_activities master (0035/0266). The screen builds out
-- the /orders/ta-style scaffold. Gated by the existing 'orders' permission.
-- ============================================================================

create sequence if not exists public.seq_ta_style;
create table if not exists public.ta_styles (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                                 -- Style Ref No (TAS-0001)
  is_draft     boolean not null default false,
  blocked      boolean not null default false,
  customer_id  uuid references public.customers(id),        -- Customer ⓘ
  description  text,                                        -- Description
  lead_days    int not null default 0,
  start_days   int not null default 0,
  target_days  int not null default 0,                      -- computed on save
  no_of_days   int not null default 0,                      -- computed on save
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_tastyle_code before insert on public.ta_styles
  for each row execute function public.assign_code('TAS','public.seq_ta_style');
create trigger trg_tastyle_updated before update on public.ta_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_tastyle_customer on public.ta_styles(customer_id);

-- one row per template activity (the "Activity" grid)
create table if not exists public.ta_style_activities (
  id               uuid primary key default gen_random_uuid(),
  style_id         uuid not null references public.ta_styles(id) on delete cascade,
  sno              int not null default 0,
  activity_id      uuid references public.ta_activities(id),   -- Activity ⓘ
  from_activity_id uuid references public.ta_activities(id),   -- From Activity ⓘ
  days_required    int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_tastyleact_style on public.ta_style_activities(style_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_styles','ta_style_activities'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
