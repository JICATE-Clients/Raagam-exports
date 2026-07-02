-- ============================================================================
-- Raagam ERP — 0209 Production ▸ Despatch   [Lane B]
-- Additive (legacy EDP2: Garmenting ▸ Production ▸ "Despatches"). Records the
-- factory despatch of finished goods → handoff to Logistics; draft → despatched.
-- Gated by the EXISTING 'production' permission.
-- ============================================================================

create sequence if not exists public.seq_despatch;
create table if not exists public.despatches (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- DSP-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  despatch_date  date,
  vehicle_no     text,
  destination    text,
  cartons        numeric(10,0) not null default 0,
  status         text not null default 'draft'
                   check (status in ('draft','despatched','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_dsp_code before insert on public.despatches
  for each row execute function public.assign_code('DSP','public.seq_despatch');
create trigger trg_dsp_updated before update on public.despatches
  for each row execute function public.set_updated_at();
create index if not exists idx_dsp_status on public.despatches(status);

do $$
declare t text;
begin
  foreach t in array array['despatches'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
