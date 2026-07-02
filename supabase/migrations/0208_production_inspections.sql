-- ============================================================================
-- Raagam ERP — 0208 Production ▸ Inspection   [Lane B]
-- Additive (legacy EDP2: Garmenting ▸ Production ▸ "Inspections"). Final QC
-- inspection of an order lot; draft → completed with a pass/fail/rework result.
-- Gated by the EXISTING 'production' permission.
-- ============================================================================

create sequence if not exists public.seq_inspection;
create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                -- INS-0001
  sales_order_id  uuid references public.sales_orders(id) on delete set null,
  inspection_date date,
  inspector       text,
  sample_size     numeric(10,0) not null default 0,
  defects_found   numeric(10,0) not null default 0,
  result          text not null default 'pending'
                    check (result in ('pending','pass','fail','rework')),
  status          text not null default 'draft'
                    check (status in ('draft','completed','cancelled')),
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_ins_code before insert on public.inspections
  for each row execute function public.assign_code('INS','public.seq_inspection');
create trigger trg_ins_updated before update on public.inspections
  for each row execute function public.set_updated_at();
create index if not exists idx_ins_status on public.inspections(status);

do $$
declare t text;
begin
  foreach t in array array['inspections'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
