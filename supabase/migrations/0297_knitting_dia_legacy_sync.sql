-- ============================================================================
-- Raagam ERP — 0297 Master Data ▸ Materials ▸ Knitting Dias: legacy data sync
-- Backfills `knitting_dia` config_lookups from the legacy EDP2 "Knitting
-- dias - HO" report export (30 rows). Idempotent — guarded per-row by
-- `where not exists`, so re-running this migration is a no-op.
--
-- Source report only has Dia/Description/Blocked columns (no Created
-- Dt/User, unlike the Counts report in 0291), so created_at/created_by are
-- left at their column defaults.
-- ============================================================================

insert into public.config_lookups (kind, code, name, is_active)
select 'knitting_dia', v.code, v.name, v.is_active
from (values
  ('15','38 DIA',true),
  ('16','16 DIA',true),
  ('17','17 DIA',true),
  ('18','18 DIA',true),
  ('19','19 DIA',true),
  ('20','20 DIA',true),
  ('21','21 DIA',true),
  ('22','22 DIA',true),
  ('23','23 DIA',true),
  ('24','24 DIA',true),
  ('25','25 DIA',true),
  ('26','26 DIA',true),
  ('27','27 DIA',true),
  ('28','28 DIA',true),
  ('29','29 DIA',true),
  ('30','30 DIA',true),
  ('32','32 DIA',true),
  ('34','34 DIA',true),
  ('36','36 DIA',true),
  ('40','40 DIA',true),
  ('42','42 DIA',true),
  ('44','44 DIA',true),
  ('50','50 DIA',true),
  ('60','60 DIA',true),
  ('100','ANY DIA',true),
  ('41','41 DIA',true),
  ('37','37 DIA',true),
  ('38','38',true),
  ('52','DIA',true),
  ('46','46 DIA',true)
) as v(code, name, is_active)
where not exists (
  select 1 from public.config_lookups cl
  where cl.kind = 'knitting_dia' and cl.code = v.code
);
