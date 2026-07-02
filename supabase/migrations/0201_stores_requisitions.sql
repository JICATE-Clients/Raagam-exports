-- ============================================================================
-- Raagam ERP — 0201 Stores ▸ Material Requisition Slip (MRS)   [Lane B]
-- Additive sub-module (legacy EDP2: Materials ▸ Store ▸ "Material Requisition
-- Slips / Requisitions Approved"). A department request for material from a
-- store; draft → submitted → approved → issued (posts `issue` rows to the
-- stock_ledger). Gated by the EXISTING 'stores' permission.
-- ============================================================================

create sequence if not exists public.seq_material_requisition;
create table if not exists public.material_requisitions (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                  -- MRS-0001
  store_id      uuid not null references public.stores(id) on delete cascade,
  department    text not null,
  required_date date,
  status        text not null default 'draft'
                  check (status in ('draft','submitted','approved','issued','rejected','cancelled')),
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_mrs_code before insert on public.material_requisitions
  for each row execute function public.assign_code('MRS','public.seq_material_requisition');
create trigger trg_mrs_updated before update on public.material_requisitions
  for each row execute function public.set_updated_at();
create index if not exists idx_mrs_store  on public.material_requisitions(store_id);
create index if not exists idx_mrs_status on public.material_requisitions(status);

create table if not exists public.material_requisition_lines (
  id                      uuid primary key default gen_random_uuid(),
  material_requisition_id uuid not null references public.material_requisitions(id) on delete cascade,
  item_id                 uuid not null references public.items(id),
  requested_qty           numeric(14,3) not null default 0,
  issued_qty              numeric(14,3) not null default 0,
  sort_order              int not null default 0
);
create index if not exists idx_mrs_lines on public.material_requisition_lines(material_requisition_id);

do $$
declare t text;
begin
  foreach t in array array['material_requisitions','material_requisition_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('stores','edit')) with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
