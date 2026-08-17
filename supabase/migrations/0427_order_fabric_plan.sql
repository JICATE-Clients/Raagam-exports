-- ============================================================================
-- Raagam ERP — 0427 Fabric Plan · the route that makes the fabric
--
-- Step 6 of the client's order flow (client, 2026-08-17). Fabric BOM (0426) says
-- how much FINISHED FABRIC the order needs. This says how it gets made — yarn
-- purchase, knitting, dyeing, stentering, compacting — with each stage's loss
-- and whether it is done in-house or sent out.
--
--     input = output / (1 - loss/100),  solved BACKWARDS from the requirement
--
-- Not `output x (1 + loss/100)`. The two agree at 0% and diverge immediately:
-- at 10% loss on 100 kg the correct input is 111.12 and the plausible
-- alternative gives 110, which then loses 11 and delivers 99. Every stage is
-- short in the same direction, so a five-stage route lands ~5% under on the
-- largest purchase in the order and each line still looks right. The engine is
-- `lib/orders/fabric-plan/route.ts`, proved by `npm run check:fabric-plan` —
-- demonstrated failing first against exactly that substitution.
--
--
-- WHY IT IS A SEPARATE DOCUMENT FROM THE BOM
--
-- The client's split, and it is a real one rather than a screen boundary. The
-- BOM is a MERCHANDISING answer — what the buyer's garment needs — and the plan
-- is a PRODUCTION answer, which mill, which route, which processor. They move on
-- different clocks: a route is re-planned when a knitter is changed with the BOM
-- untouched, and a BOM is recomputed when the order's quantities move with the
-- route untouched. One document would make each edit look like the other.
--
--
-- A PLAN LINE ADDRESSES ITS BOM LINE BY VALUE — NOT BY `order_fabric_bom_lines.id`
--
-- THIS IS THE TRAP, and it is the same one 0423 and 0426 each record one table
-- along. `writeLines` in lib/orders/fabric-bom/actions.ts DELETES AND REINSERTS
-- every BOM line on every save of the BOM — the house pattern for child grids —
-- so a line's id does not survive its parent being saved. An FK to it would
-- dangle the first time anyone reopened the BOM and pressed Save, and because
-- the plan is a different screen nobody would be looking when it happened.
--
-- So a plan line carries the same five keys the BOM line carries: style_ref_no
-- and combo by VALUE, structure_id and component_id as MASTER ids, and item_id.
-- That tuple is stable across a BOM save because every part of it is either
-- typed text or a master row.
--
--
-- `required_qty` IS A SNAPSHOT, AND `bom_computed_at` IS WHAT MAKES THAT SAFE
--
-- The plan stores the requirement it planned against rather than joining the
-- BOM's requirement rows live. Two reasons, and the second is the one that
-- decides it:
--
--   1. The requirement rows are keyed by (line_id, style, combo, size) and
--      `line_id` is the unstable id above, so "the BOM's current figure for this
--      fabric" is a join the schema cannot express safely.
--   2. A yarn purchase is raised off this number. A figure that silently
--      followed the BOM would change under a PO that had already been placed —
--      0418's "a quantity controller needs a number that cannot move under the
--      purchaser's feet", one document further downstream.
--
-- `bom_computed_at` is copied from the BOM at plan time, so "the BOM has moved
-- since this route was planned" is a comparison rather than a guess. That is the
-- SAME shape as `computed_basis_hash` on both BOMs — a stored fingerprint of
-- what a figure was computed FROM — and it is deliberately a different question:
-- the BOMs ask whether the ORDER moved, this asks whether the BOM did.
--
--
-- `mode` IS SPELLED `in_house` / `outsourced`
--
-- Verbatim from `order_garment_processes` (0019), which asks the identical
-- question about a garment stage. A third spelling — `out_process` was the
-- obvious one and is what this table nearly carried — is what AGENTS.md records
-- under Nominated vendors as compiling, running and quietly matching nothing.
-- `check-fabric-plan.mts` asserts that `out_process` is refused.
--
--
-- `vendor_id` REFERENCES `master_vendors`
--
-- 0376 · 0377 · 0379 · 0380 repointed four tables for this and 0418 a fifth: the
-- picker hands back a master id and the purchase-side `public.vendors` FK
-- rejects every save. It is nullable because it is required FOR A STATE, not for
-- the column — mandatory on an out-processed stage, meaningless in-house. That
-- rule lives in `stageProblem()` in the engine, one function, called by the
-- screen and by the action.
--
--
-- THE STAGE QUANTITIES ARE STORED
--
-- Same three reasons 0418 sets out and 0426 repeats: `report_item_movements` is
-- a view and cannot call TypeScript; a purchase needs a number that does not
-- move; and the inputs stay beside the output so a figure agreed weeks ago is
-- still explainable. The compounding round-up is deliberate and is at the STAGE,
-- because each stage's input is a real quantity somebody issues or buys.
--
--
-- NO REPORT FRAGMENT HERE, AND THAT IS A DECISION
--
-- `report_item_movements` gains nothing from this table, because the material it
-- names is the SAME item the Fabric BOM already reports as `planned` — the route
-- is that quantity walked backwards, not a second demand. Adding a fragment
-- would double every fabric figure in every item report.
--
-- The yarn is a different item and IS new information, but this schema does not
-- know which item a stage consumes: a route names PROCESSES, and "knitting
-- consumes yarn X" is a conversion the yarn master and the fabric's composition
-- express, not this table. Declaring that gap is the honest move — see the
-- `order_fabric_plans` entry in lib/reports/registry.ts, `status: 'gap'`.
-- ============================================================================


-- ---------- 1. The document -------------------------------------------------

create table if not exists public.order_fabric_plans (
  id               uuid primary key default gen_random_uuid(),
  garment_order_id uuid not null
    references public.garment_order_amendments(id) on delete cascade,
  code             text,
  plan_date        date not null default current_date,
  is_draft         boolean not null default true,
  remark           text,
  -- The BOM this route was planned against, and WHEN that BOM last computed.
  -- The FK is to the BOM DOCUMENT, which is stable — it is the BOM's LINES that
  -- are rewritten on save. See the header.
  bom_id           uuid references public.order_fabric_boms(id) on delete set null,
  bom_computed_at  timestamptz,
  location_id      uuid references public.locations(id),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.order_fabric_plans is
  'Step 6: the process route that produces the fabric the BOM requires — yarn purchase, knitting, dyeing, finishing — with each stage''s loss. One per garment order (0427).';
comment on column public.order_fabric_plans.bom_computed_at is
  'The BOM''s computed_at as it stood when this route was planned. Compared, never summed: it is what makes "the BOM has moved since this was planned" a fact rather than a guess (0427).';
comment on column public.order_fabric_plans.bom_id is
  'The FK is to the BOM DOCUMENT, which is stable. A plan LINE must not reference order_fabric_bom_lines.id — writeLines deletes and reinserts every line on every save of the BOM (0427).';

create unique index if not exists uq_order_fabric_plan_order
  on public.order_fabric_plans(garment_order_id);
create index if not exists idx_ofp_bom on public.order_fabric_plans(bom_id);


-- ---------- 2. One fabric being planned -------------------------------------

create table if not exists public.order_fabric_plan_lines (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null
    references public.order_fabric_plans(id) on delete cascade,
  sno              int not null default 0,

  -- The BOM line this plans for, addressed by VALUE and by MASTER id. See the
  -- header: an FK to order_fabric_bom_lines.id would dangle on the BOM's next
  -- save, silently and on a screen nobody is looking at.
  style_ref_no     text,
  combo            text,
  structure_id     uuid references public.categories(id),
  component_id     uuid references public.components(id),
  item_id          uuid references public.items(id),

  -- The snapshot. NOT a live join — see the header.
  required_qty     numeric(16,4),
  required_uom_id  uuid references public.uoms(id),
  notes            text,
  created_at       timestamptz not null default now()
);

comment on column public.order_fabric_plan_lines.required_qty is
  'The Fabric BOM''s stored requirement for this fabric AS IT STOOD when the route was planned. A yarn purchase is raised off this, so it must not move under the purchaser''s feet (0418 · 0427).';

create index if not exists idx_ofpl_plan on public.order_fabric_plan_lines(plan_id);
create index if not exists idx_ofpl_item on public.order_fabric_plan_lines(item_id);

-- One plan line per fabric. NULLS NOT DISTINCT for 0426's stated reason on
-- uq_ofbr_slice: the default lets unlimited "blank" duplicates through, and four
-- of these five keys are nullable by design.
create unique index if not exists uq_ofpl_fabric
  on public.order_fabric_plan_lines(plan_id, style_ref_no, combo, structure_id, component_id, item_id)
  nulls not distinct;


-- ---------- 3. The route ----------------------------------------------------

create table if not exists public.order_fabric_plan_stages (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.order_fabric_plans(id) on delete cascade,
  line_id     uuid not null references public.order_fabric_plan_lines(id) on delete cascade,
  sno         int not null default 0,

  process_id  uuid references public.processes(id),
  -- `in_house` / `outsourced`, verbatim from order_garment_processes (0019).
  -- See the header on why a third spelling is the bug.
  mode        text not null default 'in_house'
    check (mode in ('in_house','outsourced')),
  -- master_vendors, never public.vendors (0376 · 0377 · 0379 · 0380 · 0418).
  vendor_id   uuid references public.master_vendors(id),

  -- Percentage of this stage's INPUT that does not come out.
  -- STRICTLY BELOW 100: at 100 the solve is a division by zero, and in JS that
  -- is Infinity rather than a throw — an ordinary-looking figure on its way to a
  -- purchase order. The CHECK is the database saying what the engine says.
  loss_pct    numeric(6,2)
    check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),

  -- Computed by routeQuantities() and stored. NULL is a refusal, never a zero.
  input_qty   numeric(16,4),
  output_qty  numeric(16,4),
  uom_id      uuid references public.uoms(id),
  refusal_reason text,

  planned_start date,
  planned_end   date,
  notes       text,
  created_at  timestamptz not null default now(),

  -- A stage either carries quantities or says why it has none. Both filled would
  -- be numbers nobody can interpret; neither filled is a row that means nothing.
  constraint chk_ofps_answer_or_reason
    check ((input_qty is null) = (output_qty is null)
       and ((input_qty is null) <> (refusal_reason is null)))
);

comment on table public.order_fabric_plan_stages is
  'One stage of one fabric''s route. Quantities are solved BACKWARDS from the BOM requirement — input = output / (1 - loss/100) — and stored, never projected (0427).';
comment on column public.order_fabric_plan_stages.loss_pct is
  'Percentage of this stage''s INPUT lost. Strictly below 100: at 100 the solve divides by zero, which in JS is Infinity rather than an error (0427).';
comment on column public.order_fabric_plan_stages.input_qty is
  'What must go in. The FIRST stage''s input is what has to be available before the route can start — a purchase when the route begins at yarn, an issue when it begins later.';

create index if not exists idx_ofps_plan on public.order_fabric_plan_stages(plan_id);
create index if not exists idx_ofps_line on public.order_fabric_plan_stages(line_id);
create index if not exists idx_ofps_vendor on public.order_fabric_plan_stages(vendor_id);

-- One stage per position per fabric, so a re-ordered route cannot leave two
-- rows claiming the same step.
create unique index if not exists uq_ofps_sequence
  on public.order_fabric_plan_stages(line_id, sno);


-- ---------- 4. RLS — the `orders` module, the four policies every sibling has -

do $rls$
declare
  t text;
begin
  foreach t in array array[
    'order_fabric_plans',
    'order_fabric_plan_lines',
    'order_fabric_plan_stages'
  ] loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s
          for select to authenticated using (public.has_permission('orders','view'));
        create policy %1$s_insert on public.%1$s
          for insert to authenticated with check (public.has_permission('orders','create'));
        create policy %1$s_update on public.%1$s
          for update to authenticated using (public.has_permission('orders','edit'))
          with check (public.has_permission('orders','edit'));
        create policy %1$s_delete on public.%1$s
          for delete to authenticated using (public.has_permission('orders','delete'));
      $f$, t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $rls$;


-- ============================================================================
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both reported success over a no-op.
--
--   -- three tables, RLS on, four policies each (expect 3 rows, 4/4/4)
--   select c.relname, c.relrowsecurity, count(p.policyname)
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--     left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
--    where c.relname like 'order_fabric_plan%'
--    group by 1, 2;
--
--   -- the loss guard is a real CHECK, not a convention (expect 1)
--   select count(*) from pg_constraint
--    where conrelid = 'public.order_fabric_plan_stages'::regclass
--      and contype = 'c' and pg_get_constraintdef(oid) like '%loss_pct%100%';
--
--   -- and it actually refuses 100 (expect an error, not a row)
--   -- insert into public.order_fabric_plan_stages (plan_id, line_id, loss_pct)
--   --   values (…, …, 100);
--
-- `report_item_movements` is deliberately UNCHANGED — see the header. No new
-- function is created, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ============================================================================
