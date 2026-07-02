-- ============================================================================
-- Raagam ERP — 0111 Process Planning ▸ Process RFQ & Rate Confirmation
-- Commercial lane (band 0100–0199). Additive sub-module of Process Planning
-- (legacy EDP2: Planning ▸ Process Planning ▸ RFQ → receive quotes → confirm
-- price & qty; price-more-than-budget confirmation). Gated by 'process_planning'.
-- ============================================================================

create sequence if not exists public.seq_process_rfq;
create table if not exists public.process_rfqs (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                            -- PRFQ-0001 (assign_code)
  sales_order_id     uuid references public.sales_orders(id) on delete set null,
  process_type       text not null default 'dyeing'
                       check (process_type in ('knitting','dyeing','printing','washing','finishing','embroidery','other')),
  description        text,
  quantity           numeric(14,2) not null default 0,
  uom                text,
  budget_rate        numeric(14,4) not null default 0,
  confirmed_vendor_id uuid references public.vendors(id),
  confirmed_rate     numeric(14,4),
  over_budget_approved boolean not null default false,
  status             text not null default 'open'
                       check (status in ('open','confirmed','cancelled')),
  remarks            text,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_prfq_code before insert on public.process_rfqs
  for each row execute function public.assign_code('PRFQ','public.seq_process_rfq');
create trigger trg_prfq_updated before update on public.process_rfqs
  for each row execute function public.set_updated_at();
create index if not exists idx_prfq_order  on public.process_rfqs(sales_order_id);
create index if not exists idx_prfq_status on public.process_rfqs(status);

create table if not exists public.process_rfq_quotes (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.process_rfqs(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id),
  rate          numeric(14,4) not null default 0,
  delivery_days int,
  remarks       text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_prfq_quotes_rfq on public.process_rfq_quotes(rfq_id);

-- ---------- RLS (reuse the existing 'process_planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['process_rfqs','process_rfq_quotes'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('process_planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('process_planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('process_planning','edit'))
        with check (public.has_permission('process_planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('process_planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
