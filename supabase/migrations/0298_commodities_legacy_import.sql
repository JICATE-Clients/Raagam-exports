-- ============================================================================
-- Raagam ERP — 0298 Master Data ▸ Materials ▸ Commodities seed
-- Seeds the legacy "Commodities - HO" report (6 rows) into the dedicated
-- commodities table (0230). One legacy row (Short Name "2045") has no Item
-- Class in the source report and is skipped — item_class_id is required
-- (not null) and there's no valid class to map it to.
-- ============================================================================

insert into public.commodities (item_class_id, short_name, name, blocked, created_at)
select c.id, v.short_name, v.name, v.blocked, v.created_at::timestamptz
from (values
  ('SEW', '2003', '2003', false, '2016-05-09T00:00:00.000Z'),
  ('CAP', '2025', '2025', false, '2016-05-09T00:00:00.000Z'),
  ('YARN', '2041', '2041', false, '2016-05-07T00:00:00.000Z'),
  ('SEW', '2067', '2067', false, '2016-05-07T00:00:00.000Z'),
  ('PACK', '2094', '2094', false, '2016-05-12T00:00:00.000Z')
) as v(item_class_code, short_name, name, blocked, created_at)
join public.config_lookups c on c.kind = 'item_class' and c.code = v.item_class_code
where not exists (
  select 1 from public.commodities existing
  where existing.item_class_id = c.id
    and existing.short_name = v.short_name
);
