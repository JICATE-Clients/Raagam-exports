-- ============================================================================
-- Vendor ▸ Item Category (legacy RP-Software "Vendor" screen, 3rd tab)
--
-- The legacy form reveals an "Item Category" tab only when the Category list's
-- **IsBoughtItemsVendor** box is ticked: a vendor we buy goods from is the only
-- one whose per-item commercial terms matter. It holds a vendor-level "Duty
-- Details" radio and a grid of one row per item class / category the vendor
-- supplies, each carrying its own VAT, duty, lead time, form, type and payment
-- term.
--
-- Nothing here is optional data: the lead days drive purchase planning and the
-- payment term drives the PO, so the grid is a real child table rather than a
-- text column.
-- ============================================================================

-- ---------- vendor-level Duty Details (the radio above the grid) ----------
-- Legacy offers exactly four, single-choice, defaulting to None.
alter table public.master_vendors
  add column if not exists duty_details text not null default 'None';

do $$
begin
  alter table public.master_vendors drop constraint if exists master_vendors_duty_details_check;
  alter table public.master_vendors
    add constraint master_vendors_duty_details_check
    check (duty_details in ('None', 'CT3', 'Annexure', 'RG23'));
end $$;

-- ---------- two new config_lookups kinds ----------
-- "Form" and "Type" are plain ▾ dropdowns on the legacy grid, and the screenshot
-- does not show their contents. They are modelled as managed lists rather than
-- guessed `as const` arrays: the operator adds the exact legacy values through
-- the picker's own + Add, and nothing invented ships in the schema. Seed them
-- here once the legacy lists are known.
--
-- The whole kind list has to be restated — a CHECK cannot be extended in place.
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
    'vendor_item_form','vendor_supply_type'
  ));

-- ---------- the grid ----------
create table if not exists public.master_vendor_item_categories (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.master_vendors(id) on delete cascade,
  sno             integer not null default 0,

  -- Item Class -> Category is the app-wide hierarchy: `categories.item_class_id`
  -- FKs the same config_lookups(kind='item_class') list, so the Category picker
  -- on this row is scoped by the class picked beside it.
  item_class_id   uuid references public.config_lookups(id) on delete set null,
  category_id     uuid references public.categories(id) on delete set null,

  -- Both are `levies` rows, told apart by `levies.type`: VAT/CST for the first,
  -- DUTY/EXCISE DUTY for the second. One master, two filtered pickers.
  vat_levy_id     uuid references public.levies(id) on delete set null,
  duty_levy_id    uuid references public.levies(id) on delete set null,

  lead_days       integer check (lead_days is null or lead_days >= 0),
  form_id         uuid references public.config_lookups(id) on delete set null,
  supply_type_id  uuid references public.config_lookups(id) on delete set null,
  payment_term_id uuid references public.payment_terms(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_mvic_vendor on public.master_vendor_item_categories(vendor_id);
create index if not exists idx_mvic_item_class on public.master_vendor_item_categories(item_class_id);
create index if not exists idx_mvic_category on public.master_vendor_item_categories(category_id);
create index if not exists idx_mvic_payment_term on public.master_vendor_item_categories(payment_term_id);

drop trigger if exists trg_master_vendor_item_categories_updated on public.master_vendor_item_categories;
create trigger trg_master_vendor_item_categories_updated
  before update on public.master_vendor_item_categories
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy master_vendor_item_categories_read on public.master_vendor_item_categories
      for select to authenticated using (true);
    create policy master_vendor_item_categories_insert on public.master_vendor_item_categories
      for insert to authenticated with check (public.has_permission('masters','create'));
    create policy master_vendor_item_categories_update on public.master_vendor_item_categories
      for update to authenticated using (public.has_permission('masters','edit'))
      with check (public.has_permission('masters','edit'));
    create policy master_vendor_item_categories_delete on public.master_vendor_item_categories
      for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
exception
  when duplicate_object then null;
end $$;

alter table public.master_vendor_item_categories enable row level security;
