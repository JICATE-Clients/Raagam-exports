-- ============================================================================
-- Raagam ERP — 0217 Administration ▸ Courier   [Lane B]
-- ADD-ONLY: does not touch existing admin (users/roles) tables. Legacy EDP2:
-- Administration ▸ Courier (Couriers master · Courier Invoices · Despatches ·
-- PODs). A courier master + despatch records that fold in invoice + POD fields;
-- draft → despatched → delivered. Gated by the EXISTING 'system_admin' permission.
-- ============================================================================

create sequence if not exists public.seq_courier_master;
create table if not exists public.couriers (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- CUR-0001
  name           text not null,
  contact_person text,
  phone          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_courier_master_code before insert on public.couriers
  for each row execute function public.assign_code('CUR','public.seq_courier_master');
create trigger trg_courier_master_updated before update on public.couriers
  for each row execute function public.set_updated_at();

create sequence if not exists public.seq_courier_despatch;
create table if not exists public.courier_despatches (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- CDS-0001
  courier_id     uuid references public.couriers(id) on delete set null,
  reference      text,
  despatch_date  date,
  destination    text,
  contents       text,
  invoice_no     text,
  invoice_amount numeric(14,2),
  pod_reference  text,
  pod_date       date,
  status         text not null default 'draft'
                   check (status in ('draft','despatched','delivered','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_cds_code before insert on public.courier_despatches
  for each row execute function public.assign_code('CDS','public.seq_courier_despatch');
create trigger trg_cds_updated before update on public.courier_despatches
  for each row execute function public.set_updated_at();
create index if not exists idx_cds_courier on public.courier_despatches(courier_id);
create index if not exists idx_cds_status  on public.courier_despatches(status);

do $$
declare t text;
begin
  foreach t in array array['couriers','courier_despatches'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('system_admin','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('system_admin','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('system_admin','edit')) with check (public.has_permission('system_admin','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('system_admin','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
