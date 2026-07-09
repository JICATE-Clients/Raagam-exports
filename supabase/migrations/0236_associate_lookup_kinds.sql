-- ============================================================================
-- Raagam ERP — 0236 Master Data ▸ config_lookups: add Associate picker kinds
-- The Applicant (Associates) form has green ⊕ / blue ⓘ pickers for City, State,
-- Department, Designation and Internal Department. Each is a simple Code+Name
-- list, so they ride on the generic config_lookups table (like counts / yarn
-- purities / hsn codes). This only widens the kind CHECK — no data change.
-- Re-adds the constraint with every existing kind preserved + 5 new ones.
-- ============================================================================

alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute',
    'levy',
    'material_category',
    'material_attribute',
    'yarn_count',
    'yarn_purity',
    'composition',
    'process',
    'component',
    'gauge',
    'knitting_dia',
    'out_doc_term',
    'commodity',
    'item_class',
    'hsn_code',
    'city',
    'state',
    'department',
    'designation',
    'internal_department'
  ));
