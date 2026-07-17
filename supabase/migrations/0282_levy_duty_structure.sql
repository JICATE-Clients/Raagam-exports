-- ============================================================================
-- Raagam ERP — 0282 Levy Master: Duty Structure (Type = DUTY)
-- Legacy EDP2 "Duty Structure" screen: same `levies` record, but Type=DUTY
-- swaps the whole field set — BED/EDU-on-BED/SHE-on-BED duty components (not
-- CGST/SGST/IGST/Cess), an Annexure (Category + Category Slno + Calc/Exempt),
-- and a single Account Head instead of one per rate component.
-- ============================================================================

alter table public.levies
  add column if not exists bed_pct numeric(6,2) not null default 0,
  add column if not exists edu_on_bed_pct numeric(6,2) not null default 0,
  add column if not exists she_on_bed_pct numeric(6,2) not null default 0,
  add column if not exists annexure_category_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists annexure_category_sno integer,
  add column if not exists calc_exempt text not null default 'calculated' check (calc_exempt in ('calculated', 'exempted')),
  add column if not exists duty_ac_head uuid references public.gl_accounts(id) on delete set null;

-- New config_lookups kind for the Annexure "Category" picker.
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
    'duty_category'
  ));
