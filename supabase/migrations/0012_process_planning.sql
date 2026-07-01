-- ============================================================================
-- Raagam ERP — 0012 Process Planning
-- Outsourced knitting / dyeing / stentering / compacting. Planner manually
-- creates a job order, material goes out to the processor (by DC), and on return
-- we capture a quality check + loss vs BOM. Good qty stock-in to the Processing
-- store is wired in lib/process/actions (admin client).
-- ============================================================================

create sequence if not exists public.seq_process_job;
create table if not exists public.process_jobs (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique,
  process_type         text not null check (process_type in
                         ('knitting','dyeing','stentering','compacting','other')),
  processor_id         uuid references public.vendors(id),
  sales_order_id       uuid references public.sales_orders(id) on delete set null,
  fabric_bom_id        uuid references public.fabric_boms(id) on delete set null,
  item_id              uuid references public.items(id),
  description          text,
  sent_qty             numeric(14,3) not null default 0,
  uom_id               uuid references public.uoms(id),
  dc_id                uuid references public.delivery_challans(id),
  planned_loss_pct     numeric(6,2) not null default 0,
  expected_return_date date,
  status               text not null default 'draft'
                         check (status in ('draft','issued','in_process','received','closed')),
  notes                text,
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_pjob_code before insert on public.process_jobs
  for each row execute function public.assign_code('PJ','public.seq_process_job');
create trigger trg_pjob_updated before update on public.process_jobs
  for each row execute function public.set_updated_at();
create index if not exists idx_pjob_processor on public.process_jobs(processor_id);
create index if not exists idx_pjob_status on public.process_jobs(status);

-- partial returns: a job can receive material back across several receipts
create table if not exists public.process_job_receipts (
  id              uuid primary key default gen_random_uuid(),
  process_job_id  uuid not null references public.process_jobs(id) on delete cascade,
  received_date   date not null default current_date,
  received_qty    numeric(14,3) not null default 0,
  good_qty        numeric(14,3) not null default 0,
  rejected_qty    numeric(14,3) not null default 0,
  loss_qty        numeric(14,3) not null default 0,   -- shrinkage vs sent (process loss)
  quality_status  text not null default 'passed'
                    check (quality_status in ('passed','failed','partial')),
  quality_notes   text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_pjrcpt_job on public.process_job_receipts(process_job_id);

-- ---------- RLS (gated by 'process_planning') ----------
do $$
declare t text;
begin
  foreach t in array array['process_jobs','process_job_receipts'] loop
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

-- ---------- grants ----------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'process_planning' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager' on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'process_planning' and p.action in ('view','create','edit')
where r.name = 'Merchandiser' on conflict do nothing;
