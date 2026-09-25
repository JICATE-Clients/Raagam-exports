-- 0636 — LOOSE FABRIC CONVERSION on the IWO Fabric BOM (0633's twin).
--
-- 0633 added the conversion to the ORDER Fabric BOM: a yarn step naming the
-- CONVERSION (UNRAVELLING) process carries `source_loose_fabric_id`, the loose
-- fabric knitted from greige yarn, dyed with the body and unravelled into this
-- yarn. The IWO Fabric BOM (For = Fabric) runs the same engine
-- (`lib/orders/fabric-bom/loose-conversion.ts`) over its own tables, so its
-- yarn step gets the same column. Nothing else is needed here: the process,
-- its flag and its DYED classification are 0633's and are shared.

alter table public.iwo_fabric_bom_yarn_stages
  add column if not exists source_loose_fabric_id uuid references public.items(id);

comment on column public.iwo_fabric_bom_yarn_stages.source_loose_fabric_id is
  '0636: on a CONVERSION (UNRAVELLING) step — the loose fabric unravelled into '
  'this yarn (0633''s order-side column, on the IWO). NULL on every other step.';

create index if not exists idx_iwo_fbys_source_loose_fabric
  on public.iwo_fabric_bom_yarn_stages (source_loose_fabric_id)
  where source_loose_fabric_id is not null;
