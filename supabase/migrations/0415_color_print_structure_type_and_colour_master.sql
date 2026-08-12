-- ============================================================================
-- Raagam ERP — 0415 Color/Print Details: a structure carries its Fabric Type,
--                    and a colour is a master row again
--
-- Three changes, all on the Color/Print Details tab of the Garment Order, all
-- from one client statement (2026-08-12):
--
--   "Users should be able to see the Type (Solid, Y/D, Melange, Printed) for
--    each fabric structure immediately to understand which processing
--    deadlines (T&A) will apply to that specific order."
--   "If the fabric structures are already defined in the Style Entry, they
--    should flow into this tab automatically to avoid duplicate data entry."
--   "All colours and print designs must be wired to their respective Master
--    Data (indicated by the 'i' icon) to ensure that naming conventions
--    ('Navy Blue' vs 'Dark Blue') remain consistent across the company."
--
--
-- 1. A STRUCTURE IS A FABRIC CATEGORY HERE TOO — the third time this answer is
--    given, and the last place still on the wrong level.
--
--    0405 repointed `garment_style_components.structure_id` at `categories` and
--    renamed it `fabric_category_id`. 0409 did the same to the combo structure
--    row, and its header spells out why: `config_lookups` kind 'fabric_structure'
--    holds Circular Knit / Flat Knit / Woven — the FAMILY — while the legacy
--    screen's Structure column reads SINGLE JERSEY and 1X1 LYCRA RIB, which are
--    CATEGORIES. This tab's own grid was the source 0408 copied from and the one
--    nobody came back for.
--
--    It is not merely inconsistent, it is what blocks the client's second
--    sentence: the structures that would "flow in from the Style Entry" are
--    `garment_style_components.fabric_category_id` values, and a column pointing
--    at a different table cannot hold them. The redundancy fix and the FK fix are
--    the same fix.
--
-- 2. `item_sub_type` — Solid / Melange / Yarn Dyed / Printed, per structure.
--
--    The vocabulary is already declared once, in `ITEM_SUB_TYPE_OPTIONS`
--    (lib/orders/amendments/combo-rules.ts), and already stored per combo
--    structure. The first three come from `order_fabrics.item_sub_type` (0329);
--    Printed is the amendment's own fourth, added by 0412 because it decides
--    which aesthetic field applies rather than how the fabric was dyed.
--
--    NULLABLE, AND THE BLANK IS A REAL STATE. `takesDyedColour` /
--    `takesAllOverPrint` both answer false for a blank, so an unanswered Type
--    offers neither a colour list nor a print list — the branch that matters,
--    because a rule phrased as "restrict only when melange" leaks through every
--    state that is not melange (how the nominated-vendor rule broke twice).
--    A NOT NULL default of 'solid' would put an invented answer on every row.
--
-- 3. `fabric_color` — the colour master the ⓘ asks for.
--
--    0403 made this cell free text, and its reasoning was correct at the time:
--    Colour Cards had just been withdrawn as a screen and `public.colors` was
--    dropped by 0382 as "not applicable to the business process", so the picker
--    had no source left and "a dropdown that can only ever be empty is worse
--    than a text box: it reads as a master the operator failed to fill."
--
--    WHAT CHANGED IS THAT THERE IS NOW A SOURCE TO POINT AT. A `config_lookups`
--    kind is not a resurrected Colour Cards — it is the same shape 'roll_form_print'
--    already uses on the very next grid of this tab, and it carries inline create
--    and edit, so the list fills itself from the first order that needs a colour
--    rather than needing a master screen built first. That is also why it starts
--    EMPTY and is not seeded: a colour list is the names this business actually
--    uses, and inventing NAVY / RED here is the 2026-07-28 mistake (a Packing
--    Accessories name "corrected" to COTTON from a defaulted word list).
--
--    `color_name` STAYS AND STAYS AUTHORITATIVE. The picked lookup's name is
--    written into it, so `declaredColourOptions` (which feeds the Combos tab's
--    colour list) and `garment_order_amendment_combo_components.color_name` keep
--    reading one text column, and a colour typed before this migration still
--    resolves. The FK is the consistency half, not a replacement for the value —
--    the same id + text pairing `style_id` / `style` already uses two grids up.
--
--
-- SAFE TO REPOINT RATHER THAN MIGRATE, verified from the catalog before writing
-- this file: garment_order_amendments = 0 rows, and its structures / dyeings /
-- prints children are 0 rows each. There is no value to translate and no row
-- that could fail a new constraint. (`color_card_colors` itself is untouched —
-- this drops a reference to it, not the table.)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The colour kind. `config_lookups.kind` is a CHECK, not an enum, so a new
--    kind is a constraint swap — the same edit 0400 and 0396 made.
-- ---------------------------------------------------------------------------
alter table public.config_lookups
  drop constraint if exists config_lookups_kind_check;

alter table public.config_lookups
  add constraint config_lookups_kind_check check (kind = any (array[
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state',
    'department','designation','internal_department','ship_type','payment_term',
    'employee_category','team','account_schedule','vendor_group','agent_type',
    'agent','packing_list_format','commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from','style_category',
    'coordinate','style_component','structure','trims_category','size',
    'roll_form_print','warehouse','ta_activity_type','fabric_structure',
    'fabric_type','yarn_type','duty_category','vendor_item_form',
    'vendor_supply_type','vendor_service_type','assortment_type',
    -- 0415: the Color/Print tab's colour list. Deliberately unseeded.
    'fabric_color'
  ]));


-- ---------------------------------------------------------------------------
-- 2. Dyeing colour points at that kind instead of the withdrawn colour cards.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_dyeings
  drop constraint if exists garment_order_amendment_dyeings_color_id_fkey;

alter table public.garment_order_amendment_dyeings
  add constraint garment_order_amendment_dyeings_color_id_fkey
  foreign key (color_id) references public.config_lookups(id);

comment on column public.garment_order_amendment_dyeings.color_id is
  'The colour master row — config_lookups kind ''fabric_color'' (0415). Was a '
  'color_card_colors reference (0128), frozen as free text by 0403 when Colour '
  'Cards was withdrawn. color_name still holds the VALUE and is what the Combos '
  'tab reads; this is the consistency half, so NAVY BLUE cannot also be entered '
  'as DARK BLUE on the next order.';


-- ---------------------------------------------------------------------------
-- 3. A structure is a fabric category, and it carries its Fabric Type.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_structures
  drop constraint if exists garment_order_amendment_structures_structure_id_fkey;

alter table public.garment_order_amendment_structures
  add constraint garment_order_amendment_structures_structure_id_fkey
  foreign key (structure_id) references public.categories(id);

alter table public.garment_order_amendment_structures
  add column if not exists item_sub_type text;

alter table public.garment_order_amendment_structures
  drop constraint if exists garment_order_amendment_structures_item_sub_type_check;

alter table public.garment_order_amendment_structures
  add constraint garment_order_amendment_structures_item_sub_type_check
  check (item_sub_type is null or item_sub_type = any (array[
    'solid','melange','yarn_dyed','printed'
  ]));

comment on column public.garment_order_amendment_structures.structure_id is
  'The fabric CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB (0415). Matches '
  'garment_style_components.fabric_category_id (0405) and the combo structure '
  'row (0409), which is what lets this grid be seeded from the order''s own '
  'style lines instead of retyped. The knit family is DERIVED through '
  'categories.fabric_structure_id.';

comment on column public.garment_order_amendment_structures.item_sub_type is
  'Solid / Melange / Yarn Dyed / Printed (0415) — the same vocabulary as '
  'garment_order_amendment_combo_structures.item_sub_type, declared once in '
  'ITEM_SUB_TYPE_OPTIONS. Decides which aesthetic field a component of this '
  'fabric fills, and which T&A processing deadlines apply. NULL means not '
  'answered yet and offers NEITHER a colour nor a print list — never defaulted '
  'to ''solid'', which would be an invented answer on every row.';


-- ---------------------------------------------------------------------------
-- Read the result out of the catalog. `{"success": true}` means the SQL ran,
-- not that it achieved its goal — the lesson 0386 recorded by asserting its own
-- success while shipping a no-op.
-- ---------------------------------------------------------------------------
do $verify$
-- `smallint`, not `int`: pg_constraint.conkey is smallint[], and `array[int]`
-- fails to compare with "operator does not exist: smallint[] = integer[]". 0409
-- sidestepped this by inlining the sub-select, whose attnum keeps its own type.
declare
  structure_attnum smallint;
  color_attnum     smallint;
begin
  select attnum into structure_attnum from pg_attribute
   where attrelid = 'public.garment_order_amendment_structures'::regclass
     and attname  = 'structure_id';
  select attnum into color_attnum from pg_attribute
   where attrelid = 'public.garment_order_amendment_dyeings'::regclass
     and attname  = 'color_id';

  -- 3a. structure_id points at categories, and no longer ALSO at config_lookups.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_structures'::regclass
       and c.contype = 'f' and c.confrelid = 'public.categories'::regclass
       and c.conkey = array[structure_attnum]
  ) then
    raise exception '0415: structures.structure_id does not point at public.categories';
  end if;
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_structures'::regclass
       and c.contype = 'f' and c.confrelid = 'public.config_lookups'::regclass
       and c.conkey = array[structure_attnum]
  ) then
    raise exception '0415: structures.structure_id still ALSO points at config_lookups';
  end if;

  -- 3b. color_id points at config_lookups, and no longer at color_card_colors.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_dyeings'::regclass
       and c.contype = 'f' and c.confrelid = 'public.config_lookups'::regclass
       and c.conkey = array[color_attnum]
  ) then
    raise exception '0415: dyeings.color_id does not point at public.config_lookups';
  end if;
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_dyeings'::regclass
       and c.contype = 'f' and c.confrelid = 'public.color_card_colors'::regclass
       and c.conkey = array[color_attnum]
  ) then
    raise exception '0415: dyeings.color_id still points at color_card_colors';
  end if;

  -- 3c. The Type column exists and carries the whole vocabulary.
  --
  --     ASSERTED FROM THE CONSTRAINT, NOT BY A TRIAL INSERT, and the difference
  --     matters. The obvious probe — insert 'tie_dye' and expect a rejection —
  --     cannot work here: `amendment_id` is NOT NULL with no default and there
  --     is no amendment to hang a probe row off, so the insert trips
  --     not_null_violation FIRST. Swallowing that (as a handler must, or the
  --     migration fails on a healthy database) leaves a probe that passes
  --     without ever reaching the CHECK — a test asserting its own success,
  --     which is the exact shape 0386 shipped and this file's header cites.
  --     `pg_get_constraintdef` reads the constraint Postgres actually stored,
  --     so it is still the catalog answering rather than the migration text.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_structures'
       and column_name='item_sub_type'
  ) then
    raise exception '0415: structures.item_sub_type was not added';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_structures'::regclass
       and conname  = 'garment_order_amendment_structures_item_sub_type_check'
       and pg_get_constraintdef(oid) like '%solid%'
       and pg_get_constraintdef(oid) like '%melange%'
       and pg_get_constraintdef(oid) like '%yarn_dyed%'
       and pg_get_constraintdef(oid) like '%printed%'
  ) then
    raise exception '0415: item_sub_type has no CHECK, or it is missing one of '
                    'the four types the screen can set';
  end if;

  -- 3d. The colour kind is actually accepted. Asserted by USE, not by reading
  --     the constraint text back — a CHECK rebuilt without the new member would
  --     read as correct in the migration and reject every row at runtime.
  begin
    insert into public.config_lookups (kind, code, name)
    values ('fabric_color', '__0415_probe__', '__0415 PROBE__');
    delete from public.config_lookups
     where kind = 'fabric_color' and code = '__0415_probe__';
  exception when check_violation then
    raise exception '0415: config_lookups rejects kind ''fabric_color''';
  end;

  -- 3e. The seeding this repoint exists to enable must be reachable.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_style_components'
       and column_name='fabric_category_id'
  ) then
    raise exception '0415: garment_style_components.fabric_category_id is gone — '
                    'structures cannot flow in from Style Entry';
  end if;
end $verify$;
