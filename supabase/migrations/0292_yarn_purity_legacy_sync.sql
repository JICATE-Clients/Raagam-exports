-- ============================================================================
-- Raagam ERP — 0292 Master Data ▸ Materials ▸ Yarn Purities: legacy data sync
-- Backfills the `yarn_purity` config_lookups from the legacy EDP2 "Yarn
-- purities - U2" report export (12 rows). Idempotent — guarded per-row by
-- `where not exists`, so re-running this migration is a no-op.
--
-- The 3 rows already present with matching codes ('COMBED', 'SEMI COMBED',
-- 'VL COMBED') are skipped by the guard.
-- ============================================================================

insert into public.config_lookups (kind, code, name, is_active, created_at, created_by)
select 'yarn_purity', v.code, v.name, v.is_active, v.created_at::timestamptz, v.created_by
from (values
  ('COMBED','COMBED',true,date '2014-01-19','admin'),
  ('COMBED COMPACT','COMBED COMPACT',true,date '2023-05-10','admin'),
  ('COMPACT','COMPACT',true,date '2023-06-14','admin'),
  ('GASED','GASED',true,date '2022-08-23','admin'),
  ('MERCERIZED','MERCERIZED',true,date '2022-08-18','admin'),
  ('OE','OE',true,date '2023-04-29','admin'),
  ('RED LABEL','RED LABEL',true,date '2014-01-19','admin'),
  ('RL COMPACT','RL COMPACT',true,date '2022-08-17','admin'),
  ('SEMI COMBED','SEMI COMBED',true,date '2014-01-19','admin'),
  ('SUPER COMBED','SUPER COMBED',true,date '2014-01-19','admin'),
  ('VL COMBED','VL COMBED',true,date '2022-12-02','admin'),
  ('VOILET LABEL','VOILET LABEL',true,date '2014-01-19','admin')
) as v(code, name, is_active, created_at, created_by)
where not exists (
  select 1 from public.config_lookups cl
  where cl.kind = 'yarn_purity' and cl.code = v.code
);
