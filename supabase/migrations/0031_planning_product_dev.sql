-- ============================================================================
-- Raagam ERP — 0031 Planning ▸ Product Development Pipeline
-- Additive sub-module (legacy EDP2: Planning ▸ Product Development — the 8-step
-- pipeline: Acknowledge PD requests · Group products · Define garment processes
-- · Production of sample · Products processing delivery/receipt · Samples to
-- department & return · Dispatch · Packing list). Modelled as a PD request with
-- a linear `stage` tracker + product lines. Gated by 'planning'.
-- ============================================================================

create sequence if not exists public.seq_pd_request;
create table if not exists public.pd_requests (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- PD-0001
  opportunity_id uuid references public.opportunities(id) on delete set null,
  buyer_id       uuid references public.buyers(id) on delete set null,
  title          text not null,
  description    text,
  stage          text not null default 'acknowledged'
                   check (stage in ('acknowledged','grouped','processes_defined',
                                    'sample_production','processing','samples_to_dept',
                                    'dispatched','packing_list')),
  status         text not null default 'open'
                   check (status in ('open','closed','cancelled')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pd_req_code before insert on public.pd_requests
  for each row execute function public.assign_code('PD','public.seq_pd_request');
create trigger trg_pd_req_updated before update on public.pd_requests
  for each row execute function public.set_updated_at();
create index if not exists idx_pd_req_stage  on public.pd_requests(stage);
create index if not exists idx_pd_req_status on public.pd_requests(status);

create table if not exists public.pd_products (
  id            uuid primary key default gen_random_uuid(),
  pd_request_id uuid not null references public.pd_requests(id) on delete cascade,
  style_id      uuid references public.styles(id) on delete set null,
  name          text not null,
  description   text,
  sort_order    int not null default 0
);
create index if not exists idx_pd_products_req on public.pd_products(pd_request_id);

do $$
declare t text;
begin
  foreach t in array array['pd_requests','pd_products'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
