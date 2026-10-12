-- 0711 · Sample ▸ Accessories Plan — the SMP moves from the LINE to the rows
-- UNDER it (client 2026-10-12, the Fabric Plan's "Allocation vs Consumption"
-- update applied to accessories: "same thing for the accessories plan").
--
-- An Items line is now the SWO's CONSOLIDATED accessory — one material, bought
-- once for the whole group — and the rows beneath it say how much of it each
-- sample (SMP) takes, with the line's Planned Qty their sum. So a button worn
-- by both samples is one line with two SMP rows, never the material picked
-- twice. A sample needing several colours or sizes of it is one SMP with
-- further rows under it (the Fabric Plan's "+ Add Dia").
--
-- The rows table already exists (0614, the colour / size breakup); it gains
-- the SMP. `iwo_material_bom_items.sample_style_id` (0710) stays for history
-- and is no longer written by the screen. No data to move: no sample
-- accessories plan had been saved when this ran.
--
-- ON DELETE RESTRICT, as 0707 / 0710: a style named on a plan must not vanish.

alter table public.iwo_material_bom_item_slices
  add column if not exists sample_style_id uuid references public.styles(id) on delete restrict;

create index if not exists idx_iwo_material_bom_item_slices_sample_style
  on public.iwo_material_bom_item_slices(sample_style_id) where sample_style_id is not null;

comment on column public.iwo_material_bom_item_slices.sample_style_id is
  'Sample Accessories Plan (0711): the SWO sample style (SMP line) this row of the line is for. NULL on production IWOs.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'iwo_material_bom_item_slices' and column_name = 'sample_style_id') then
    raise exception '0711: iwo_material_bom_item_slices.sample_style_id is missing';
  end if;
end $$;
