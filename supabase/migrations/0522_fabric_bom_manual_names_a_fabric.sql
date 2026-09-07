-- 0522 — Fabric BOM ▸ Manual: THE ENTRY NAMES A FABRIC, not a fabric structure.
--
-- Client 2026-09-03, legacy screenshots 2666 · 2667 ("Manual tab rearrange …
-- did you get my point? no it's totally wrong, update it"). Legacy's Manual tab
-- is three nested grids and the MIDDLE one is a fabric row:
--
--   S No | Fabric            | Type     | Gsm | Type      | Calculated | …
--   1    | SOLID SINGLE JER… | Circular | 180 | OpenWidth | Direct     | …
--
-- There is no Structure column at that level at all. The cloth is named
-- directly and everything beside it — the knit type, the GSM, the measurement
-- unit — is READ OFF that cloth.
--
-- ## WHY THIS IS A COLUMN AND NOT A SCREEN CHANGE
--
-- 0494 made the entry the counting unit and keyed it on `structure_id`, with
-- `entryFabric()` in actions.ts resolving the actual cloth by matching the
-- entry's structure and style against `order_fabric_bom_lines`. That resolution
-- is the thing this migration deletes, and it was never able to answer in one
-- real case its own comment names: "a structure carrying two different fabrics
-- across its lines is a real state on a multi-style order, and picking either
-- would plan the order's largest line off the wrong cloth". It abstained, and
-- an abstention is a Save the planner cannot complete.
--
-- Naming the cloth removes the question rather than answering it better.
--
-- ## `structure_id` STAYS, AND STOPS BEING TYPED
--
-- It is not dropped, because the requirement engine keys its GSM lookup on a
-- structure (`gsmByStructure`) and the order's own tree is stated per structure.
-- It becomes DERIVED — written on save as the chosen fabric's `items.category_id`,
-- which is the same equality 0426 · 0490 already rely on ("a Structure on this
-- screen IS a fabric CATEGORY"). One fact, one place it is typed, one place it
-- is copied to. A future reader must not offer it as a field again.
--
-- ## NOTHING TO BACK-FILL, MEASURED RATHER THAN ASSUMED
--
--   order_fabric_boms                    0 rows
--   order_fabric_bom_lines               0 rows
--   order_fabric_bom_manual_entries      0 rows
--   order_fabric_bom_manual_sizes        0 rows
--   order_fabric_bom_manual_components   0 rows
--
-- (catalog, 2026-09-03, immediately before this migration). No Fabric BOM has
-- ever been saved, so there is no row whose structure would have to be resolved
-- back to a cloth — which is precisely why the grain can still be changed at
-- all. `item_id` is therefore nullable with no default: a draft entry that has
-- not named its cloth yet is a real state, and the Save gate refuses it by name
-- rather than the column refusing it by constraint.

alter table public.order_fabric_bom_manual_entries
  -- THE CLOTH THIS WEIGHT IS FOR. `items`, the same target
  -- `order_fabric_bom_lines.item_id` points at, so an entry and an allocation
  -- line name one fabric by one id.
  add column if not exists item_id uuid references public.items(id),

  -- "EndBit Loss %" — legacy's own column, beside the process loss rather than
  -- replacing it: the two are different allowances and legacy carries both on
  -- one row. Same range check `wastage_pct` carries, so nothing on this table
  -- disagrees about what a percentage is.
  add column if not exists endbit_loss_pct numeric(6,2) not null default 0
    check (endbit_loss_pct >= 0 and endbit_loss_pct <= 100),

  -- "Assort Color wise" — legacy renders it as a checkbox on the fabric row.
  -- NOT NULL with a default because it is a two-state answer and the planner is
  -- always doing one or the other; the same call `calc_mode` made in 0494.
  add column if not exists assort_color_wise boolean not null default false;

create index if not exists idx_ofbme_item
  on public.order_fabric_bom_manual_entries(item_id);

comment on column public.order_fabric_bom_manual_entries.item_id is
  'Fabric BOM ▸ Manual (0522) — THE CLOTH THIS ENTRY PLANS, named directly. '
  'Replaced structure_id as the entry''s key: legacy''s Manual row has a Fabric '
  'column and no Structure column, and resolving the cloth from the lines could '
  'not answer when one structure carried two fabrics. Nullable: a draft that has '
  'not chosen yet is a real state, refused by the Save gate rather than by SQL.';

comment on column public.order_fabric_bom_manual_entries.structure_id is
  'DERIVED SINCE 0522 — written on save as the chosen fabric''s items.category_id '
  '(a Structure on this screen IS a fabric category, 0405 · 0415 · 0426). Kept '
  'because the requirement engine keys its GSM lookup on a structure. It is no '
  'longer a field: never offer it for typing beside item_id.';

comment on column public.order_fabric_bom_manual_entries.endbit_loss_pct is
  'Legacy''s "EndBit Loss %" on the Manual fabric row (0522). Distinct from '
  'wastage_pct, which carries legacy''s "Component Proc. Loss %".';

comment on column public.order_fabric_bom_manual_entries.assort_color_wise is
  'Legacy''s "Assort Color wise" checkbox on the Manual fabric row (0522).';
