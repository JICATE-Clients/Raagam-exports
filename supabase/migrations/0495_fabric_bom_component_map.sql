-- ============================================================================
-- Raagam ERP — 0495 Orders ▸ Fabric BOM ▸ Components
--
-- The legacy "Prepare fabric BOM for Garment order" screen's **Components** tab
-- (client screenshot 2585), the fifth of its six to be converted, after
-- Color/Print Details (0490), Manual (0491), FabricProcess (0492) and
-- YarnProcess (0493).
--
--
-- NO NEW TABLE, AND THAT IS THE SAME FINDING FOUR MIGRATIONS IN A ROW
--
-- Legacy draws three nested grids:
--
--     Style      StyleRefNo · StyleNo · ArticleNo
--       Part     Coordinate · Component · Structure · Structure Type ·
--                Fabric Type · Fabric · Gsm
--         Colour Assort Color · Fabric Type · Fabric · Gsm · Type ·
--                Required Color · Required Print · Specification · Conv. Item
--
-- and `order_fabric_bom_lines` is keyed on (style_ref_no, combo, structure_id,
-- component_id) with `item_id` beside them — so ONE LEAF OF THAT TREE IS ONE OF
-- OUR LINES, already. Legacy needs three levels because its line carries none of
-- the ancestry; ours carries all of it, which is why the tab costs four columns
-- rather than a table.
--
-- That is 0490's argument for the palette panels ("the screen READS them and
-- does not store them"), 0491's for the Manual tab ("levels 1-2 ARE our line;
-- only the SIZE row got a table") and 0492's for Fabric Detail, arrived at
-- independently each time. Four for four is no longer a coincidence: the legacy
-- Fabric BOM is ONE flat fact per (style, colourway, fabric, panel) drawn six
-- different ways, and every tab that has looked for its own storage has found
-- the line already holding it.
--
--
-- WHAT THE FOUR COLUMNS ARE, AND WHY THERE ARE NOT FIVE
--
--   coordinate_id   legacy's "Coordinate" — PIECES, TOP, BOTTOM. The order
--                   already pairs it with the component
--                   (garment_order_amendment_style_components), and the pair is
--                   what identifies a panel: the Style master declares FRONT
--                   BODY *of* PIECES, which is why the Combos overlay narrows
--                   its Component picker by the Coordinate beside it. A line
--                   holding the component without the coordinate cannot say
--                   which of two identically-named panels it means.
--
--   fabric_form     legacy's "Type" on the colour row — Open or Tubular. The
--                   client asked for it by name and called it mandatory
--                   (2026-09-01): "a specific, mandatory field on this tab to
--                   capture whether the fabric for the component needs to be
--                   processed as Open or Tubular". It is a KNITTING/FINISHING
--                   form and nothing in this database has ever recorded it —
--                   `knit_type` (0490) is Circular/Flat/Woven, which is how the
--                   cloth is MADE, not how the roll is presented.
--
--   required_print  legacy's "Required Print". TEXT, matching
--                   `garment_order_amendment_prints.print_name`, which 0477 made
--                   manual entry — so there is no id to point at. Same trade
--                   `color_name` already makes one column along.
--
--   specification   legacy's "Specification". Free text, the operator's note to
--                   the knitter or dyer about this panel in this colourway.
--
-- THE FIFTH IS `required_color`, AND IT IS NOT ADDED. Legacy's colour row shows
-- "Assort Color" and "Required Color" side by side; ours already has both —
-- `combo` IS the assort colour (0397, by value) and `color_name` IS the colour
-- required for this panel in it (0408: "the front body, in the WHITE combo, is
-- single jersey, in white"). Adding a third colour column would give one fact
-- two spellings on one row, and the client's own rule for this screen family is
-- "only from legacy screen field, no more extra field" — which cuts both ways.
--
--
-- `fabric_form` IS TEXT WITH A CHECK, NOT A `config_lookups` KIND
--
-- 0492 seeded three kinds for FabricProcess and stated the test plainly: "the
-- test is whether the list is CLOSED, not whether it is short". Open and Tubular
-- are the two ways a knitted roll can leave the machine. There is no third, no
-- operator will ever add one, and an FK would let a deleted lookup row take a
-- stored answer with it. Same call, and the same wording, as 0490's `knit_type`.
--
-- Stored LOWERCASE, like every other text vocabulary on this table
-- (`fabric_type`, `requirement_basis`, `consumption_mode`), so the labels live
-- in one `as const` on the TypeScript side and the column never carries display
-- text.
--
--
-- NULLABLE, THOUGH `fabric_form` IS MANDATORY ON SCREEN
--
-- Every cell in this module is nullable and this one is no exception. A grid
-- opens on a blank row and the operator fills it left to right; a NOT NULL here
-- would reject the row the grid itself just created. "Mandatory" is enforced
-- where the other three mandatory cells on this line already are — in
-- `fabricBomLineInput`'s `superRefine`, gated on `item_id` being NAMED, so an
-- untouched blank line never blocks Save while a started one cannot be finished
-- without it. The star, the cursor hold and the Save gate all derive from that
-- one declaration (AGENTS.md, "One declaration, four enforcers"), which is what
-- keeps this from being [[stated but not enforced]].
--
--
-- WHAT THIS MIGRATION DOES NOT CONTAIN
--
-- The client's three association rules — a component list filtered by the
-- fabric's structure, a sole match defaulting itself, and a panel disappearing
-- from the list once mapped — need NO schema. They read
-- `garment_order_amendment_style_components(style_ref_no, coordinate_id,
-- component_id, fabric_category_id)`, which 0457 already built and which states
-- exactly which fabric category each panel of each style is cut from. Encoding
-- "Rib means Neck" as data here would be a second, coarser copy of a fact the
-- order already holds per style — and it would be wrong for the first style that
-- ribs a cuff. The rules live in `lib/orders/fabric-bom/component-map.ts`.
--
-- "Conv. Item", the colour row's last cell, is NOT built. It is a [Click] into a
-- screen this repo has never captured, and three readings of it are plausible.
-- Awaiting the client's screenshot rather than guessed at.
--
--
-- PRE-FLIGHT (catalog, 2026-09-01): all four `order_fabric_bom_*` tables hold
-- zero rows, so an added column is free and a CHECK cannot reject stored data.
--
-- No function is created or altered, so AGENTS.md's Function Grants rule has
-- nothing to do here.
-- ============================================================================

alter table public.order_fabric_bom_lines
  add column if not exists coordinate_id  uuid references public.items(id),
  add column if not exists fabric_form    text,
  add column if not exists required_print text,
  add column if not exists specification  text;

-- Drop-and-recreate under the same name — the idiom 0412 established when it
-- widened a CHECK, and 0480 reused: a CHECK cannot be altered in place, and
-- anything looking it up by name (the verify block below included) must keep
-- finding it.
alter table public.order_fabric_bom_lines
  drop constraint if exists order_fabric_bom_lines_fabric_form_check;

alter table public.order_fabric_bom_lines
  add constraint order_fabric_bom_lines_fabric_form_check
  check (fabric_form is null or fabric_form in ('open', 'tubular'));

comment on column public.order_fabric_bom_lines.coordinate_id is
  'Legacy Components ▸ "Coordinate" — PIECES / TOP / BOTTOM. An `items` row of '
  'class GAR (0396), the same target garment_order_amendment_style_components.'
  'coordinate_id and _combo_components.coordinate_id both use. Carried WITH '
  'component_id because the Style master declares the PAIR (FRONT BODY *of* '
  'PIECES) and the component alone does not identify a panel. 0495.';

comment on column public.order_fabric_bom_lines.fabric_form is
  'Legacy Components ▸ "Type" — open | tubular. How the roll is presented to '
  'cutting, NOT how the cloth is knitted (that is order_fabric_bom_dias.'
  'knit_type, 0490: circular | flat_knit | woven). Client 2026-09-01 asked for '
  'it by name and called it mandatory; the mandate is enforced in '
  'fabricBomLineInput''s superRefine gated on item_id, never by a NOT NULL that '
  'would reject the blank row the grid opens with. Text + CHECK rather than a '
  'config_lookups kind because the list is CLOSED — 0492''s test. 0495.';

comment on column public.order_fabric_bom_lines.required_print is
  'Legacy Components ▸ "Required Print". TEXT, matching garment_order_amendment_'
  'prints.print_name, which 0477 made manual entry — there is no id to point '
  'at. Auto-filled from the order''s declared prints, per the client''s "must '
  'automatically load from the previous screens". 0495.';

comment on column public.order_fabric_bom_lines.specification is
  'Legacy Components ▸ "Specification" — the operator''s free-text note about '
  'this panel in this colourway. Capitalised by the Zod schema like every other '
  'text value in this app (AGENTS.md, CAPITALS). 0495.';

-- ---------------------------------------------------------------------------
-- Read the result out of the CATALOG, never off the migration text.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_col text;
begin
  foreach v_col in array array['coordinate_id','fabric_form','required_print','specification'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'order_fabric_bom_lines'
        and column_name  = v_col
    ) then
      raise exception '0495: order_fabric_bom_lines is missing %', v_col;
    end if;

    -- Every one of them NULLABLE. A NOT NULL would reject the blank row the
    -- grid opens with, and would do it at the operator's next Save.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'order_fabric_bom_lines'
        and column_name  = v_col
        and is_nullable  = 'NO'
    ) then
      raise exception '0495: % is NOT NULL — the grid''s own blank row cannot satisfy it', v_col;
    end if;
  end loop;

  -- The coordinate points at `items`, not at the `config_lookups` kind 0396
  -- moved coordinates OFF. Getting this wrong compiles, lists nothing, and
  -- saves fine — the exact failure 0394/0396 record.
  if not exists (
    select 1 from pg_constraint c
    join unnest(c.conkey) k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid  = 'public.order_fabric_bom_lines'::regclass
      and c.contype   = 'f'
      and c.confrelid = 'public.items'::regclass
      and a.attname   = 'coordinate_id'
  ) then
    raise exception '0495: coordinate_id does not point at public.items (see 0396)';
  end if;

  -- The CHECK exists and actually refuses a third form.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_fabric_bom_lines'::regclass
      and conname  = 'order_fabric_bom_lines_fabric_form_check'
  ) then
    raise exception '0495: the fabric_form CHECK is missing';
  end if;

  -- No `required_color` column was added. Stated as an assertion because the
  -- reasoning above is the kind a later reader "fixes" by adding one.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'order_fabric_bom_lines'
      and column_name  = 'required_color'
  ) then
    raise exception '0495: required_color exists — `color_name` already IS it (see the header)';
  end if;
end $$;
