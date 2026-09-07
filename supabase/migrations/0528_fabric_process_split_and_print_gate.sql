-- ============================================================================
-- Raagam ERP — 0528 Fabric BOM ▸ Fabric Process: the [Assort Color] / [Components]
-- SPLIT, and a Print stage gate.
--
-- Client recording (transcript, 2026-09-04), read against 0492's own comment.
-- 0492 already named the legacy outer row's two bracketed cells verbatim —
-- "S No · Fabric Description · Type · Type · [Assort Color] · [Components]" —
-- and READ them: "the line already names the style, the colourway, the
-- structure, the panel and the fabric itself, so a second copy of that
-- description is a second place for one BOM to disagree with itself." That
-- was the wrong reading of `[Assort Color]` / `[Components]`. They are not a
-- second copy of what Fabric Lines already states — they are the two toggles
-- that decide whether the fabric's ROUTE is one grid or several:
--
--   both No               — one unified route for the whole fabric (0492's
--                            shape, unchanged).
--   Assort Color Wise Yes — one route PER COLOURWAY the fabric serves (a
--                            black shade needs more washing passes than white).
--   Component Wise Yes    — one route PER PANEL/COMPONENT the fabric covers
--                            (AOP on the body, standard dyeing on the sleeve).
--   both Yes              — one route per (colourway, component) PAIR. Not
--                            named on the call; taken as the plain reading of
--                            "both toggles narrow the same grouping at once",
--                            since nothing else in the two Cases stated a
--                            different combination. If the client means
--                            something narrower, this is the one line in this
--                            migration to correct.
--
-- The read-only summary 0492 built (the fabric's colourways / panels, listed
-- in the outer row) is UNCHANGED and stays useful on its own — this migration
-- adds a second, persisted fact beside it: whether that same list is also the
-- grouping the route beneath it is split by.
--
--
-- WHY TWO NEW COLUMNS ON THE ROUTE TABLE RATHER THAN A NEW ONE PER GROUPING
--
-- `order_fabric_bom_processes` is already keyed on `(bom_id, item_id, sno)`
-- for the unified case. Adding `combo` (nullable text, same spelling as
-- `order_fabric_bom_lines.combo`) and `component_id` (nullable, references
-- `public.components`) widens the SAME table to carry all four cases: both
-- null is the unified route, only `combo` set is a colour-wise route, only
-- `component_id` set is a component-wise route, and both set is the combined
-- grain. One table, one shape, no branching on which case a row belongs to
-- beyond reading which of its two new columns is null — same principle 0492
-- itself states for `item_id` over a second `structure_id`: the finer key
-- never needs to merge two things that were never the same.
--
-- `component_id` REFERENCES `public.components`, NOT `order_fabric_bom_lines`,
-- for 0492's own reason restated: a line's id is rewritten on every save
-- (`writeLines` deletes and re-inserts), so nothing keyed to one survives a
-- save. `components` is the master both `order_fabric_bom_lines.component_id`
-- and `garment_order_amendment_style_components.component_id` already point
-- at — the same panel identity the rest of this module uses.
--
--
-- `uq_ofbp_item_sno` HAS TO WIDEN TO MATCH, AND NULLS ARE THE TRAP
--
-- Postgres treats every NULL as distinct in a unique index, so
-- `(bom_id, item_id, combo, component_id, sno)` as written would let TWO
-- unified rows (`combo` and `component_id` both null) both claim sno 1 — the
-- exact duplicate the original index exists to refuse. Coalesced to sentinel
-- values the index is exact again: two rows in the SAME group (same fabric,
-- same colourway-or-none, same component-or-none) still cannot share a
-- position, and rows in different groups never collide on one.
--
--
-- `is_print` ON `public.processes` — THE OTHER HALF OF THE SAME CALL
--
-- Client: "if the user has not configured an All-Over Print (AOP) or Roll
-- form print under the Color/Composition tab, block the dyer/planner from
-- selecting Print as a process sequence stage." Nothing on the master
-- distinguishes a print process from any other — 0227's five `for_*` flags say
-- WHERE a process may appear, not WHAT KIND of step it is — so there is
-- nothing for the Fabric Process picker to test today.
--
-- A NAME-MATCH HEURISTIC AT READ TIME WAS REJECTED ON PURPOSE. "PRINT" also
-- appears in process names this flag must NOT catch by accident on a future
-- rename, and a heuristic re-evaluated on every render is a rule nobody can
-- see or correct from the master screen. A real column is what
-- `vendor_item_form` / `fabric_stage` already argue for a masters-owned flag:
-- seeded once from the same evidence a heuristic would use (the word PRINT in
-- an existing name), then handed to the operator to fix or extend through the
-- Process master's own "Print" checkbox — never re-derived silently.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. `is_print` — one process-master flag, seeded from the master's own data.
-- ---------------------------------------------------------------------------
alter table public.processes
  add column if not exists is_print boolean not null default false;

comment on column public.processes.is_print is
  'This process represents a PRINT step (AOP, rotary, bit printing, …). Read '
  'by the Fabric BOM ▸ Fabric Process picker (0528) to refuse "Print" until '
  'the order has declared an AOP / Roll form print. Seeded once from names '
  'already containing PRINT (0294''s legacy import); an operator-maintained '
  'checkbox from here on, never re-derived from the name at read time.';

update public.processes
  set is_print = true
  where is_print = false
    and name ilike '%print%';


-- ---------------------------------------------------------------------------
-- 2. The route table: drop `description` (client, same recording: "this
--    description column is not needed" — screen, schema and payload all drop
--    it together, the shape `rate` left in 0521), add the two split keys.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_processes
  drop column if exists description;

alter table public.order_fabric_bom_processes
  add column if not exists combo text,
  add column if not exists component_id uuid references public.components(id);

comment on column public.order_fabric_bom_processes.combo is
  'The colourway this step belongs to, when the fabric''s route is split '
  '"Assort Color Wise" (0528). NULL means this step is not colour-scoped — '
  'either the toggle is off, or (with Component Wise also on) the row is '
  'scoped by component alone. Same spelling as order_fabric_bom_lines.combo, '
  'held by VALUE like every colourway reference in this app.';

comment on column public.order_fabric_bom_processes.component_id is
  'The panel this step belongs to, when the fabric''s route is split '
  '"Component Wise" (0528). References public.components, never a BOM line — '
  'writeLines rewrites line ids on every save. NULL means this step is not '
  'component-scoped.';

drop index if exists public.uq_ofbp_item_sno;

create unique index if not exists uq_ofbp_item_sno
  on public.order_fabric_bom_processes(
    bom_id, item_id,
    coalesce(combo, ''),
    coalesce(component_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sno
  );


-- ---------------------------------------------------------------------------
-- 3. The two toggles themselves — a plain top-level child, one row per
--    (bom, fabric), exactly the shape `order_fabric_bom_processes` and
--    `_dias` already take. A route with zero steps still needs somewhere to
--    hold "Component Wise is ticked", so this cannot be inferred from the
--    route rows the way `routeStepCount` infers "done" — the toggle is the
--    fact, the rows are its consequence.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_process_scope (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null references public.order_fabric_boms(id) on delete cascade,
  item_id            uuid not null references public.items(id),
  assort_color_wise  boolean not null default false,
  component_wise     boolean not null default false,
  created_at         timestamptz not null default now()
);

create unique index if not exists uq_ofbps_item
  on public.order_fabric_bom_process_scope(bom_id, item_id);

comment on table public.order_fabric_bom_process_scope is
  'Fabric BOM ▸ Fabric Process (0528) — one row per (bom, fabric) recording '
  'whether that fabric''s route is split by colourway, by component, both or '
  'neither. A plain top-level child, like _dias and order_fabric_bom_processes '
  'itself; rewritten wholesale on every save.';

-- ---------- RLS — the child shape, copied verbatim from 0492 ----------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_process_scope'
  ) then
    create policy order_fabric_bom_process_scope_read on public.order_fabric_bom_process_scope
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_process_scope_insert on public.order_fabric_bom_process_scope
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_process_scope_update on public.order_fabric_bom_process_scope
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_process_scope_delete on public.order_fabric_bom_process_scope
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_process_scope enable row level security;
