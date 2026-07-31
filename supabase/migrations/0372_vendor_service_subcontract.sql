-- ============================================================================
-- Vendor ▸ Service + SubContractor (legacy RP-Software "Vendor" screen)
--
-- The last two of the four category-gated tabs, shipped together because they
-- are the same shape:
--   IsServiceProvider → "Service Detail"      : ServiceType · Payment Terms
--   IsSubContractor   → "Vendor SubContractor Detail" : Process Name · Payment Terms
-- Both hang the same vendor-level TDS / ESI panel that 0370 added columns for.
--
-- SubContractor gets its OWN table rather than a `kind` discriminator on
-- master_vendor_processes: a vendor can legitimately be both, the two grids do
-- not share columns (a sub-contract row has no VAT or Vat Portion %), and a
-- shared table would carry meaningless-but-present VAT columns plus a filter
-- that is silently wrong the day someone forgets it.
-- ============================================================================

-- ---------- the ServiceType list ----------
-- A ⓘ picker on the legacy grid, so a stored list — but no screenshot shows its
-- contents, so it is a managed list the operator fills through the picker's own
-- + Add rather than invented `as const` values. Seed it once the legacy list is
-- known.
--
-- NOTE the whole kind list is restated: a CHECK cannot be extended, and dropping
-- one silently un-saves every row using it. This list therefore INCLUDES 0369's
-- vendor_item_form / vendor_supply_type.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups
  add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state','department',
    'designation','internal_department','ship_type','payment_term','employee_category',
    'team','account_schedule','vendor_group','agent_type','agent','packing_list_format',
    'commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from',
    'style_category','coordinate','style_component','structure','trims_category','size',
    'roll_form_print','warehouse',
    'ta_activity_type',
    'fabric_structure','fabric_type','yarn_type',
    'duty_category',
    -- Associates ▸ Vendor ▸ Item Category grid (0369)
    'vendor_item_form','vendor_supply_type',
    -- Associates ▸ Vendor ▸ Service grid (0372)
    'vendor_service_type'
  ));

-- ---------- Service Detail ----------
create table if not exists public.master_vendor_services (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.master_vendors(id) on delete cascade,
  sno             integer not null default 0,
  service_type_id uuid references public.config_lookups(id) on delete set null,
  payment_term_id uuid references public.payment_terms(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_mvs_vendor on public.master_vendor_services(vendor_id);
create index if not exists idx_mvs_service_type on public.master_vendor_services(service_type_id);
create index if not exists idx_mvs_payment_term on public.master_vendor_services(payment_term_id);

drop trigger if exists trg_master_vendor_services_updated on public.master_vendor_services;
create trigger trg_master_vendor_services_updated
  before update on public.master_vendor_services
  for each row execute function public.set_updated_at();

-- ---------- Vendor SubContractor Detail ----------
create table if not exists public.master_vendor_subcontracts (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.master_vendors(id) on delete cascade,
  sno             integer not null default 0,
  -- The same Process master a processor's rows point at (0227).
  process_id      uuid references public.processes(id) on delete set null,
  payment_term_id uuid references public.payment_terms(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_mvsc_vendor on public.master_vendor_subcontracts(vendor_id);
create index if not exists idx_mvsc_process on public.master_vendor_subcontracts(process_id);
create index if not exists idx_mvsc_payment_term on public.master_vendor_subcontracts(payment_term_id);

drop trigger if exists trg_master_vendor_subcontracts_updated on public.master_vendor_subcontracts;
create trigger trg_master_vendor_subcontracts_updated
  before update on public.master_vendor_subcontracts
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['master_vendor_services','master_vendor_subcontracts'] loop
    begin
      execute format($f$
        create policy %1$s_read on public.%1$s for select to authenticated using (true);
        create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
        create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
        create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
      $f$, t);
    exception
      when duplicate_object then null;
    end;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
