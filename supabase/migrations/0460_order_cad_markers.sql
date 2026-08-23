-- ============================================================================
-- Raagam ERP — 0460 Orders ▸ CAD Markers and Component Gram Weights
--
-- doc/file.md §2, "The Digital CAD Loop and Marker Handoff Workflow": the CAD
-- room maps template patterns against fabric roll widths (Dia / Width, வித்),
-- records the exact weight IN GRAMS of every coordinate component panel — Front
-- Body 120g, Sleeve 45g, Neck Rib 12g — attaches the marker PDF, and on submit
-- those weights are pushed to step 4/5 (Fabric BOM) so a merchandiser can
-- compute raw material without waiting on the CAD room.
--
-- Nothing of this existed. Verified from the catalog before writing, not
-- assumed: `information_schema.tables` holds no table matching '%cad%' or
-- '%marker%', and no column anywhere carries a gram weight.
--
-- ## THREE TABLES, AND THE MIDDLE ONE IS THE ONE WORTH ARGUING ABOUT
--
--   order_cad_markers          one CAD sheet per garment order
--     -> _marker_layouts       one MARKER: a style laid out at one roll dia
--          -> _component_weights   grams for one panel on that marker
--
-- The weights hang off the LAYOUT rather than off the sheet, because a garment's
-- panels are not all cut on one marker: the body goes on 30" single jersey and
-- the neck rib on 24" rib, and each of those is a separate marker with its own
-- PDF. Hanging the weights off the header instead would force one dia per style
-- and there would be nowhere to say which marker a panel was measured on.
--
-- ## KEYED TO `garment_order_amendments`, NOT `sales_orders`
--
-- Same call 0418 (Material BOM) and 0426 (Fabric BOM) both record: the garment
-- order's real content — styles, combos, components, approval quantities — lives
-- on the amendment, and the `sales_orders` shell carries `order_qty` 0. A CAD
-- sheet that pointed at the shell could not name a style.
--
-- ## NO DOCUMENT NUMBER, DELIBERATELY
--
-- There is no `code` column here. doc/file.md §1 is explicit that the RE Number
-- (`sales_orders.order_number`, minted by `sales_order_no_format()` in 0395) is
-- "the universal primary key" for floor-level communication, and this sheet is
-- one-per-order — so a CAD document number would be a second number naming the
-- same job, which is the thing §1 says not to do. The queue lists the RE No.
--
-- ## `dia` IS A NUMBER HERE, NOT AN FK TO THE KNITTING DIA MASTER
--
-- The master exists — `config_lookups` kind 'knitting_dia', maintained by
-- `components/masters/knitting-dia-master-screen.tsx`, where `code` is the dia
-- and `name` its description. It is NOT the FK target, for two reasons read off
-- the live catalog rather than guessed:
--
--   1. `order_fabric_bom_lines.dia` — the column this hands off to — is
--      `numeric(10,2)`. An FK here would have to be translated into a number on
--      the way out, and the translation would be a parse of free text.
--   2. The one live `knitting_dia` row has `code = NULL` and `name` =
--      'Test 30 inch'. There is no number in it to parse. A field whose only
--      option cannot produce a valid dia is a field nobody can fill in.
--
-- So the dia is typed as a number, exactly as the Fabric BOM one step
-- downstream already types it, and the two columns hold the same kind of value
-- with no conversion between them. If the master is ever populated with numeric
-- codes, offering them as a picker is a screen change, not a schema change.
--
-- ## THE FABRIC IS ON THE WEIGHT, NOT ON THE LAYOUT — AND IT IS `categories`
--
-- A layout is a style laid out at one roll dia and nothing else; the fabric a
-- panel is cut from belongs to the PANEL, which is where `fabric_category_id`
-- sits.
--
-- `categories`, and EVERY source of a panel speaks that one vocabulary. Read
-- from `pg_constraint`, which is the only place that can answer it:
--
--     order_fabric_bom_lines.structure_id                         -> categories
--     garment_order_amendment_style_components.fabric_category_id -> categories
--     garment_order_amendment_combo_structures.structure_id       -> categories
--
-- The third line is the trap, and it is worth spelling out because a reader
-- checking the migrations rather than the catalog gets it wrong: 0408 created
-- that column against `config_lookups` kind 'fabric_structure', and **0409
-- repointed it at `categories` minutes later** — "The reasoning was fine; the
-- premise was wrong, and the CATALOG says so". 0408's header still describes a
-- split that has not existed since. This migration's own first draft believed
-- it and nulled the fabric on every combo-tree panel, which is every order that
-- exists today; the cost is recorded in `lib/orders/cad/panels.ts`.
--
-- It was left out of the first draft of this migration on the reasoning that a
-- weight is matched to a BOM line by (style, component) and never by structure.
-- That reasoning was wrong, and 0457 is what showed it: a FRONT BODY cut in
-- single jersey and a FRONT BODY cut in 1x1 rib are two rows there and two lines
-- on the Fabric BOM, and with one weight between them BOTH lines take the whole
-- body weight. Nothing on screen says so and the figure looks ordinary.
--
-- ## THE MARKER PDF IS FOUR COLUMNS ON THE LAYOUT, NOT A ROW IN
-- ## `garment_order_amendment_files`
--
-- The obvious home for it was 0416's attachment table under a new `doc_kind`,
-- and that was the instruction this migration was written against. It is not
-- safe today, and the reason is worth recording because it will look like an
-- oversight otherwise:
--
--   * `lib/orders/amendments/actions.ts` (`writeChildren`) DELETES
--     `garment_order_amendment_files` wholesale `where amendment_id = …` on
--     every save of the order and reinserts what the form is holding. A second
--     writer's rows survive only by being round-tripped through that form.
--   * They cannot be. `amendmentFileInput.doc_kind` in
--     `lib/orders/amendments/types.ts` is `z.enum(['sketch','order_sheet',
--     'approval'])`. A row reading 'marker' comes back out of the form as
--     'marker' and the ENTIRE garment order save then fails validation.
--
-- So a marker filed there would either delete itself or block the order screen.
-- Both files are outside this lane. The bytes still live in the SAME private
-- `garment-order-docs` bucket 0416 created, under the same policies — there is
-- no second bucket and no second attachment table, only columns on the record
-- the PDF actually describes. See the note in the lane report for the exact
-- three-line change that would let these move into the shared table.
--
-- ## GRAMS: NULL IS "NOT MEASURED YET". 0 IS REFUSED OUTRIGHT.
--
-- The two are different states and only one of them is an answer. A panel that
-- has not been weighed is NULL, and every consumer refuses on it by name
-- ("SLEEVE has no marker weight yet") rather than multiplying by nothing. A
-- panel that weighs zero does not exist, so `grams > 0` is a CHECK: the value
-- cannot be stored at all, rather than being stored and quietly meaning
-- "this order needs no fabric for the sleeves".
--
-- ## GRAMS ARE PER GARMENT, NOT PER PANEL PIECE
--
-- A two-sleeve tee records ONE sleeve row carrying the weight of both sleeves.
-- The alternative — grams per piece plus a pieces-per-garment count — was
-- considered and dropped: it adds an axis nobody asked for and a way to double
-- every symmetrical panel, and the spec's own example ("Sleeve: 45g") reads as
-- the garment's sleeve allowance. The column comment says so, because a future
-- reader will otherwise assume the axis was forgotten.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The CAD sheet — one per garment order.
-- ---------------------------------------------------------------------------
create table if not exists public.order_cad_markers (
  id               uuid primary key default gen_random_uuid(),
  garment_order_id uuid not null
                     references public.garment_order_amendments(id) on delete cascade,
  marker_date      date not null default current_date,

  -- 'draft'     CAD is still measuring; nothing is handed downstream.
  -- 'submitted' the marker set is finalised — §2's "Automated Workspace Sync"
  --             is what a submit means, and it is the state the Fabric BOM seed
  --             refuses to run without. A CHECK rather than a lookup table for
  --             the reason 0411 gives: two fixed values the business does not
  --             add to are a constraint, not a master.
  status           text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at     timestamptz,
  submitted_by     uuid references public.profiles(id),

  remark           text,

  -- `auth.uid()` by default (0383 · 0388), so the queue's Created User column
  -- resolves through `creator_names()` like every other list in the app.
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ONE SHEET PER ORDER, as a constraint rather than a convention — the same call
-- `uq_order_fabric_bom_order` (0426) makes, and for the same payoff: with a
-- second sheet unable to exist, no reader has to implement "latest wins" and
-- then agree with every other reader about what latest means.
create unique index if not exists uq_order_cad_marker_order
  on public.order_cad_markers(garment_order_id);

drop trigger if exists trg_order_cad_markers_updated on public.order_cad_markers;
create trigger trg_order_cad_markers_updated before update on public.order_cad_markers
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 2. One marker: a style laid out at one roll dia, with its PDF.
-- ---------------------------------------------------------------------------
create table if not exists public.order_cad_marker_layouts (
  id             uuid primary key default gen_random_uuid(),
  marker_id      uuid not null references public.order_cad_markers(id) on delete cascade,
  sno            int not null default 0,

  -- BY VALUE, never by FK. Orders key styles by TEXT throughout (0407 · 0421):
  -- `garment_order_amendment_styles.style_ref_no` is what the combos, the
  -- approval quantities and the Fabric BOM lines all carry, and the amendment's
  -- child rows are deleted and reinserted on every save, so their ids are
  -- rewritten. An FK to one of them would dangle on the next save of the order.
  style_ref_no   text,

  -- "Dia / Width (வித்)" — the fabric roll width the marker is planned against.
  -- numeric(10,2) to match `order_fabric_bom_lines.dia` exactly; see the header
  -- for why this is not an FK to the knitting_dia master.
  dia            numeric(10,2),

  -- The marker PDF. Bytes in the PRIVATE `garment-order-docs` bucket (0416);
  -- `storage_path` is the key INSIDE that bucket and never a URL, because a
  -- signed URL expires and a stored one is a row that reads correctly today and
  -- 404s next week. Every column nullable: a layout is planned before its PDF
  -- is exported, and `not null` would turn "not attached yet" into a 23502.
  file_name      text,
  storage_path   text,
  mime_type      text,
  size_bytes     bigint,

  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ocml_marker
  on public.order_cad_marker_layouts(marker_id);

-- One object is attached once, for the reason `uq_goa_files_path` (0416) gives:
-- this cannot catch a double-save, and what it does catch is the operator error
-- that actually happens — the same file uploaded twice in one session.
create unique index if not exists uq_ocml_path
  on public.order_cad_marker_layouts(marker_id, storage_path)
  where storage_path is not null;


-- ---------------------------------------------------------------------------
-- 3. The gram weights — one row per coordinate component panel.
-- ---------------------------------------------------------------------------
create table if not exists public.order_cad_component_weights (
  id            uuid primary key default gen_random_uuid(),
  layout_id     uuid not null
                  references public.order_cad_marker_layouts(id) on delete cascade,
  sno           int not null default 0,

  -- Which part of the garment. 0396 moved both of these OFF the `config_lookups`
  -- kinds that shadowed them, and 0397/0408 kept them there on the order's own
  -- combo tree: a coordinate is an `items` row (a set's Top / Bottom), a
  -- component is the `components` master (FRONT BODY, SLEEVE, NECK RIB).
  -- Pointing either back at `config_lookups` would reintroduce the defect 0396
  -- exists to remove.
  --
  -- `coordinate_id` is NULLABLE: a 'piece' garment has one coordinate and
  -- naming it is noise. The unique index below is `nulls not distinct` so that
  -- an unnamed coordinate still cannot be weighed twice.
  coordinate_id uuid references public.items(id),
  component_id  uuid references public.components(id),

  -- "Structure" — a fabric CATEGORY, and the vocabulary matters more here than
  -- anywhere else in this migration.
  --
  -- `categories`, the same target as `order_fabric_bom_lines.structure_id`
  -- (0409 · 0426), `garment_order_amendment_style_components.fabric_category_id`
  -- (0457) AND `garment_order_amendment_combo_structures.structure_id` — that
  -- last one repointed off `config_lookups` by 0409, so the header's warning
  -- about 0408 applies here too. All three verified in `pg_constraint`.
  --
  -- NULLABLE, and null is an ordinary value: a source row that never named a
  -- fabric, and every weight entered before this column existed. It is NOT a
  -- statement that the fabric is unknowable — `seedConsumptionFor` PREFERS an
  -- exact match and falls back to a null-fabric weight, so a null still seeds.
  --
  -- What the column buys is the
  -- ability to tell a FRONT BODY cut in single jersey from a FRONT BODY cut in
  -- 1x1 rib — a contrast yoke, which 0457 calls "an entirely normal garment".
  -- Without it those two are ONE weight against TWO fabric BOM lines, and both
  -- lines take the whole body weight: a silent doubling of the largest line in
  -- the order.
  fabric_category_id uuid references public.categories(id),

  -- The weight of this panel IN GRAMS, per garment. See the header: NULL is
  -- "not measured yet" and is refused by name downstream; 0 is refused here.
  grams         numeric(12,3) check (grams is null or grams > 0),

  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_occw_layout
  on public.order_cad_component_weights(layout_id);

-- A PANEL IS WEIGHED ONCE PER MARKER. Two rows for the same panel are two
-- weights that get ADDED by the rollup, which is a silent doubling of the
-- largest line in the order.
--
-- `nulls not distinct` (PG 15+; this database is 17.6) is what makes that true
-- for the ordinary 'piece' garment, where `coordinate_id` is NULL on every row —
-- under the default NULLS DISTINCT the index would admit unlimited duplicates
-- for exactly the commonest case.
--
-- ACROSS layouts it cannot be enforced by an index at all (the marker is the
-- weight's grandparent), so the same panel weighed on two markers of one sheet
-- is caught in the rollup instead, by name — see `componentWeightsForOrder` in
-- lib/orders/cad/weights.ts.
-- `fabric_category_id` IS IN THE KEY, for the reason 0457 gives for putting it
-- in its own: a key that stops at (coordinate, component) refuses the contrast
-- yoke — the same panel legitimately cut in two fabrics — and refuses it at SAVE
-- time, on rows seeded out of an order that permits them.
create unique index if not exists uq_occw_panel
  on public.order_cad_component_weights(
    layout_id, coordinate_id, component_id, fabric_category_id
  )
  nulls not distinct;


-- ---------------------------------------------------------------------------
-- 4. RLS — the `orders` module, the same four policies every sibling carries.
--
-- Gated on `has_permission('orders', …)` rather than on `to authenticated`
-- alone, exactly as 0416 argues: a marker names the customer's style and the
-- panels it is cut from, and a logged-in machinist with no Orders permission
-- can no more read it than they can read the order it belongs to.
--
-- No CAD-specific permission module is invented here. Adding one is a change to
-- the permission catalog and the role screens, which is a different lane's file
-- set; §4 of the spec wants CAD Technicians as a ROLE, and a role granted
-- `orders:edit` reaches this today.
-- ---------------------------------------------------------------------------
do $rls$
declare
  t text;
begin
  foreach t in array array[
    'order_cad_markers',
    'order_cad_marker_layouts',
    'order_cad_component_weights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($f$
      drop policy if exists %1$s_read   on public.%1$s;
      drop policy if exists %1$s_insert on public.%1$s;
      drop policy if exists %1$s_update on public.%1$s;
      drop policy if exists %1$s_delete on public.%1$s;
      create policy %1$s_read   on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
  end loop;
end $rls$;

comment on table public.order_cad_markers is
  'One CAD marker sheet per garment order (0460, doc/file.md §2). No document '
  'number: the RE No on the order is the key §1 makes universal.';
comment on table public.order_cad_marker_layouts is
  'One marker — a style laid out at one fabric roll dia — and its PDF. Bytes '
  'live in the PRIVATE garment-order-docs bucket (0416); storage_path is the '
  'key inside it, never a URL.';
comment on table public.order_cad_component_weights is
  'The weight in GRAMS of one coordinate component panel, PER GARMENT (both '
  'sleeves in one row, not one). NULL means not measured yet and is refused by '
  'name downstream; 0 is refused by CHECK.';
comment on column public.order_cad_component_weights.grams is
  'Grams per garment for this panel. NULL = not measured yet, never "no fabric '
  'needed". A two-sleeve garment records the pair as one row.';
comment on column public.order_cad_marker_layouts.dia is
  'Fabric roll width (Dia / Width, வித்). numeric(10,2) to match '
  'order_fabric_bom_lines.dia, which this hands off to unconverted.';


-- ============================================================================
-- 5. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The three constraints that carry arithmetic consequences are asserted BY
-- VIOLATING THEM rather than by looking their names up in `pg_indexes`. A name
-- being present proves a name is present; what is worth knowing is that a
-- second CAD sheet, a zero weight and a twice-weighed panel are actually
-- refused. The `nulls not distinct` half is exercised with a NULL coordinate
-- specifically, because that is the case the DEFAULT index behaviour would let
-- through and the case that occurs on every 'piece' garment.
-- ============================================================================
do $assert$
declare
  probe_order  uuid;
  probe_marker uuid;
  probe_layout uuid;
  probe_cat_a  uuid;
  probe_cat_b  uuid;
  n            int;
begin
  -- ---- the three tables exist ----
  select count(*) into n
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('order_cad_markers','order_cad_marker_layouts','order_cad_component_weights');
  if n <> 3 then
    raise exception '0460: expected 3 CAD tables, found %', n;
  end if;

  -- ---- four policies on each ----
  select count(*) into n
    from pg_policies
   where schemaname = 'public'
     and tablename in ('order_cad_markers','order_cad_marker_layouts','order_cad_component_weights');
  if n <> 12 then
    raise exception '0460: expected 12 RLS policies across the CAD tables, found %', n;
  end if;

  -- ---- the unique index really is NULLS NOT DISTINCT ----
  -- Read from pg_index rather than from the DDL above: `nulls not distinct` is
  -- one keyword, it is silently accepted as absent, and its absence is
  -- invisible until two identical panels have been added together.
  if not exists (
    select 1 from pg_index i
     where i.indexrelid = 'public.uq_occw_panel'::regclass
       and i.indnullsnotdistinct
  ) then
    raise exception '0460: uq_occw_panel is NULLS DISTINCT — a piece garment could be weighed twice';
  end if;

  -- ---- the behaviour, exercised ----
  -- Any confirmed garment order will do. With none there is nothing to hang a
  -- probe off, and the behavioural assertions are SKIPPED rather than faked.
  select id into probe_order from public.garment_order_amendments limit 1;

  if probe_order is not null then
    insert into public.order_cad_markers (garment_order_id) values (probe_order)
      returning id into probe_marker;

    -- one sheet per order
    begin
      insert into public.order_cad_markers (garment_order_id) values (probe_order);
      raise exception '0460: a second CAD sheet was admitted for one order';
    exception when unique_violation then null;  -- expected
    end;

    insert into public.order_cad_marker_layouts (marker_id, sno, style_ref_no, dia)
      values (probe_marker, 9001, '__0460_PROBE', 30)
      returning id into probe_layout;

    -- a zero weight is not "no fabric needed"
    begin
      insert into public.order_cad_component_weights (layout_id, sno, grams)
        values (probe_layout, 9001, 0);
      raise exception '0460: grams admitted 0 — "weighs nothing" would read as a real answer';
    exception when check_violation then null;  -- expected
    end;

    -- NULL grams IS admitted: "not measured yet" is a normal state of a sheet
    -- being filled in, and refusing it would make a half-done marker unsavable.
    insert into public.order_cad_component_weights (layout_id, sno, grams)
      values (probe_layout, 9002, null);

    -- and a panel cannot be weighed twice on one marker, with the coordinate
    -- left NULL — the shape every 'piece' garment takes.
    begin
      insert into public.order_cad_component_weights (layout_id, sno, grams)
        values (probe_layout, 9003, null);
      raise exception '0460: the same panel was weighed twice on one marker (NULL coordinate)';
    exception when unique_violation then null;  -- expected
    end;

    -- THE OTHER HALF OF THE SAME KEY, and the half a narrower index breaks: the
    -- same panel in a SECOND fabric is ACCEPTED. 0457 asserts this about its own
    -- key for the same reason — a contrast yoke is an ordinary garment, and a
    -- key that refuses it turns a legitimate style into an unsaveable sheet.
    select id into probe_cat_a from public.categories order by id limit 1;
    select id into probe_cat_b from public.categories where id <> probe_cat_a order by id limit 1;

    if probe_cat_a is not null and probe_cat_b is not null then
      insert into public.order_cad_component_weights
        (layout_id, sno, grams, fabric_category_id)
      values (probe_layout, 9004, 120, probe_cat_a),
             (probe_layout, 9005, 45,  probe_cat_b);

      -- ...and repeating ONE of them is still refused.
      begin
        insert into public.order_cad_component_weights
          (layout_id, sno, grams, fabric_category_id)
        values (probe_layout, 9006, 130, probe_cat_a);
        raise exception '0460: one panel was weighed twice in the same fabric';
      exception when unique_violation then null;  -- expected
      end;
    end if;

    -- Cascades clean up the layouts and the weights.
    delete from public.order_cad_markers where id = probe_marker;

    if exists (select 1 from public.order_cad_marker_layouts where marker_id = probe_marker) then
      raise exception '0460: deleting a CAD sheet left its layouts behind';
    end if;
  end if;
end $assert$;
