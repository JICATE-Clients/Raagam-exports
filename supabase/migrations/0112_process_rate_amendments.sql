-- ============================================================================
-- Raagam ERP — 0112 Process Planning ▸ Rate Amendment
-- Commercial lane (band 0100–0199). Additive sub-module of Process Planning
-- (legacy EDP2: Planning ▸ Process Planning ▸ "Rate Amendment for process order" /
-- "Rate Amendments for Knitting order"). Amend a confirmed process RFQ's rate
-- with approval; on approval the new rate is applied. Gated by 'process_planning'.
-- ============================================================================

create sequence if not exists public.seq_process_rate_amendment;
create table if not exists public.process_rate_amendments (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                -- PRA-0001 (assign_code)
  process_rfq_id uuid not null references public.process_rfqs(id) on delete cascade,
  old_rate       numeric(14,4),
  new_rate       numeric(14,4) not null default 0,
  reason         text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  requested_by   uuid references public.profiles(id) default auth.uid(),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decided_reason text,
  created_at     timestamptz not null default now()
);
create trigger trg_pra_code before insert on public.process_rate_amendments
  for each row execute function public.assign_code('PRA','public.seq_process_rate_amendment');
create index if not exists idx_pra_rfq    on public.process_rate_amendments(process_rfq_id);
create index if not exists idx_pra_status on public.process_rate_amendments(status);

-- ---------- RLS (reuse the existing 'process_planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['process_rate_amendments'] loop
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
