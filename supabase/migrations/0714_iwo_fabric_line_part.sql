-- 0714 — Sample ▸ Fabric Plan ▸ Fabric Consumption: each dia names its PART
-- (user 2026-10-12, plan "SMP-wise Fabric Consumption" v3).
--
-- Consumption is now entered sample by sample: a sample's fabric row opens a
-- Dia & weight popup, one row per Finish Dia, and each says which part of the
-- garment it is for — the Order module's own shape (Fabric BOM ▸ Manual: Front
-- + Back 60 dia, Sleeve 52, Rib Neck 28). Without it two dias of one fabric
-- read the same but for the number.
--
-- Free text, capitals like every stored value; NULL on every production IWO
-- line and on every line saved before this. Part joins the duplicate key, so
-- one sample may cut one fabric, colour and dia for two parts (two lines).
alter table public.iwo_fabric_bom_lines
  add column if not exists part text;

comment on column public.iwo_fabric_bom_lines.part is
  'The garment part this dia/weight is for (FRONT + BACK, SLEEVE, RIB NECK) — sample plans (0714).';

drop index if exists public.uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp;
create unique index if not exists uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp_part
  on public.iwo_fabric_bom_lines
  (bom_id, item_id, coalesce(color_name, ''), coalesce(finish_dia, ''), coalesce(print_name, ''),
   coalesce(sample_style_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(part, ''));

do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp_part') then
    raise exception '0714: the six-column index is missing';
  end if;
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia_print_smp') then
    raise exception '0714: the old five-column index is still there';
  end if;
end $$;
