-- 0707 · Sample Work Order (SWO) ▸ Fabric Consumption carries the SMP
-- (client spec "Grouping & SWO Architecture", 2026-10-12).
--
-- An SWO (sample_product_groups, numbered SWO/26-27/nnnn since 0706) bundles
-- several sample entries into ONE fabric purchase rounded to the mill's MOQ.
-- Its Fabric IW is planned on Sample ▸ Fabric Plan, and the spec asks that
-- each Fabric Consumption line there name the SAMPLE it is for:
--
--   "the planner adds line items specifying the SMP Number, fabric structure,
--    color, dia, and required weight … each sample style within the group
--    retains its individual fabric identity."
--
-- WHAT IS STORED: the STYLE line (`styles.id`), not the enquiry. One SMP
-- (opportunity) can hold several styles, and the SWO batches styles
-- (sample_group_items.style_id); the SMP number is read through
-- styles.opportunity_id. Storing the enquiry would leave two styles of one SMP
-- indistinguishable on the plan, and the release on receipt is per style.
--
-- THE GRAIN WIDENS BY ONE AXIS. 0599's line was one per (fabric, colour, dia,
-- print); two SMPs weighing the same cloth in the same colour and dia are now
-- two lines, so the unique index takes the style as its fifth column. Nothing
-- downstream keys on the old four: the yarn engine buckets by fabric and
-- colour (so SMPs sharing a yarn AGGREGATE into one purchase — spec §3.3),
-- and the IWO Budget sums req_kgs per fabric. Production IWOs leave the
-- column NULL, so their index behaviour is unchanged.
--
-- ON DELETE RESTRICT: a style batched past Draft cannot be deleted already
-- (0702's guard); one named on a plan must not vanish from it either.

alter table public.iwo_fabric_bom_lines
  add column if not exists sample_style_id uuid references public.styles(id) on delete restrict;

comment on column public.iwo_fabric_bom_lines.sample_style_id is
  'Sample Fabric Plan (0707): the sample style (SMP line) this weight is for — one of its SWO''s styles. NULL on production IWOs.';

create index if not exists idx_iwo_fabric_bom_lines_sample_style
  on public.iwo_fabric_bom_lines(sample_style_id) where sample_style_id is not null;

drop index if exists public.uq_iwo_fabric_bom_lines_fabric_colour_dia_print;
create unique index if not exists uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp
  on public.iwo_fabric_bom_lines
  (bom_id, item_id, coalesce(color_name, ''), coalesce(finish_dia, ''), coalesce(print_name, ''),
   coalesce(sample_style_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ONE SWO, ONE IW. The spec's SWO is the umbrella the Fabric IW is raised
-- against; two groups pointing at one IW would make its plan answer to two
-- SMP maps. Partial, so every group not yet raised stays NULL freely.
create unique index if not exists uq_sample_product_groups_iwo
  on public.sample_product_groups(iwo_id) where iwo_id is not null;

do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp') then
    raise exception '0707: the (fabric, colour, dia, print, sample style) index is missing';
  end if;
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia_print') then
    raise exception '0707: the old four-column index is still there';
  end if;
end $$;
