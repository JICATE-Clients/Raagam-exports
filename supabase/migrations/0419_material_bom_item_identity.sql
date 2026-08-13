-- ============================================================================
-- Raagam ERP — 0419 Material BOM ▸ what the trim actually IS
--
-- 0418 gave a BOM line its arithmetic — the ratio, the wastage, the split basis
-- and the stored requirement. What it could not yet say is which THING is being
-- bought: a "Main Label" line could not record that it is the woven 50mm one in
-- black rather than the printed 30mm one in white. Three fields, from the
-- client's item-grid spec (2026-08-13).
--
--
-- `item_color_id` POINTS AT THE FABRIC COLOUR LIST, AND THAT IS THE POINT
--
-- The whole reason a trim carries a colour is to be matched to the garment —
-- black thread on black shirts. Matching is only expressible if the trim and the
-- fabric are drawn from ONE vocabulary: two lists reconciled by name is the
-- case-mismatch failure AGENTS.md records under Nominated vendors, where
-- "Nominated" and "nominated" compile, run and quietly match nothing.
--
-- So this reuses `config_lookups` kind 'fabric_color' (0415) rather than opening
-- a 'trim_color' beside it. The kind's NAME reads oddly on a button; the
-- alternative reads fine and cannot answer the question the field exists for.
--
-- NULL IS A MEANING, NOT A GAP. On a line whose basis is 'colour', blank means
-- "takes the garment's combo colour" — the ordinary case, and why the operator
-- chose Color-wise at all. A filled value pins a CONTRAST colour across every
-- exploded row. The screen renders the placeholder "Matches garment" so the two
-- states cannot be confused with "not entered yet".
--
--
-- `specification` AND `size` ARE FREE TEXT, AND `size` IS *NOT* THE GARMENT SIZE
--
-- A label's size is 50MM X 20MM; a zipper's is 12 INCH; a button's is 24 LIGNE.
-- None of those is S / M / L. `config_lookups` kind 'size' holds the GARMENT
-- sizes, and a Size-wise line already explodes along that axis — pointing this
-- column there would put two different meanings on one field and collide with
-- the explosion. They are separate axes, so they get separate storage.
--
-- CAPITALS, via `capsTextNullable()` in the Zod input rather than in the action:
-- `lib/data-io` parses imports with the same schema and writes straight to
-- Postgres, so an action-level `.toUpperCase()` misses every spreadsheet import
-- (AGENTS.md, "CAPITALS").
-- ============================================================================

alter table public.material_bom_amendment_items
  add column if not exists item_color_id uuid references public.config_lookups(id),
  add column if not exists specification text,
  add column if not exists size          text;

comment on column public.material_bom_amendment_items.item_color_id is
  'The trim''s colour, from config_lookups kind ''fabric_color'' (0415) — the SAME list the garment''s colours come from, so "match the thread to the fabric" is expressible as equality. NULL on a colour-wise line means it takes the garment''s combo colour (0419).';
comment on column public.material_bom_amendment_items.specification is
  'Free CAPS text: WOVEN 2-FOLD, NYLON #5, 4-HOLE POLY (0419).';
comment on column public.material_bom_amendment_items.size is
  'The MATERIAL''s size as free CAPS text: 50MM X 20MM, 12 INCH, 24 LIGNE. NOT the garment size — that is config_lookups kind ''size'', and a size-wise line already explodes along it (0419).';

create index if not exists idx_mba_items_color
  on public.material_bom_amendment_items(item_color_id);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal (0383,
-- 0386). Two of these assert something the DDL above cannot show on its own:
-- that `size` is TEXT and not a uuid (the mistake this migration's header exists
-- to prevent), and that the colour FK actually accepts a 'fabric_color' row —
-- asserted BY USING one, the way 0415 asserted its own kind.
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_type   text;
  v_color  uuid;
  v_goa    uuid;
  v_mba    uuid;
  v_line   uuid;
begin
  foreach v_type in array array['item_color_id','specification','size'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'material_bom_amendment_items'
         and column_name  = v_type
    ) then
      raise exception '0419: material_bom_amendment_items.% was not added', v_type;
    end if;
  end loop;

  select data_type into v_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'material_bom_amendment_items'
     and column_name  = 'size';
  if v_type <> 'text' then
    raise exception
      '0419: `size` must be TEXT (got %) — it is the MATERIAL''s size (50MM X 20MM), not the garment size lookup a size-wise line explodes along',
      v_type;
  end if;

  -- The colour FK must accept a fabric_color row. Asserted by using one.
  insert into public.config_lookups (kind, code, name)
    values ('fabric_color', '__0419_probe__', 'ZZ 0419 PROBE')
    returning id into v_color;

  insert into public.garment_order_amendments (amend_date, excess_pct, pack, mult_ord)
    values (current_date, 0, false, false) returning id into v_goa;
  insert into public.material_bom_amendments (garment_order_id, amend_date)
    values (v_goa, current_date) returning id into v_mba;
  insert into public.material_bom_amendment_items
    (amendment_id, sno, item_color_id, specification, size)
    values (v_mba, 1, v_color, 'WOVEN 2-FOLD', '50MM X 20MM')
    returning id into v_line;

  if not exists (
    select 1 from public.material_bom_amendment_items
     where id = v_line and item_color_id = v_color and size = '50MM X 20MM'
  ) then
    raise exception '0419: the probe line did not store its colour and size';
  end if;

  delete from public.garment_order_amendments where id = v_goa;
  delete from public.config_lookups where id = v_color;

  raise notice '0419 VERIFY: all assertions passed';
end $verify$;
