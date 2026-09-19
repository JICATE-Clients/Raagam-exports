-- ============================================================================
-- Raagam ERP — 0599 IWO Fabric BOM: a Print on each printed line, and the
-- Details popup's yarn-dyed rows.
--
-- Client ticket 2026-09-20 ("IWO Fabric BOM Logic"), decided with the user:
--
--   §4 PRINTED FABRICS — a printed line states its Print (from the BOM's Roll
--      form prints panel), its base Colour, its Finish Dia and its weight. The
--      line had no Print, so `print_name` is added. A fabric may carry two
--      prints at one colour and dia, so the one-line rule becomes
--      (fabric, colour, dia, print) — 0592's index is rebuilt with the print.
--
--   §5 DETAILS — the Fabric Allocation's Details button opens a Colour × Dia
--      weight grid for the fabric and, on a Yarn Dyed fabric, the order Fabric
--      BOM's Yarn Dyed Details. Those rows live in 0581's iwo_fabric_bom_yd_*
--      tables, unused until now; their `structure_id` was NOT NULL, but an IWO
--      line's Structure is optional (the fabric names the cloth), so a
--      yarn-dyed fabric with no Structure could never save its details. The
--      address is the FABRIC (`item_id`); `structure_id` is kept as a note and
--      made nullable.
-- ============================================================================

alter table public.iwo_fabric_bom_lines
  add column if not exists print_name text
  check (print_name is null or char_length(btrim(print_name)) between 1 and 60);

comment on column public.iwo_fabric_bom_lines.print_name is
  'The print a PRINT-stage line is planned in — a name from the BOM''s Roll form prints panel (0599).';

drop index if exists public.uq_iwo_fabric_bom_lines_fabric_colour_dia;
create unique index if not exists uq_iwo_fabric_bom_lines_fabric_colour_dia_print
  on public.iwo_fabric_bom_lines
  (bom_id, item_id, coalesce(color_name, ''), coalesce(finish_dia, ''), coalesce(print_name, ''));

alter table public.iwo_fabric_bom_yd_repeats alter column structure_id drop not null;
alter table public.iwo_fabric_bom_yd_combinations alter column structure_id drop not null;

do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia_print') then
    raise exception '0599: the (fabric, colour, dia, print) index is missing';
  end if;
end $$;
