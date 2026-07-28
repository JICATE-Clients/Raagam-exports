-- ============================================================================
-- Raagam ERP -- 0355 Process Orders
-- From VB.NET FrmProcessOrder, FrmFN_PrepareProcessOrder — send materials
-- to external processors (dyeing, printing, knitting, washing, finishing).
-- Lives under /stores in the new ERP, shares 'stores' permission key.
-- ============================================================================

create sequence if not exists public.seq_process_order;

create table if not exists public.process_orders (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  vendor_id       uuid not null references public.vendors(id),
  location_id     uuid references public.locations(id),
  process_type    text not null check (process_type in
                    ('dyeing','printing','knitting','washing','finishing','embroidery','other')),
  status          text not null default 'draft' check (status in
                    ('draft','issued','in_process','partially_received','received','closed','cancelled')),
  order_date      date,
  expected_date   date,
  currency_code   text references public.currencies(code),
  total_amount    numeric(16,2) not null default 0,
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_proc_code before insert on public.process_orders
  for each row execute function public.assign_code('PROC','public.seq_process_order');
create trigger trg_proc_updated before update on public.process_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_proc_vendor on public.process_orders(vendor_id);
create index if not exists idx_proc_status on public.process_orders(status);

create table if not exists public.process_order_lines (
  id                uuid primary key default gen_random_uuid(),
  process_order_id  uuid not null references public.process_orders(id) on delete cascade,
  item_id           uuid references public.items(id),
  description       text not null,
  sent_qty          numeric(14,3) not null default 0,
  received_qty      numeric(14,3) not null default 0,
  uom_id            uuid references public.uoms(id),
  rate              numeric(14,4) not null default 0,
  amount            numeric(16,2) not null default 0,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_procl_order on public.process_order_lines(process_order_id);
create trigger trg_procl_updated before update on public.process_order_lines
  for each row execute function public.set_updated_at();

-- --- Material Issue for Processing ---
create sequence if not exists public.seq_process_issue;

create table if not exists public.process_material_issues (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  process_order_id  uuid not null references public.process_orders(id),
  store_id          uuid not null references public.stores(id),
  issue_date        date,
  status            text not null default 'draft' check (status in ('draft','issued')),
  notes             text,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_pmi_code before insert on public.process_material_issues
  for each row execute function public.assign_code('PMI','public.seq_process_issue');
create trigger trg_pmi_updated before update on public.process_material_issues
  for each row execute function public.set_updated_at();
create index if not exists idx_pmi_proc on public.process_material_issues(process_order_id);

create table if not exists public.process_material_issue_lines (
  id        uuid primary key default gen_random_uuid(),
  issue_id  uuid not null references public.process_material_issues(id) on delete cascade,
  item_id   uuid references public.items(id),
  quantity  numeric(14,3) not null default 0,
  uom_id    uuid references public.uoms(id),
  sort_order int not null default 0
);

create index if not exists idx_pmil_issue on public.process_material_issue_lines(issue_id);

-- --- Receipt from Processing ---
create sequence if not exists public.seq_process_receipt;

create table if not exists public.process_material_receipts (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  process_order_id  uuid not null references public.process_orders(id),
  store_id          uuid not null references public.stores(id),
  receipt_date      date,
  status            text not null default 'draft' check (status in ('draft','posted')),
  notes             text,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_pmr_code before insert on public.process_material_receipts
  for each row execute function public.assign_code('PMR','public.seq_process_receipt');
create trigger trg_pmr_updated before update on public.process_material_receipts
  for each row execute function public.set_updated_at();
create index if not exists idx_pmr_proc on public.process_material_receipts(process_order_id);

create table if not exists public.process_material_receipt_lines (
  id                uuid primary key default gen_random_uuid(),
  receipt_id        uuid not null references public.process_material_receipts(id) on delete cascade,
  item_id           uuid references public.items(id),
  received_qty      numeric(14,3) not null default 0,
  accepted_qty      numeric(14,3) not null default 0,
  rejected_qty      numeric(14,3) not null default 0,
  qc_status         text not null default 'pending'
                      check (qc_status in ('pending','passed','failed','partial')),
  rejection_reason  text,
  sort_order        int not null default 0
);

create index if not exists idx_pmrl_receipt on public.process_material_receipt_lines(receipt_id);

-- RLS (all under 'stores' permission)
do $$
declare t text;
begin
  foreach t in array array[
    'process_orders','process_order_lines',
    'process_material_issues','process_material_issue_lines',
    'process_material_receipts','process_material_receipt_lines'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('stores','edit'))
        with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
  end loop;
end $$;
