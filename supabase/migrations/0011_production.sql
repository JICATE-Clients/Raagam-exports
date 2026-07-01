-- ============================================================================
-- Raagam ERP — 0011 Production Tracking
-- Cutting → Sewing → Packing piece tracking, sewing line/team management,
-- two-step entry (supervisor records → manager confirms), reject & rework.
-- Confirmed stage entries best-effort complete the matching Order T&A milestone
-- (wired in lib/production/actions). Feeds piece-rate Payroll later.
-- ============================================================================

-- ---------- production lines / sewing teams ----------
create table if not exists public.production_lines (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  location_id uuid references public.locations(id),
  line_type   text not null default 'sewing'
                check (line_type in ('cutting','sewing','packing','general')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_prodlines_updated before update on public.production_lines
  for each row execute function public.set_updated_at();

-- ---------- production entries (per stage) ----------
create table if not exists public.production_entries (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  stage          text not null check (stage in ('cutting','sewing','packing')),
  line_id        uuid references public.production_lines(id),
  entry_date     date not null default current_date,
  color          text,
  size           text,
  good_qty       numeric(14,0) not null default 0 check (good_qty >= 0),
  reject_qty     numeric(14,0) not null default 0 check (reject_qty >= 0),
  is_rework      boolean not null default false,
  status         text not null default 'recorded' check (status in ('recorded','confirmed')),
  note           text,
  recorded_by    uuid references public.profiles(id) default auth.uid(),
  confirmed_by   uuid references public.profiles(id),
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_proden_updated before update on public.production_entries
  for each row execute function public.set_updated_at();
create index if not exists idx_proden_order on public.production_entries(sales_order_id);
create index if not exists idx_proden_stage on public.production_entries(stage);
create index if not exists idx_proden_line  on public.production_entries(line_id);
create index if not exists idx_proden_date  on public.production_entries(entry_date desc);

-- ---------- RLS (gated by 'production') ----------
do $$
declare t text;
begin
  foreach t in array array['production_lines','production_entries'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('production','edit'))
        with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- roles + grants ----------
insert into public.roles (name, description, is_system)
values ('Supervisor', 'Records production output for confirmation', false)
on conflict (name) do nothing;

-- Supervisor: record/edit production (no confirm)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'production' and p.action in ('view','create','edit')
where r.name = 'Supervisor' on conflict do nothing;

-- Manager: full production incl. approve (confirm) + export
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'production' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager' on conflict do nothing;

-- Merchandiser: view production (order progress)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'production' and p.action = 'view'
where r.name = 'Merchandiser' on conflict do nothing;

-- ---------- seed representative sewing lines (HO + Unit 2) ----------
insert into public.production_lines (code, name, line_type, location_id)
select l.code, l.name, 'sewing', (select id from public.locations where code = l.loc)
from (values
  ('A1','Sewing Line A1','HO'),
  ('A2','Sewing Line A2','HO'),
  ('B1','Sewing Line B1','HO'),
  ('C1','Sewing Line C1','HO'),
  ('C6','Sewing Line C6','HO'),
  ('IIA1','Sewing Line IIA1','U2'),
  ('IIB1','Sewing Line IIB1','U2'),
  ('IIC1','Sewing Line IIC1','U2')
) as l(code, name, loc)
where not exists (select 1 from public.production_lines);
