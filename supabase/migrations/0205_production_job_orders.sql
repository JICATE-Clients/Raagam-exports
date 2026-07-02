-- ============================================================================
-- Raagam ERP — 0205 Production ▸ Job Orders (+ Component Details)   [Lane B]
-- Additive (legacy EDP2: Garmenting ▸ Production Planning ▸ "Job Orders",
-- "Component Details"). An internal production job (stage-from → stage-to over a
-- style) with component lines. Gated by the EXISTING 'production' permission.
-- ============================================================================

create sequence if not exists public.seq_production_job_order;
create table if not exists public.production_job_orders (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- JO-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  description    text,
  stage_from     text,
  stage_to       text,
  style_ref      text,
  status         text not null default 'draft'
                   check (status in ('draft','open','completed','cancelled')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pjo_code before insert on public.production_job_orders
  for each row execute function public.assign_code('JO','public.seq_production_job_order');
create trigger trg_pjo_updated before update on public.production_job_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_pjo_status on public.production_job_orders(status);

create table if not exists public.job_order_components (
  id             uuid primary key default gen_random_uuid(),
  job_order_id   uuid not null references public.production_job_orders(id) on delete cascade,
  component_name text not null,
  description    text,
  quantity       numeric(14,2) not null default 0,
  sort_order     int not null default 0
);
create index if not exists idx_joc_job on public.job_order_components(job_order_id);

do $$
declare t text;
begin
  foreach t in array array['production_job_orders','job_order_components'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
