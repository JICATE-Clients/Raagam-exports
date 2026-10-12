-- 0710 · Sample ▸ Accessories Plan — each Items line names its SMP
-- (user 2026-10-12: "accessories plan … like the fabric plan, SWO No and SMP
-- number need to fetch and list"; decisions the same day: fill the grid from
-- each sample's costing trims when the SWO is picked, Planned Qty = qty per
-- garment × the sample's pieces, editable; a "Refill from Costing" button
-- re-pulls on demand, and a saved plan never changes by itself).
--
-- The twin of 0707 on the fabric side: the STYLE line (`styles.id`) is stored,
-- and the SMP number is read through styles.opportunity_id. NULL on every
-- production IWO and on every line saved before this.
--
-- No index to widen: iwo_material_bom_items has no unique key (two lines of
-- one material are already allowed — a per-colour breakup, two specs), and
-- the purchase ceiling (0587) sums per material, so one button on two SMPs
-- is still ONE purchase for the SWO.
--
-- ON DELETE RESTRICT, as 0707: a style named on a plan must not vanish from it.

alter table public.iwo_material_bom_items
  add column if not exists sample_style_id uuid references public.styles(id) on delete restrict;

create index if not exists idx_iwo_material_bom_items_sample_style
  on public.iwo_material_bom_items(sample_style_id) where sample_style_id is not null;

comment on column public.iwo_material_bom_items.sample_style_id is
  'Sample Accessories Plan (0710): the SWO sample style (SMP line) this accessory is for. NULL on production IWOs.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'iwo_material_bom_items' and column_name = 'sample_style_id') then
    raise exception '0710: iwo_material_bom_items.sample_style_id is missing';
  end if;
end $$;
