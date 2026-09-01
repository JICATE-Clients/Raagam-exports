-- ============================================================================
-- Raagam ERP — 0504 Fabric BOM ▸ Yarn Process: stages, target combos, and the
--                    compounded purchase weight
--
-- 0493 built this tab as ONE process per yarn, on the client's spec of that
-- morning. Their fuller spec (2026-09-01, second pass) restores the legacy
-- grid's own shape — screenshot 2587 — and adds arithmetic the flat version had
-- no room for:
--
--   parent   S No · Yarn                                    (one per yarn)
--   child    No · Stage · Process · For · Descriptions · Loss %
--
-- Three readings were put to the client with worked figures and confirmed before
-- any of this was written; each is recorded at the column it decides.
--
--
-- 1. THE ROWS ARE STILL DERIVED. NOTHING HERE CHANGES THAT.
--
-- "The planner cannot manually add or type new raw yarns on this screen; they
-- are strictly pulled from the active BOM." The PARENT is still one row per yarn
-- of the fabrics' compositions, read-only and un-addable. What 0504 adds is a
-- child the planner DOES fill in — and the child is where every typed value now
-- lives.
--
--
-- 2. `sno` IS THE `No` COLUMN, AND `stage_id` IS GREY / DYED
--
-- The spec's phrase is "consecutive yarn processing stages (Stage 1, Stage 2)",
-- which reads two ways: a sequence number, or a free label. Confirmed with the
-- client as the first — `sno` carries the sequence, and `Stage` carries the
-- STATE the yarn enters that step in, which is what screenshot 2587's dropdown
-- shows and what the legacy capture in `lib/planning/bom-types.ts` records:
--
--     PROCESS_STAGES_YARN   = grey, dyed
--     PROCESS_STAGES_FABRIC = grey, dyed, wash, print
--
-- Hence a `yarn_stage` kind of its OWN and not 0492's `fabric_stage`: the fabric
-- list also holds WASH and PRINT, which no yarn can be in, and one shared kind
-- would offer them here the first time somebody added one. 0493 declared this
-- kind, then dropped it when the tab flattened; it comes back unchanged.
--
--
-- 3. `combo` IS THE `For` COLUMN, AND IT DIVIDES THE WEIGHT
--
-- "The For field is used to specify which particular yarn colour or fabric combo
-- this process applies to … it only applies the dyeing process to the exact
-- weight percentage of yarn destined for that specific colour combo."
--
-- Confirmed as arithmetic rather than a label. So a yarn is weighed PER COMBO,
-- and a stage marked For = PURPLE grosses up only the purple share:
--
--     30'S COTTON, 900 kg   PURPLE 600 x 1.03 = 618.00
--                           GREEN  300  (none) = 300.00   -> purchase 918.00
--
-- **NULL MEANS EVERY COMBO**, which is the ordinary case and the only thing a
-- blank box can mean here: a yarn dyed for the whole order names no combo. It is
-- emphatically not "no combo" — a stage that applied to nothing would be a row
-- the planner filled in and the arithmetic ignored.
--
-- TEXT, BY VALUE, NOT AN FK. Every combo reference in this module is text —
-- `order_fabric_bom_lines.combo` (0426, "by VALUE (0397)"),
-- `order_fabric_bom_requirements.combo` — because a combo is free text on the
-- garment order and has no master row to point at. Matching is against the same
-- value the requirement rows carry, so the two cannot drift.
--
--
-- 4. THE LOSSES COMPOUND SEQUENTIALLY
--
-- Two stages of 3% and 2% give x 1.03 x 1.02 = 5.06%, not 5.00%. Confirmed with
-- the client against that exact pair. Each stage's loss applies to what came out
-- of the one before it, which is what "compounding" means physically and what
-- their own word says. The additive reading under-buys, always in the same
-- direction, and every individual line still looks right — the failure 0427's
-- header describes for its own formula. `scripts/check-yarn-process.mts` pins
-- 1050.60 and REFUTES 1050.00.
--
-- THE PER-STAGE FORM IS STILL THE CLIENT'S UPLIFT, `x (1 + loss/100)`, chosen
-- over 0427's backward solve with the divergence put to them (2026-09-01). Do
-- not "fix" it; see 0493's header.
--
--
-- 5. TWO STORED FIGURES, AND THE BUDGET PULLS BOTH
--
-- "These exact yarns, along with their newly calculated gross purchase weights,
-- automatically sync to populate the Yarn Purchase AND Yarn Process sections of
-- the Budget."
--
-- Two sections, two figures, so two stored columns rather than one:
--
--   * `order_fabric_bom_yarns.purchase_qty`  — the yarn's TOTAL across combos.
--     The Yarn Purchase line. Already there from 0493; its meaning is unchanged,
--     its derivation now runs through the stages.
--   * `order_fabric_bom_yarn_stages.process_qty` — the weight THIS step handles,
--     i.e. the purchase weight of the combos it applies to. The Yarn Process
--     line. A processor is quoted on what passes through their hands, and two
--     stages on one yarn are two invoices, so two lines is the correct shape
--     rather than a double count of one.
--
-- "IF A YARN HAS NO PROCESS ASSIGNED, ANY ASSOCIATED YARN PROCESSING COST FIELDS
-- ARE AUTOMATICALLY HIDDEN OR LOCKED IN THE BUDGET SHEET." Implemented as the
-- strongest form of that: a stage naming no process EMITS NO LINE. There is
-- nothing to hide because nothing is produced — a blank row costed at a typed
-- rate is exactly the phantom cost that sentence guards against.
--
-- Both figures are STORED, never projected (0418's argument, and 0426's for the
-- requirement): a yarn purchase is raised off them, so they must not move under
-- the purchaser's feet.
--
--
-- NO `location_id` on either. Children of `order_fabric_boms`, whose policies
-- narrow on `is_current_location()`. Same paragraph as 0490's.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. `yarn_stage` returns. The constraint swap RE-STATES the whole list — the
--    edit 0369, 0372, 0398, 0415 and 0492 each made. The list below is 0492's
--    (the last migration to touch it) plus `yarn_stage`.
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
    'vendor_supply_type','vendor_service_type','assortment_type','fabric_color',
    'fabric_stage','process_loss_for','fabric_process_type',
    -- 0504: a yarn's states are a SHORTER list than a fabric's — see the header.
    'yarn_stage'
  ]));

-- The two values the legacy screen shows, and not one more. `where not exists`
-- so a re-run adds nothing and a renamed value is never overwritten (0279's
-- idiom). Inventing MERCERISED or GASSED beside them is the defaulted-vocabulary
-- mistake AGENTS.md files under "Near misses".
insert into public.config_lookups (kind, code, name, is_active)
select 'yarn_stage', v.code, v.name, true
from (values
  ('grey', 'GREY'),
  ('dyed', 'DYED')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'yarn_stage' and code = v.code
);


-- ---------------------------------------------------------------------------
-- 2. The parent sheds what moved to the child.
--
-- `process_id` and `loss_pct` were 0493's one-process-per-yarn shape. DROPPED
-- rather than left nullable: two places to state a yarn's treatment is exactly
-- the drift this repo keeps recording, and a column nothing writes is one the
-- next reader will try to read.
--
-- SAFE TO DROP, and checked rather than assumed: 0493 applied hours ago and
-- `order_fabric_bom_yarns` holds no rows, because a save writes them only from
-- this tab and this tab has not shipped. Verify before re-running elsewhere:
--   select count(*) from public.order_fabric_bom_yarns;   -- expect 0
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_yarns
  drop column if exists process_id,
  drop column if exists loss_pct;

comment on column public.order_fabric_bom_yarns.purchase_qty is
  'The yarn''s TOTAL gross purchase weight across every combo — net fabric x '
  'this yarn''s blend share, each combo grossed by the SEQUENTIAL product of '
  'the stages that apply to it. The Budget''s Yarn Purchase line. Stored, never '
  'projected: a purchase is raised off it (0504).';


-- ---------------------------------------------------------------------------
-- 3. The stages.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_yarn_stages (
  id          uuid primary key default gen_random_uuid(),
  yarn_id     uuid not null
    references public.order_fabric_bom_yarns(id) on delete cascade,
  -- The `No` column: 1, 2, 3 … the order the treatments happen in. Dense and
  -- renumbered on save, which is what `uq_ofbys_yarn_sno` below relies on.
  sno         integer not null default 0,

  -- GREY / DYED — the state the yarn ENTERS this step in, not the step itself.
  stage_id    uuid references public.config_lookups(id),
  -- `public.processes` (0227), narrowed by `for_yarn` on the CLIENT so a process
  -- whose flag is later unticked still resolves on the row that holds it
  -- (AGENTS.md, Disabled rows).
  process_id  uuid references public.processes(id),

  -- The `For` column. NULL = EVERY combo — see the header; that is the ordinary
  -- case, not "no combo".
  combo       text,

  description text,

  loss_pct    numeric(6,2)
    check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),

  -- ---- the computed answer, written by the server ------------------------
  -- What this step handles: the purchase weight of the combos it applies to.
  -- The Budget's Yarn Process line.
  process_qty numeric(16,4),
  uom_id      uuid references public.uoms(id),
  refusal_reason text,

  created_at  timestamptz not null default now(),

  -- NOT `chk_ofby_answer_or_reason`'s exclusive-or, and the difference is the
  -- point: a stage naming no process is a legitimate row with NEITHER a quantity
  -- nor a refusal — the planner has recorded a step and not yet said what
  -- happens in it. What is forbidden is BOTH, which would be two answers nobody
  -- can interpret.
  constraint chk_ofbys_not_both
    check (process_qty is null or refusal_reason is null)
);

create index if not exists idx_ofbys_yarn    on public.order_fabric_bom_yarn_stages(yarn_id);
create index if not exists idx_ofbys_process on public.order_fabric_bom_yarn_stages(process_id);

-- One step per position per yarn, so a re-ordered route cannot leave two rows
-- claiming the same place. 0492's own guard, one table along.
create unique index if not exists uq_ofbys_yarn_sno
  on public.order_fabric_bom_yarn_stages(yarn_id, sno);

comment on table public.order_fabric_bom_yarn_stages is
  'Fabric BOM ▸ Yarn Process, the child grid (0504). One row per treatment one '
  'yarn runs, in order: the state it enters in, the process, the colour combo '
  'it applies to, and the loss that step costs. Losses COMPOUND sequentially '
  'into the parent''s purchase weight; process_qty is what this step handles, '
  'which the Budget pulls as a Yarn Process line.';

comment on column public.order_fabric_bom_yarn_stages.combo is
  'The `For` column — which colour combo this treatment applies to. NULL means '
  'EVERY combo, which is the ordinary case. Text by VALUE, matching '
  'order_fabric_bom_requirements.combo, because a combo is free text on the '
  'garment order and has no master row to reference (0504).';

comment on column public.order_fabric_bom_yarn_stages.loss_pct is
  'Percentage lost at this step. Compounds SEQUENTIALLY with the other stages '
  'applying to the same combo — 3 then 2 is x 1.03 x 1.02, confirmed with the '
  'client against that pair (2026-09-01). Below 100 for consistency with the '
  'module''s two other loss columns.';

comment on column public.order_fabric_bom_yarn_stages.process_qty is
  'The weight this step handles — the purchase weight of the combos it applies '
  'to. The Budget''s Yarn Process line. A step naming NO process stores nothing '
  'and emits no budget line, which is the client''s "hidden or locked" in its '
  'strongest form: nothing is produced, so there is nothing to hide.';


-- ---------------------------------------------------------------------------
-- 4. The Budget gains its fourth PULLED source.
-- ---------------------------------------------------------------------------
alter table public.order_budget_lines
  drop constraint if exists order_budget_lines_source_check;

alter table public.order_budget_lines
  add constraint order_budget_lines_source_check
  check (source in (
    'fabric','yarn','yarn_process','material','process','cmt','expense','income'
  ));

comment on column public.order_budget_lines.source is
  'fabric | yarn | yarn_process | material are PULLED (the two BOMs, and the '
  'Fabric BOM''s Yarn Process tab, which feeds two sections); process | cmt | '
  'expense | income are typed. A pulled line''s quantity is a stored '
  'requirement somebody else computed, so re-typing it would be a second answer '
  'to an answered question.';


-- ---------- RLS — the child shape, copied from 0493 which copied 0490 --------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_yarn_stages'
  ) then
    create policy order_fabric_bom_yarn_stages_read on public.order_fabric_bom_yarn_stages
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_yarn_stages_insert on public.order_fabric_bom_yarn_stages
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_yarn_stages_update on public.order_fabric_bom_yarn_stages
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_yarn_stages_delete on public.order_fabric_bom_yarn_stages
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_yarn_stages enable row level security;


-- ---------------------------------------------------------------------------
-- VERIFY (run by hand; each must return what the comment says)
--
--   -- the parent really lost its two columns (expect 0)
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'order_fabric_bom_yarns'
--      and column_name in ('process_id','loss_pct');
--
--   -- a stage may hold neither figure, but never both (expect 1)
--   select count(*) from pg_constraint
--    where conrelid = 'public.order_fabric_bom_yarn_stages'::regclass
--      and contype = 'c' and conname = 'chk_ofbys_not_both';
--
--   -- the budget takes both new sources (expect the 8-value list)
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'order_budget_lines_source_check';
--
--   -- the Stage dropdown has something in it (expect 2)
--   select count(*) from public.config_lookups where kind = 'yarn_stage';
-- ---------------------------------------------------------------------------
