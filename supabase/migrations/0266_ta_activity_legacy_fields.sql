-- ============================================================================
-- Raagam ERP — 0266 Orders ▸ TA ▸ TA Activity (legacy field parity)
-- Aligns ta_activities with the legacy RP-Software "TA Activity" form
-- (screenshot _13944): Short Name · Blocked · Name · Type (▼ picker) ·
-- Has Sub activities · Consider for Delivery Date.
--
--   Type  → new config_lookups kind 'ta_activity_type' (Add/Modify via the
--           shared LookupDialogPicker), seeded with the legacy Time/Action
--           groups. Stored as ta_activities.type_id.
--   Blocked → represented by the existing is_active column (blocked = NOT active).
--
-- Existing dept/sequence/default_offset_days columns are LEFT IN PLACE (not on
-- this legacy form; retained for TA Plan / TA Department Assign) — additive only.
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK — re-add every live kind (source of
--    truth = lib/masters/extras-types.ts LOOKUP_KINDS) + the new one.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
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
    'ta_activity_type'
  ));

-- 2) TA Activity legacy columns.
alter table public.ta_activities
  add column if not exists type_id                   uuid references public.config_lookups(id) on delete set null,
  add column if not exists has_sub_activities         boolean not null default false,
  add column if not exists consider_for_delivery_date boolean not null default false;

create index if not exists idx_ta_activities_type on public.ta_activities(type_id);

-- 3) Seed the legacy Time/Action activity types idempotently (Add/Modify may
--    extend these later). Names mirror the legacy Time/Action panel groups.
insert into public.config_lookups (kind, code, name, is_active)
select 'ta_activity_type', v.code, v.name, true
from (values
  ('APPR', 'Approvals'),
  ('WFLW', 'Work Flow'),
  ('PURC', 'Purchase'),
  ('PROC', 'Processing'),
  ('GARM', 'Garments'),
  ('GEN',  'General')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups c
  where c.kind = 'ta_activity_type' and c.name = v.name
);
