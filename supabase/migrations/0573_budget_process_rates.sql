-- ============================================================================
-- Raagam ERP — 0573 Budget ▸ Process Rates: four pulled process sources, and
-- the per-line facts a process charge needs
--
-- `doc/order/budget-purchase-rates.md` "Phase 2", client blueprint 2026-09-18:
-- Process Rates splits into Yarn Processes · Fabric Processes · Accessories
-- Processes · Garment Processes. The blueprint's `budget_fabric_processes` +
-- `_details` + `budget_garment_processes` tables are NOT used, for 0572's (and
-- 0428's) reason: one line table keyed by `source` is what lets `budgetTotals`
-- add every tab in one pass.
--
--
-- THREE NEW PULLED SOURCES, AND `process` IS RETIRED
--
--   yarn_process      (0504, unchanged) the Fabric BOM's yarn stages
--   fabric_process    the Fabric Process route, weighed by the Yarn & Fabric
--                     Requirement Report's stage ledger — NOTHING STORES that
--                     weight, so it is read from the report, never re-derived
--   material_process  `material_bom_amendment_processes`, weighed by the item's
--                     own stored requirement
--   garment_process   `garment_order_amendment_style_processes`, weighed by
--                     the style's production target
--
-- `process` was the one TYPED process source (0428), for "fabric and garment
-- steps". Both halves now arrive pulled, so a typed `process` line would be a
-- fourth tab's worth of lines with nowhere on the screen to show them. It is
-- folded into `garment_process` — which is where a hand-added row on the Garment
-- tab lands — BEFORE the CHECK is rewritten, or the rewrite would refuse the
-- existing rows. Live today: 0 budget lines at all, so the update is a no-op
-- here and is written anyway for any environment that has data.
--
--
-- `rate_type` IS per_unit | flat — NOT "Per KG" / "Per Piece"
--
-- The blueprint's Rate Type offers Per KG and Per Piece. Both are "per unit",
-- and WHICH unit is already on the line (`uom_id`). Storing "Per KG" beside a
-- line whose UOM is PCS would be two facts about one thing, and they would
-- disagree the first time someone changed one. So the label is READ off the
-- UOM, and the column says only the thing the UOM cannot: `flat`, a lump
-- charge not multiplied by the quantity (a screen charge, a set-up fee).
--
--
-- `basis` — THE GRAIN A PULLED LINE WAS SPLIT AT
--
--   process  one line per process (yarn / accessory / garment processwise)
--   fabric   one line per (process, fabric)
--   color    one line per (process, colourway)
--   part     one line per (process, component) — a garment's Partwise process
--
-- The screen's "+" parent row is a GROUP of lines sharing (order, process), not
-- a stored row, and changing its "For" re-splits the group's lines from the
-- breakdown. NULL on every typed source (cmt, expense, income) and on the
-- purchase sources, where there is no process to split.
--
-- `combo` — the colourway a `color` line is for. TEXT BY VALUE, the 0413 / 0433
-- convention: a combo row's id is rewritten by every order save.
--
--
-- `no_of_pcs` / `no_of_units` — THE GARMENT TAB'S TWO MULTIPLIERS
--
-- Garment Reqd = production target x No of Pcs x No of Units, DERIVED by
-- `lineReqd()` in lib/orders/budget/totals.ts and never stored (0428's rule on
-- `amount`, one column along). NULL = 1, so every line of every other source —
-- and every line written before today — keeps its quantity exactly. Strictly
-- positive when given: a multiplier of 0 would silently zero a real charge.
--
--
-- `style_ref_no` / `component_id` — WHICH GARMENT LINE A GARMENT PROCESS IS FOR
--
-- A garment_process line has no item and no colourway, so without these two the
-- same process on two STYLES of one order — or the same Partwise process on two
-- COMPONENTS of one style — are indistinguishable: identical (order, process,
-- basis), and a screen that de-duplicates a re-pull on that key keeps one and
-- silently drops the other's cost. They are real columns rather than a style
-- squeezed into `combo`, which means a colourway and is read as one.
--
-- `style_ref_no` is TEXT BY VALUE, the order module's convention (0407 · 0411):
-- the order's style rows are deleted and reinserted on every save, so an FK to
-- `garment_order_amendment_styles.id` would point at a row that no longer
-- exists after the next Save. `component_id` IS an FK — to `components`, the
-- master the Style ▸ Process row itself points at (0421) — and it is the only
-- FK from this table to `components`, so no embed becomes ambiguous.
-- Every other source leaves both NULL.
-- ============================================================================


alter table public.order_budget_lines
  add column if not exists process_id  uuid references public.processes(id),
  add column if not exists basis       text,
  add column if not exists combo       text,
  add column if not exists rate_type   text not null default 'per_unit',
  add column if not exists no_of_pcs   numeric(12,3),
  add column if not exists no_of_units numeric(12,3),
  add column if not exists style_ref_no text,
  add column if not exists component_id uuid references public.components(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_basis') then
    alter table public.order_budget_lines
      add constraint chk_obl_basis
      check (basis is null or basis in ('process', 'fabric', 'color', 'part'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_rate_type') then
    alter table public.order_budget_lines
      add constraint chk_obl_rate_type
      check (rate_type in ('per_unit', 'flat'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_no_of_pcs') then
    alter table public.order_budget_lines
      add constraint chk_obl_no_of_pcs
      check (no_of_pcs is null or no_of_pcs > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_no_of_units') then
    alter table public.order_budget_lines
      add constraint chk_obl_no_of_units
      check (no_of_units is null or no_of_units > 0);
  end if;
end
$$;

create index if not exists idx_obl_process on public.order_budget_lines(process_id);


-- ---------- The source vocabulary ---------------------------------------------
--
-- `process` → `garment_process` FIRST (see the header), then the CHECK is
-- RESTATED IN FULL — the idiom 0493 and 0504 used on this same constraint: a
-- CHECK is only ever as correct as the last migration to write it, so every
-- value is said out loud.

update public.order_budget_lines
   set source = 'garment_process'
 where source = 'process';

alter table public.order_budget_lines
  drop constraint if exists order_budget_lines_source_check;

alter table public.order_budget_lines
  add constraint order_budget_lines_source_check
  check (source in (
    'fabric', 'yarn', 'material',
    'yarn_process', 'fabric_process', 'material_process', 'garment_process',
    'cmt', 'expense', 'income'
  ));

comment on column public.order_budget_lines.source is
  'PULLED: fabric | yarn | material (Purchase Rates) and yarn_process | '
  'fabric_process | material_process | garment_process (Process Rates). TYPED: '
  'cmt | expense | income. The typed `process` source was retired by 0573 and '
  'folded into garment_process. A pulled line''s quantity is a figure somebody '
  'else computed, so re-typing it would be a second answer to an answered '
  'question.';
comment on column public.order_budget_lines.process_id is
  'The process this line charges for. Set on the four *_process sources. 0573.';
comment on column public.order_budget_lines.basis is
  'The grain a pulled process line was split at: process | fabric (per fabric) | '
  'color (per colourway) | part (per garment component). NULL where there is no '
  'process to split. 0573.';
comment on column public.order_budget_lines.combo is
  'The colourway a basis=color line is for. Text by value (0413 / 0433). 0573.';
comment on column public.order_budget_lines.rate_type is
  'per_unit = rate x Reqd; flat = the rate IS the charge. "Per KG" / "Per Piece" '
  'is per_unit with its word read off uom_id — never stored beside it. 0573.';
comment on column public.order_budget_lines.no_of_pcs is
  'Garment Processes multiplier. Reqd = qty x no_of_pcs x no_of_units, derived by '
  'lineReqd(). NULL = 1, so no other source changes. 0573.';
comment on column public.order_budget_lines.no_of_units is
  'Garment Processes multiplier. NULL = 1 — see no_of_pcs. 0573.';
comment on column public.order_budget_lines.style_ref_no is
  'The style a garment_process line is for. TEXT BY VALUE (0407 / 0411): the '
  'order''s style rows are rewritten on every save. NULL on every other source. 0573.';
comment on column public.order_budget_lines.component_id is
  'The component a Partwise (basis = part) garment_process line is for — the '
  'same components row the Style ▸ Process row names (0421). NULL otherwise. 0573.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. Every
-- column's shape is asserted (an `add column if not exists` that found a
-- namesake of the wrong shape reports success too), every CHECK by its
-- definition, the source vocabulary value by value, and the retirement by its
-- own question: is any line still `process`?
--
-- No new function, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ----------------------------------------------------------------------------

do $verify$
declare
  c   record;
  def text;
  v   text;
  fk  int;
begin
  for c in
    select * from (values
      ('process_id',  'uuid',    'YES', null::text),
      ('basis',       'text',    'YES', null),
      ('combo',       'text',    'YES', null),
      ('rate_type',   'text',    'NO',  '''per_unit''::text'),
      ('no_of_pcs',   'numeric', 'YES', null),
      ('no_of_units', 'numeric', 'YES', null),
      ('style_ref_no', 'text',   'YES', null),
      ('component_id', 'uuid',   'YES', null)
    ) as t(col, typ, nullable, dflt)
  loop
    perform 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'order_budget_lines'
       and column_name = c.col
       and data_type = c.typ
       and is_nullable = c.nullable
       and column_default is not distinct from c.dflt;
    if not found then
      raise exception '0573: order_budget_lines.% is missing or not % / nullable=% / default %',
        c.col, c.typ, c.nullable, coalesce(c.dflt, 'none');
    end if;
  end loop;

  select count(*) into fk
    from pg_constraint
   where conrelid = 'public.order_budget_lines'::regclass
     and confrelid = 'public.processes'::regclass
     and contype = 'f';
  if fk <> 1 then
    raise exception '0573: expected one FK from order_budget_lines to processes, found %', fk;
  end if;

  -- ONE FK to components, and ONLY one: a second would make every bare
  -- `components(...)` embed on this table a 300 (AGENTS.md).
  select count(*) into fk
    from pg_constraint
   where conrelid = 'public.order_budget_lines'::regclass
     and confrelid = 'public.components'::regclass
     and contype = 'f';
  if fk <> 1 then
    raise exception '0573: expected one FK from order_budget_lines to components, found %', fk;
  end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_basis';
  foreach v in array array['process', 'fabric', 'color', 'part'] loop
    if def is null or def not like '%''' || v || '''%' then
      raise exception '0573: chk_obl_basis is missing or does not admit % (%)', v, def;
    end if;
  end loop;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_rate_type';
  if def is null or def not like '%''per_unit''%' or def not like '%''flat''%' then
    raise exception '0573: chk_obl_rate_type is missing or wrong (%)', def;
  end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_no_of_pcs';
  if def is null or def not like '%no_of_pcs > %' then
    raise exception '0573: chk_obl_no_of_pcs is missing or wrong (%)', def;
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_no_of_units';
  if def is null or def not like '%no_of_units > %' then
    raise exception '0573: chk_obl_no_of_units is missing or wrong (%)', def;
  end if;

  -- The vocabulary, VALUE BY VALUE — ten in, and `process` out.
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'order_budget_lines_source_check';
  if def is null then
    raise exception '0573: order_budget_lines_source_check is missing';
  end if;
  foreach v in array array[
    'fabric', 'yarn', 'material', 'yarn_process', 'fabric_process',
    'material_process', 'garment_process', 'cmt', 'expense', 'income'
  ] loop
    if def not like '%''' || v || '''%' then
      raise exception '0573: the source CHECK does not admit % (%)', v, def;
    end if;
  end loop;
  if def like '%''process''%' then
    raise exception '0573: the source CHECK still admits the retired ''process'' (%)', def;
  end if;

  -- THE RETIREMENT BY ITS OWN QUESTION, not by a row count (0 lines live).
  if exists (select 1 from public.order_budget_lines where source = 'process') then
    raise exception '0573: a budget line still carries the retired source ''process''';
  end if;
end $verify$;
