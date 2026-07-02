-- ============================================================================
-- Raagam ERP — 0110 Process Planning ▸ Knitting Program
-- Commercial lane (band 0100–0199). Additive sub-module of Process Planning
-- (legacy EDP2: Planning ▸ Process Planning ▸ "Prepare knitting specifications" /
-- "Prepare Knitting Program"). Knitting production schedule. Gated by 'process_planning'.
-- ============================================================================

create sequence if not exists public.seq_knitting_program;
create table if not exists public.knitting_programs (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                -- KP-0001 (assign_code)
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  fabric_desc    text,
  yarn_desc      text,
  gauge          text,
  diameter       text,
  gsm            numeric(10,2),
  planned_qty    numeric(14,2) not null default 0,
  uom            text default 'Kg',
  machine        text,
  start_date     date,
  end_date       date,
  status         text not null default 'draft'
                   check (status in ('draft','running','completed','cancelled')),
  remarks        text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_kp_code before insert on public.knitting_programs
  for each row execute function public.assign_code('KP','public.seq_knitting_program');
create trigger trg_kp_updated before update on public.knitting_programs
  for each row execute function public.set_updated_at();
create index if not exists idx_kp_order  on public.knitting_programs(sales_order_id);
create index if not exists idx_kp_status on public.knitting_programs(status);

-- ---------- RLS (reuse the existing 'process_planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['knitting_programs'] loop
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
