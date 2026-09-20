-- ============================================================================
-- Raagam ERP — 0604 The Garment Order Amendment: a SCOPED unlock, and the
-- Amendment Entry that opens it
--
-- NUMBERED 0604, APPLIED AS 0601. It was written and applied as
-- `0601_order_amendment_scope` at 2026-09-20 15:05 IST; a PARALLEL SESSION had
-- already applied 0601 (approval_sla_escalation, 14:37), 0602
-- (factory_manager_and_escalation_flow, 14:47) and 0603
-- (approval_my_queue_is_overdue, 14:55) — whose FILES were written after this
-- one's number was chosen, so `ls supabase/migrations` showed nothing at 0601
-- when it was picked. The file is renumbered to match the real apply order and
-- the ledger's `name` was updated to agree; the ledger VERSION
-- (20260920150527) is the authority on when it ran. Every reference inside this
-- file still says 0601, deliberately — that is what the comments on the live
-- columns and functions say, and rewriting them would make the database
-- disagree with the file that wrote it.
--
-- `doc/order/amendment.md` §1–§3 and `doc/order/amendment-plan.md` Phase 1.
-- 0576 locks an approved RE No all-or-nothing; 0577 made those triggers
-- actually refuse. What the spec asks for next is narrower:
--
--   "Selecting the Amendment Type dynamically unlocks only the relevant input
--    fields on the screen (e.g. selecting Delivery Date Extension unlocks only
--    the delivery date picker, keeping price and quantity read-only)."
--
--
-- 1. THE SPEC'S SCOPE IS 0576'S ALLOWLIST WITH A BIGGER ARRAY
--
-- `refuse_when_order_locked()` already asks a per-COLUMN question — it was
-- written so the status write would not be refused by the lock it was setting:
--
--     if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then return NEW;
--
-- So "only the delivery date is editable" needs no new machinery: it is that
-- same comparison with `v_allow` widened by the amendment's own scope, plus a
-- verdict per table for INSERT and DELETE. That is why this is enforced in the
-- DATABASE and not with `readOnly` props: a UI-only scope means the lock is
-- fully OFF for the whole amendment window, and a stale tab, a second window
-- or `lib/data-io` then edits the price under a Delivery Date Extension with
-- nothing objecting. AGENTS.md's standing rule — a rule with no refusal is
-- invisible.
--
--
-- 2. A THIRD RE STATE, AND WHY THE APPROVER'S DOOR KEEPS THE OLD ONE
--
-- `re_status` gains `amending`, strictly between `open` and `approved`:
--
--   open       pre-approval flexibility (spec §1). Everything writable.
--   amending   an Amendment Entry is open. ONLY its type's scope is writable.
--   approved   the hard lock. Nothing writable but bookkeeping.
--
-- There are now TWO doors out of `approved`, and they are different acts:
--
--   open_order_amendment()   `orders:edit`     -> amending   the MERCHANDISER's
--                                                            controlled change
--   reopen_order_budget()    `orders:approve`  -> open       the APPROVER's undo
--
-- The second is 0576 §7 and is unchanged. The first is this migration, and it
-- exists because the spec's own error sentence says "Please use Garment Order
-- Amendment" while `reopen_order_budget` is gated on `orders:approve` — so the
-- merchandiser the sentence is addressed to could not open the door it names.
-- A direction naming a row the reader cannot reach is worse than no direction.
--
-- THEY SHARE ONE BODY (`order_amendment_record()`), because both write the same
-- audit record and both reopen the same budget. Two copies would drift on the
-- first change to either.
--
--
-- 3. THE ENTRY IS `order_budget_revisions`, NOT A NEW TABLE
--
-- That table (0576 §7) already holds source ('customer' | 'internal' — the
-- order module's own "By Customer" / "By Us"), amendment_type, a mandatory
-- reason, the frozen approved baseline, who and when; it is append-only (no
-- INSERT policy — an RPC is the only door) and its FK is ON DELETE RESTRICT so
-- it outlives its budget. Everything the spec's §3 A header asks for except
-- the entry number.
--
-- A NEW TABLE WOULD BE THE THIRD AMENDMENT HISTORY IN THIS MODULE. There are
-- already two that do not know about each other — `order_amendments` (0006, a
-- delta model) and `garment_order_amendments` (0126, a document model). Adding
-- a third is the failure that pair already records. So this extends it:
--
--   entry_no          AMD-0001, per financial year (`assign_order_number`'s
--                     year convention). The spec's "Amendment Entry No".
--   garment_order_id  the RE the entry is against. Set by the merchandiser's
--                     door, NULL from the approver's (which names a budget).
--   budget_id         now NULLABLE for the same reason.
--   scope             the resolved (table, columns) scope, FROZEN at open — so
--                     a later edit to the seed cannot widen an entry that is
--                     already open, and the audit record says what WAS opened.
--   outcome           open | reapproved | abandoned
--   closed_at/_by     set by close_order_amendment()
--
-- The amendment_type CHECK is WIDENED, never replaced: every row Budget ▸
-- Reopen has written since 0576 carries one of the legacy ten and must still
-- read back. Only the spec's six are offered on the new screen, and only those
-- six carry a scope.
--
--
-- 4. THE SCOPE IS A TABLE, SO THE TRIGGER AND THE SCREEN READ ONE DECLARATION
--
-- `order_amendment_scopes (amendment_type, table_name, columns, allows_insert,
-- allows_delete)`. The trigger reads it; the screen reads its TS mirror
-- (`lib/orders/amendments/amendment-entry.ts`), and `check:amendment-scope`
-- parses this file's seed and fails the build when the two disagree. Same shape
-- as `FLAGLESS_PICKERS` and the ambiguous-embed catalog: a declared table with
-- a check that keeps it honest, rather than two literals nobody syncs.
--
-- `columns = NULL` means every column of that table. A table ABSENT from a
-- type's scope refuses everything — the scope is an allowlist, never a
-- blocklist, because a blocklist silently admits every table added later.
--
-- TWO SEED RULES, both read off 0576's own excluded list:
--
--   - A QUANTITY CHANGE OPENS THE BOM TABLES TOO. A new colourway with no
--     fabric plan is an order that cannot be made, and the alternative — amend,
--     then amend again for the BOM — is two entries for one change. (Open
--     question 3 in the plan: confirm with the client.)
--   - T&A IS IN NO SCOPE, exactly as it is outside the lock. T&A is execution;
--     its life starts after approval, and freezing or opening it here would be
--     answering a question about the calendar with a rule about the plan.
--
--
-- 5. AN OUT-OF-SCOPE WRITE GETS ITS OWN SENTENCE
--
-- Telling an operator who is *inside* an amendment that the order "is locked"
-- reads as a bug — they can see the delivery date accepting keystrokes. So the
-- refusal names the type and the way on:
--
--   "This amendment is a Delivery Date Extension — Prices are not open to it.
--    Close it and raise a Price Change amendment, or change the type."
--
--
-- 6. THE HARD-LOCK SENTENCE IS THE SPEC'S NOW (plan D6)
--
-- Was: "RE 12 is locked — its budget B-3 was approved on 18/09/2026. Reopen the
-- budget (Amendment Protocol) to change it."
-- Now: "Selected budget has been approved — RE 12, approved on 18/09/2026.
-- Direct edits are disabled. Please use Garment Order Amendment."
--
-- Sentence case, because the app's voice is sentence case everywhere else and
-- the spec's Title Case is a screenshot artefact. The RE No and the date stay:
-- the operator reading this has several orders open. `orderLockMessage()`
-- (lib/orders/budget/amendment.ts) and `scripts/check-budget-amendment.mts`
-- carry the same change — three copies of one sentence, which is the cost of
-- the trigger and the toast agreeing.
--
-- NOTE FOR A FRESH DATABASE: 0577's `$verify$` asserts a refusal by matching
-- '%is locked%'. It runs BEFORE this migration, against the old wording, so it
-- still passes. Do not "fix" it to the new words — it is testing the code as it
-- stood.
--
--
-- 7. TWO COSTS, STATED RATHER THAN DISCOVERED
--
-- THE TRIGGER NOW ASKS TWO QUESTIONS PER ROW. 0576 already ran
-- `order_lock_row_order`'s FK walk plus `order_lock_of` for every row of every
-- write, and Order Entry saves by deleting and re-inserting ~20 child grids —
-- so this adds one more indexed lookup (`idx_goa_re_status_amending`) to an
-- already per-row cost, roughly doubling it. The obvious halving is one function
-- returning both the lock sentence and the open entry; it is NOT done here
-- because it would change `order_lock_of`'s signature, which
-- `lib/orders/budget/lock.ts` reads by column name. Worth doing if a save is
-- ever measured as slow — the scope check is the cheaper of the two to move.
--
-- `entry_no` IS MINTED, NOT SEQUENCED. Two amendments opened in the same instant
-- can compute the same number, and `uq_obr_entry_no` then refuses the second —
-- a refusal the operator can retry, not a duplicate they never see.
-- `order_amendment_record` takes FOR UPDATE on the budget, which serialises the
-- common case (one RE, two tabs) but not two different REs at once.
--
--
-- 8. `$verify$` IS A BEHAVIOUR PROBE, ROLLED BACK — the 0577 lesson
--
-- 0576 asserted its 47 triggers EXISTED and passed while 44 of them were
-- no-ops (TG_ARGV is zero-based). A catalog check cannot tell a guard that
-- refuses from one that returns early. So this migration's verify approves a
-- throwaway budget, opens a Delivery Date Extension, and asserts that the
-- delivery date UPDATES while a style-price write and a quantities INSERT
-- RAISE — then rolls the whole thing back.
-- ============================================================================


-- ---------- 1. The third RE state --------------------------------------------

alter table public.garment_order_amendments
  add column if not exists re_amendment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_goa_re_amendment'
  ) then
    alter table public.garment_order_amendments
      add constraint fk_goa_re_amendment
      foreign key (re_amendment_id) references public.order_budget_revisions(id)
      on delete set null;
  end if;
end
$$;

alter table public.garment_order_amendments drop constraint if exists chk_goa_re_status;
alter table public.garment_order_amendments
  add constraint chk_goa_re_status check (re_status in ('open', 'approved', 'amending'));

-- 'amending' with no entry is the one state whose scope cannot be read, and the
-- trigger would then have nothing to consult. Refused at the column.
alter table public.garment_order_amendments drop constraint if exists chk_goa_amending_has_entry;
alter table public.garment_order_amendments
  add constraint chk_goa_amending_has_entry
  check (re_status <> 'amending' or re_amendment_id is not null);

comment on column public.garment_order_amendments.re_status is
  'open | amending | approved. APPROVED = an approved budget covers this '
  'document and 0576''s triggers refuse every write to it, its RE''s other '
  'documents, its Fabric BOM and its Material BOM. AMENDING = an Amendment '
  'Entry is open (re_amendment_id) and only that entry''s type''s scope is '
  'writable (0601). OPEN = pre-approval flexibility. Writers: '
  'sync_re_status_from_budget() for approved/open, open_order_amendment() and '
  'close_order_amendment() for amending. 0576 · 0601.';
comment on column public.garment_order_amendments.re_amendment_id is
  'The open Amendment Entry (order_budget_revisions) scoping this document''s '
  'writes while re_status = amending. 0601.';

create index if not exists idx_goa_re_status_amending
  on public.garment_order_amendments(sales_order_id) where re_status = 'amending';


-- ---------- 2. The Amendment Entry (extends 0576 §7) -------------------------

alter table public.order_budget_revisions
  add column if not exists entry_no         text,
  add column if not exists garment_order_id uuid references public.garment_order_amendments(id) on delete restrict,
  add column if not exists scope            jsonb,
  add column if not exists outcome          text not null default 'open',
  add column if not exists closed_at        timestamptz,
  add column if not exists closed_by        uuid;

-- The approver's door names a BUDGET; the merchandiser's names an ORDER. One of
-- the two is always present, and requiring both would refuse the door this
-- migration exists to open.
alter table public.order_budget_revisions alter column budget_id drop not null;

alter table public.order_budget_revisions drop constraint if exists chk_obr_budget_or_order;
alter table public.order_budget_revisions
  add constraint chk_obr_budget_or_order
  check (budget_id is not null or garment_order_id is not null);

alter table public.order_budget_revisions drop constraint if exists chk_obr_outcome;
alter table public.order_budget_revisions
  add constraint chk_obr_outcome check (outcome in ('open', 'reapproved', 'abandoned'));

-- A CLOSED ENTRY HAS A DATE, AND AN OPEN ONE HAS NONE. Without this an entry
-- could read "reapproved" with no timestamp, which the list would show as a
-- closed amendment nobody can date — the same shape 0428's
-- chk_ob_decision_matches_status refuses on a budget.
alter table public.order_budget_revisions drop constraint if exists chk_obr_closed_matches_outcome;
alter table public.order_budget_revisions
  add constraint chk_obr_closed_matches_outcome
  check ((outcome = 'open') = (closed_at is null));

-- WIDENED, NOT REPLACED: the legacy ten are what Budget ▸ Reopen has written
-- since 0576 and must still read back. The six added here are the spec's own
-- list (§3 A) and are the only ones that carry a scope.
alter table public.order_budget_revisions drop constraint if exists order_budget_revisions_amendment_type_check;
alter table public.order_budget_revisions
  add constraint order_budget_revisions_amendment_type_check
  check (amendment_type in (
    -- the spec's six (0601)
    'qty_addition', 'qty_cancellation', 'price_change', 'delivery_date_ext',
    'combo_colour_change', 'bom_revision',
    -- the legacy ten (0576)
    'quantity', 'colour', 'price', 'sizes', 'delivery_date',
    'consignee', 'packing', 'style', 'internal_error', 'other'
  ));

create unique index if not exists uq_obr_entry_no
  on public.order_budget_revisions(entry_no) where entry_no is not null;

-- ONE OPEN ENTRY PER RE. Two open entries would mean two frozen scopes over one
-- order and no answer to which one the trigger should read.
create unique index if not exists uq_obr_one_open_per_order
  on public.order_budget_revisions(garment_order_id)
  where outcome = 'open' and garment_order_id is not null;

comment on table public.order_budget_revisions is
  'THE AMENDMENT ENTRY (doc/order/amendment.md §3 A). Raised two ways: by the '
  'merchandiser on Garment Order Amendment (open_order_amendment — scoped, '
  'orders:edit) or by the approver on Budget ▸ Reopen (reopen_order_budget — '
  'full unlock, orders:approve). Append-only: an RPC is the only writer. '
  '0576 · 0601.';
comment on column public.order_budget_revisions.entry_no is
  'AMD-0001, per financial year — the spec''s "Amendment Entry No". NULL on '
  'rows written before 0601. 0601.';
comment on column public.order_budget_revisions.scope is
  'The (table, columns) scope resolved from order_amendment_scopes and FROZEN '
  'at open, so editing the seed cannot widen an entry already open, and the '
  'audit record says what WAS opened. NULL = a full unlock (the approver''s '
  'door). 0601.';


-- ---------- 3. The scope vocabulary — ONE declaration ------------------------

create table if not exists public.order_amendment_scopes (
  amendment_type text not null,
  table_name     name not null,
  -- NULL = every column of this table. Named columns = only these.
  columns        text[],
  allows_insert  boolean not null default false,
  allows_delete  boolean not null default false,
  primary key (amendment_type, table_name)
);

alter table public.order_amendment_scopes drop constraint if exists chk_oas_type;
alter table public.order_amendment_scopes
  add constraint chk_oas_type check (amendment_type in (
    'qty_addition', 'qty_cancellation', 'price_change', 'delivery_date_ext',
    'combo_colour_change', 'bom_revision'
  ));

-- An EMPTY column array is not "no columns", it is a mistake — a row that
-- allows nothing and reads as a scope.
alter table public.order_amendment_scopes drop constraint if exists chk_oas_columns_not_empty;
alter table public.order_amendment_scopes
  add constraint chk_oas_columns_not_empty
  check (columns is null or array_length(columns, 1) > 0);

comment on table public.order_amendment_scopes is
  'Which tables and columns each Amendment Type opens while an order is '
  'amending (doc/order/amendment.md §3 B). Read by '
  'refuse_when_order_locked() and mirrored in '
  'lib/orders/amendments/amendment-entry.ts, which '
  'scripts/check-amendment-scope.mts holds to this seed. An allowlist: a table '
  'absent from a type refuses every write. 0601.';

alter table public.order_amendment_scopes enable row level security;

do $rls$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'order_amendment_scopes'
                    and policyname = 'order_amendment_scopes_read') then
    -- Readable by any signed-in user (the screen renders from it); written only
    -- by a migration. No write policy, deliberately: it is vocabulary, not data.
    create policy order_amendment_scopes_read on public.order_amendment_scopes
      for select to authenticated using (true);
  end if;
end
$rls$;

-- ---- the seed ---------------------------------------------------------------
-- Re-runnable: the seed is the declaration, so it REPLACES what is there rather
-- than ON CONFLICT DO NOTHING — a row left behind from an earlier shape would be
-- a scope nobody declared.
delete from public.order_amendment_scopes;

insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete) values
  -- ── Delivery Date Extension — THE SPEC'S WORKED EXAMPLE ────────────────────
  -- One field. `check:amendment-scope` asserts exactly this and nothing more:
  -- a scope that quietly grew is a scope that stopped meaning anything.
  ('delivery_date_ext', 'garment_order_amendments', array['delivery_date'], false, false),

  -- ── Price Change ──────────────────────────────────────────────────────────
  -- The parent's money scalars, plus the three price grids. Quantities are NOT
  -- here: re-pricing does not re-sell.
  ('price_change', 'garment_order_amendments',
     array['ex_rate', 'avg_rate', 'gross_value', 'currency_code',
           'cd1_pct', 'cd1_days', 'cd2_pct', 'cd2_days', 'cd3_pct', 'cd3_days'], false, false),
  ('price_change', 'garment_order_amendment_style_prices',  null, true, true),
  ('price_change', 'garment_order_amendment_price_details', null, true, true),
  ('price_change', 'garment_order_amendment_charges',       null, true, true),

  -- ── Combo / Color Change ──────────────────────────────────────────────────
  -- The colour/print/structure vocabulary of the order and the combos built on
  -- it, down the two nested levels 0576 found by walking the FKs.
  ('combo_colour_change', 'garment_order_amendment_combos',            null, true, true),
  ('combo_colour_change', 'garment_order_amendment_combo_structures',  null, true, true),
  ('combo_colour_change', 'garment_order_amendment_combo_components',  null, true, true),
  ('combo_colour_change', 'garment_order_amendment_dyeings',           null, true, true),
  ('combo_colour_change', 'garment_order_amendment_prints',            null, true, true),
  ('combo_colour_change', 'garment_order_amendment_structures',        null, true, true),
  ('combo_colour_change', 'garment_order_amendment_style_coordinates', null, true, true),
  -- A colourway is priced and counted, so the combo axis of both follows it.
  ('combo_colour_change', 'garment_order_amendment_price_details',     null, true, true),
  ('combo_colour_change', 'garment_order_amendment_approval_qtys',     null, true, true),

  -- ── BOM Revision ──────────────────────────────────────────────────────────
  -- Both BOMs entire, and NOT the order parent: revising a plan does not revise
  -- what was sold.
  ('bom_revision', 'order_fabric_boms',                      null, true, false),
  ('bom_revision', 'order_fabric_bom_dias',                  null, true, true),
  ('bom_revision', 'order_fabric_bom_lines',                 null, true, true),
  ('bom_revision', 'order_fabric_bom_manual_entries',        null, true, true),
  ('bom_revision', 'order_fabric_bom_manual_combos',         null, true, true),
  ('bom_revision', 'order_fabric_bom_manual_components',     null, true, true),
  ('bom_revision', 'order_fabric_bom_manual_sizes',          null, true, true),
  ('bom_revision', 'order_fabric_bom_process_scope',         null, true, true),
  ('bom_revision', 'order_fabric_bom_processes',             null, true, true),
  ('bom_revision', 'order_fabric_bom_requirements',          null, true, true),
  ('bom_revision', 'order_fabric_bom_yarns',                 null, true, true),
  ('bom_revision', 'order_fabric_bom_yarn_stages',           null, true, true),
  ('bom_revision', 'order_fabric_bom_yd_combinations',       null, true, true),
  ('bom_revision', 'order_fabric_bom_yd_combination_colors', null, true, true),
  ('bom_revision', 'order_fabric_bom_yd_repeats',            null, true, true),
  ('bom_revision', 'material_bom_amendments',                null, true, false),
  ('bom_revision', 'material_bom_amendment_items',           null, true, true),
  ('bom_revision', 'material_bom_amendment_item_components', null, true, true),
  ('bom_revision', 'material_bom_amendment_item_slices',     null, true, true),
  ('bom_revision', 'material_bom_amendment_processes',       null, true, true),
  ('bom_revision', 'material_bom_amendment_requirements',    null, true, true);

-- ── Quantity Addition / Quantity Cancellation ───────────────────────────────
-- PROPOSED, pending the client (plan open question 3): both quantity types open
-- the order's quantity axis AND both BOMs, because a quantity the BOMs were not
-- recomputed for is a plan for a different order — and making that a second
-- amendment means two entries for one change.
--
-- The two are seeded IDENTICALLY here, and that is the part most likely to be
-- wrong: a cancellation may not need to ADD assort lines, and may or may not
-- reopen prices (a cut quantity can cross a price break). Correcting it is
-- editing the array below, and `check:amendment-scope` will then hold the TS
-- mirror to it.
insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete)
select t.amendment_type, s.table_name, s.columns, s.allows_insert, s.allows_delete
  from (values ('qty_addition'), ('qty_cancellation')) as t(amendment_type)
 cross join (values
    ('garment_order_amendments'::name, array['excess_pct', 'gross_value'], false, false),
    ('garment_order_amendment_quantities',        null::text[], true, true),
    ('garment_order_amendment_assort_lines',      null::text[], true, true),
    ('garment_order_amendment_assort_line_sizes', null::text[], true, true),
    ('garment_order_amendment_approval_qtys',     null::text[], true, true),
    ('garment_order_amendment_country_sizes',     null::text[], true, true),
    ('garment_order_amendment_style_sizes',       null::text[], true, true),
    -- both BOMs follow the quantity
    ('order_fabric_boms',                      null::text[], true, false),
    ('order_fabric_bom_dias',                  null::text[], true, true),
    ('order_fabric_bom_lines',                 null::text[], true, true),
    ('order_fabric_bom_manual_entries',        null::text[], true, true),
    ('order_fabric_bom_manual_combos',         null::text[], true, true),
    ('order_fabric_bom_manual_components',     null::text[], true, true),
    ('order_fabric_bom_manual_sizes',          null::text[], true, true),
    ('order_fabric_bom_process_scope',         null::text[], true, true),
    ('order_fabric_bom_processes',             null::text[], true, true),
    ('order_fabric_bom_requirements',          null::text[], true, true),
    ('order_fabric_bom_yarns',                 null::text[], true, true),
    ('order_fabric_bom_yarn_stages',           null::text[], true, true),
    ('order_fabric_bom_yd_combinations',       null::text[], true, true),
    ('order_fabric_bom_yd_combination_colors', null::text[], true, true),
    ('order_fabric_bom_yd_repeats',            null::text[], true, true),
    ('material_bom_amendments',                null::text[], true, false),
    ('material_bom_amendment_items',           null::text[], true, true),
    ('material_bom_amendment_item_components', null::text[], true, true),
    ('material_bom_amendment_item_slices',     null::text[], true, true),
    ('material_bom_amendment_processes',       null::text[], true, true),
    ('material_bom_amendment_requirements',    null::text[], true, true)
  ) as s(table_name, columns, allows_insert, allows_delete);


-- ---- CLOSED TO EVERY TYPE, enumerated not accidental ------------------------
-- Seven of 0576's 47 locked tables appear in no scope above, so no amendment can
-- write them: the order's own approved shape in those respects is final until
-- the APPROVER reopens the budget (which returns the RE to `open`). Measured
-- against the live catalog on 2026-09-20, and asserted in $verify$ below — so a
-- later migration that scopes one of them has to edit the list, which is the
-- acknowledgement.
--
--   garment_order_amendment_styles            THE SPEC'S SIX TYPES DO NOT INCLUDE
--     A STYLE CHANGE. Adding a style to an approved order is a new order, not an
--     amendment of this one, and "Quantity Addition" means more pieces of what
--     was sold.
--   garment_order_amendment_style_components  }  the style's construction.
--   garment_order_amendment_style_processes   }  See the note in the plan's open
--                                                question 5 — a "Specification /
--     Consumption Revision" (spec §2) arguably belongs to `bom_revision`, and
--     the client has not been asked. Closed until they are: a wrongly-OPEN scope
--     admits a change nobody approved, a wrongly-closed one only refuses.
--   garment_order_amendment_pack_types        }  PACKING. The legacy ten had a
--   garment_order_amendment_pack_type_lines   }  `packing` type; the spec's six
--   garment_order_amendment_pack_components   }  do not, so packing is not an
--     amendable axis today. Re-packing does not move the margin the lock
--     protects, so this costs the approval nothing.
--   garment_order_amendment_files             ATTACHMENTS. A tech pack added
--     after approval documents the order, it does not change it — but it is
--     locked by 0576 and so is closed here too rather than opened by a guess.
--     The first client report of "I cannot attach the revised sketch" is what
--     should open it, on its own evidence.


-- ---------- 4. What "amending" means — the sibling of order_lock_of ----------

-- THE SAME GRAIN AS THE LOCK (0576 §2): this document, or any document of the
-- same RE No. An amendment raised beside an approved order is one RE, and a
-- scope that stopped at the document would leave the sibling fully writable.
create or replace function public.order_amendment_of(p_order uuid, p_sales_order uuid default null)
returns table (
  amending_order_id uuid,
  entry_id          uuid,
  entry_no          text,
  amendment_type    text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id, r.id, r.entry_no, r.amendment_type
    from public.garment_order_amendments a
    cross join me
    join public.order_budget_revisions r on r.id = a.re_amendment_id
   where a.re_status = 'amending'
     and (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc
   limit 1;
$$;

comment on function public.order_amendment_of(uuid, uuid) is
  'The open Amendment Entry scoping this order''s RE No — no row when none is '
  'open. Sibling of order_lock_of() and the same grain: this document or any '
  'document of the same RE. 0601.';

/**
 * Why a write is refused while an order is AMENDING — NULL to allow.
 *
 * `p_changed` is the columns an UPDATE actually changed, bookkeeping already
 * removed; NULL for an INSERT or DELETE, where the verdict is the table's
 * allows_insert / allows_delete.
 *
 * ONE FUNCTION, TWO READERS: the trigger below, and the screen through
 * `order_amendment_scope_of()`. A second copy of this rule in TypeScript could
 * wave through a write the database then refuses, or cage a field the database
 * would have accepted — the failure `lib/orders/budget/lock.ts` records for the
 * hard lock.
 */
create or replace function public.order_amendment_refusal(
  p_entry_no       text,
  p_amendment_type text,
  p_table          name,
  p_op             text,
  p_changed        text[]
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cols    text[];
  v_ins     boolean;
  v_del     boolean;
  v_found   boolean;
  v_outside text[];
  v_head    text;
begin
  v_head := 'This amendment (' || coalesce(nullif(btrim(p_entry_no), ''), 'open') || ') is a '
            || public.order_amendment_type_label(p_amendment_type) || ' — ';

  select s.columns, s.allows_insert, s.allows_delete, true
    into v_cols, v_ins, v_del, v_found
    from public.order_amendment_scopes s
   where s.amendment_type = p_amendment_type
     and s.table_name = p_table;

  -- AN ALLOWLIST, NOT A BLOCKLIST. A table nobody named is refused, so a table
  -- added by a later migration is closed until its scope row says otherwise.
  if not coalesce(v_found, false) then
    return v_head || public.order_amendment_area_label(p_table)
           || ' is not open to it. Close it and raise the right kind of amendment, or change the type.';
  end if;

  if p_op = 'INSERT' then
    if v_ins then return null; end if;
    return v_head || 'a new ' || public.order_amendment_area_label(p_table)
           || ' row cannot be added under it.';
  elsif p_op = 'DELETE' then
    if v_del then return null; end if;
    return v_head || 'a ' || public.order_amendment_area_label(p_table)
           || ' row cannot be removed under it.';
  end if;

  -- UPDATE. NULL columns = the whole table is open.
  if v_cols is null then return null; end if;
  select array_agg(c order by c) into v_outside
    from unnest(coalesce(p_changed, array[]::text[])) c
   where not (c = any(v_cols));
  if v_outside is null then return null; end if;

  return v_head || array_to_string(v_outside, ', ')
         || case when array_length(v_outside, 1) = 1 then ' is' else ' are' end
         || ' not open to it. Only ' || array_to_string(v_cols, ', ')
         || ' can be changed on ' || public.order_amendment_area_label(p_table) || '.';
end;
$$;

-- The operator's words for a type and a table. Kept beside the refusal so the
-- sentence never shows a column name where a screen shows a label; the TS
-- mirror carries the same two maps.
create or replace function public.order_amendment_type_label(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'qty_addition'        then 'Quantity Addition'
    when 'qty_cancellation'    then 'Quantity Cancellation'
    when 'price_change'        then 'Price Change'
    when 'delivery_date_ext'   then 'Delivery Date Extension'
    when 'combo_colour_change' then 'Combo / Color Change'
    when 'bom_revision'        then 'BOM Revision'
    else coalesce(nullif(btrim(p_type), ''), 'an amendment')
  end;
$$;

-- ORDER MATTERS: the specific `style_*` branches come before the bare
-- `..._styles`, and `..._styles` before nothing at all. The fall-through
-- 'that section' is what an out-of-scope refusal reads like when a table was
-- added and nobody labelled it — vague, which is why every locked table has a
-- branch today and the $verify$ below keeps the set enumerated.
create or replace function public.order_amendment_area_label(p_table name)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table = 'garment_order_amendments'                     then 'the order header'
    when p_table = 'garment_order_amendment_styles'                then 'Style(s)'
    when p_table like 'garment_order_amendment_style_price%'       then 'Prices'
    when p_table like 'garment_order_amendment_style_component%'   then 'Style Components'
    when p_table like 'garment_order_amendment_style_coordinate%'  then 'Style Components'
    when p_table like 'garment_order_amendment_style_process%'     then 'Style Processes'
    when p_table like 'garment_order_amendment_style_size%'        then 'Sizes'
    when p_table like 'garment_order_amendment_price_detail%'      then 'Price Details'
    when p_table like 'garment_order_amendment_charge%'            then 'Logistic charges'
    when p_table like 'garment_order_amendment_quantit%'           then 'Quantities'
    when p_table like 'garment_order_amendment_assort%'            then 'Assortment'
    when p_table like 'garment_order_amendment_approval_qty%'      then 'Approval Qty'
    when p_table like 'garment_order_amendment_combo%'             then 'Combos'
    when p_table like 'garment_order_amendment_dyeing%'            then 'Colour / Print Details'
    when p_table like 'garment_order_amendment_print%'             then 'Colour / Print Details'
    when p_table like 'garment_order_amendment_structure%'         then 'Structures'
    when p_table like 'garment_order_amendment_country_size%'      then 'Country / Sizewise'
    when p_table like 'garment_order_amendment_pack%'              then 'Pack type(s)'
    when p_table like 'garment_order_amendment_file%'              then 'Attachments'
    when p_table like 'order_fabric_bom%'                          then 'the Fabric BOM'
    when p_table like 'material_bom_amendment%'                    then 'the Material BOM'
    else 'that section'
  end;
$$;

/**
 * What the SCREEN asks: the frozen scope of the entry open over this order, or
 * no row. Read at page load and handed down as the `open` set `UnlockScope`
 * reads — so the fields the operator sees as editable are the fields the
 * trigger will accept, from the same answer.
 */
create or replace function public.order_amendment_scope_of(p_order uuid)
returns table (
  entry_id       uuid,
  entry_no       text,
  amendment_type text,
  scope          jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.entry_id, m.entry_no, m.amendment_type, r.scope
    from public.order_amendment_of(p_order) m
    join public.order_budget_revisions r on r.id = m.entry_id;
$$;


-- ---------- 5. The lock trigger reads the scope -------------------------------

create or replace function public.refuse_when_order_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- (0576 §4) Bookkeeping that must pass the lock, + 0601's re_amendment_id:
  -- without it, open_order_amendment's own status write would be refused by the
  -- lock it is lifting.
  v_allow constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason', 'updated_at'
  ];
  v_rows    jsonb[];
  v_row     jsonb;
  v_msg     text;
  v_order   uuid;
  v_so      uuid;
  v_changed text[];
  v_am      record;
begin
  if TG_OP = 'UPDATE' then
    if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then
      return NEW;
    end if;
    -- WHICH columns moved — the scope's question. Bookkeeping is excluded here
    -- for the same reason it is excluded above.
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(to_jsonb(NEW)) as k
     where not (k = any(v_allow))
       and (to_jsonb(NEW) -> k) is distinct from (to_jsonb(OLD) -> k);
    -- BOTH sides: a row moved OFF a locked order is a change to it, and a row
    -- moved ONTO one is too.
    v_rows := array[to_jsonb(OLD), to_jsonb(NEW)];
  elsif TG_OP = 'INSERT' then
    v_rows := array[to_jsonb(NEW)];
  else
    v_rows := array[to_jsonb(OLD)];
  end if;

  foreach v_row in array v_rows loop
    if TG_TABLE_NAME = 'garment_order_amendments' then
      -- The document itself: its own id, and its RE — an INSERT has no row to
      -- look the RE up from yet, so it is read off the new row.
      v_order := (v_row ->> 'id')::uuid;
      v_so    := (v_row ->> 'sales_order_id')::uuid;
    else
      v_order := public.order_lock_row_order(v_row, TG_ARGV);
      v_so    := null;
    end if;

    -- 1. THE HARD LOCK FIRST. An approved RE refuses everything; an amendment
    --    cannot be open on one (open_order_amendment moves it off 'approved').
    v_msg := public.order_lock_message(v_order, v_so);
    if v_msg is not null then
      raise exception using message = v_msg, errcode = 'P0001', hint = 'order_locked';
    end if;

    -- 2. THEN THE SCOPE. No open entry = nothing to narrow, so an `open` order
    --    passes exactly as it did before 0601.
    select * into v_am from public.order_amendment_of(v_order, v_so);
    if v_am.entry_id is not null then
      v_msg := public.order_amendment_refusal(
        v_am.entry_no, v_am.amendment_type, TG_TABLE_NAME, TG_OP, v_changed
      );
      if v_msg is not null then
        raise exception using message = v_msg, errcode = 'P0001', hint = 'order_out_of_amendment_scope';
      end if;
    end if;
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;


-- ---------- 6. The hard-lock sentence is the spec's (plan D6) ----------------

create or replace function public.order_lock_message(p_order uuid, p_sales_order uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select
    'Selected budget has been approved'
    || case when nullif(btrim(l.re_no), '') is not null
            then ' — RE ' || btrim(l.re_no) else '' end
    || case when nullif(btrim(l.budget_code), '') is not null
            then case when nullif(btrim(l.re_no), '') is not null then ', ' else ' — ' end
                 || 'budget ' || btrim(l.budget_code)
            else '' end
    || case when l.approved_at is not null
            then case when nullif(btrim(l.re_no), '') is not null
                        or nullif(btrim(l.budget_code), '') is not null
                      then ', ' else ' — ' end
                 || 'approved on ' || to_char(l.approved_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY')
            else '' end
    || '. Direct edits are disabled. Please use Garment Order Amendment.'
  from public.order_lock_of(p_order, p_sales_order) l;
$$;

comment on function public.order_lock_message(uuid, uuid) is
  'Why a hard-locked order refuses a write — the spec''s sentence '
  '(doc/order/amendment.md §1), with the RE No, budget code and IST approval '
  'date it can name. orderLockMessage() in lib/orders/budget/amendment.ts is '
  'the same words, and scripts/check-budget-amendment.mts pins them. '
  '0576 · 0601.';


-- ---------- 7. The two doors, sharing one body -------------------------------

/**
 * Mint AMD-0001. Per FINANCIAL year (April–March), the convention the RE No
 * already uses — an amendment is filed against a year's orders, and a number
 * that runs for ever tells the reader nothing about when.
 */
create or replace function public.next_order_amendment_no()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with fy as (
    select case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
                then extract(year from (now() at time zone 'Asia/Kolkata'))::int
                else extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1
           end as y
  )
  select 'AMD/' || to_char(fy.y % 100, 'FM00') || '-' || to_char((fy.y + 1) % 100, 'FM00')
         || '/' || to_char(coalesce(max(substring(r.entry_no from '(\d+)$')::int), 0) + 1, 'FM0000')
    from fy
    left join public.order_budget_revisions r
      on r.entry_no like 'AMD/' || to_char(fy.y % 100, 'FM00') || '-'
                                || to_char((fy.y + 1) % 100, 'FM00') || '/%'
   group by fy.y;
$$;

/**
 * THE SHARED BODY of both doors: write the entry, freeze the baseline and the
 * scope, and send the budget back to draft.
 *
 * ONE TRANSACTION, because the alternative is a revision with no reopen or a
 * reopen with no revision — 0576 §7's own reason for being one RPC. It does NOT
 * check a permission: each door checks its own, and a shared body that guessed
 * would be a third opinion on who may do what.
 *
 * Returns the entry id.
 */
create or replace function public.order_amendment_record(
  p_budget_id uuid,
  p_order_id  uuid,
  p_source    text,
  p_type      text,
  p_reason    text,
  p_baseline  jsonb,
  p_scoped    boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_by     uuid;
  v_at     timestamptz;
  v_no     int;
  v_entry  uuid;
  v_scope  jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using message = 'Say why this order is being amended', errcode = '22023';
  end if;
  if p_baseline is null then
    raise exception using message = 'The approved baseline is missing — nothing was amended', errcode = '22023';
  end if;

  -- FOR UPDATE: two operators amending at once get one entry, not two.
  select b.status, b.decided_by, b.decided_at
    into v_status, v_by, v_at
    from public.order_budgets b
   where b.id = p_budget_id
     for update;
  if not found then
    raise exception using message = 'That budget no longer exists', errcode = 'P0002';
  end if;
  -- IDEMPOTENT BY REFUSAL: a second click finds it already reopened.
  if v_status <> 'approved' then
    raise exception using
      message = format('Only an approved budget can be amended — this one is %s', v_status),
      errcode = 'P0001';
  end if;

  -- THE SCOPE IS FROZEN HERE, so editing the seed later cannot widen an entry
  -- that is already open, and the audit record says what WAS opened.
  if p_scoped then
    select jsonb_object_agg(
             s.table_name,
             jsonb_build_object('columns', s.columns,
                                'insert', s.allows_insert,
                                'delete', s.allows_delete))
      into v_scope
      from public.order_amendment_scopes s
     where s.amendment_type = p_type;
    if v_scope is null then
      raise exception using
        message = format('%s has no field scope declared — it cannot be raised', public.order_amendment_type_label(p_type)),
        errcode = '22023';
    end if;
  end if;

  select coalesce(max(r.revision_no), 0) + 1 into v_no
    from public.order_budget_revisions r
   where r.budget_id = p_budget_id;

  insert into public.order_budget_revisions (
    budget_id, garment_order_id, revision_no, entry_no, source, amendment_type,
    reason, baseline, scope, baseline_approved_by, baseline_approved_at, reopened_by
  ) values (
    p_budget_id, p_order_id, v_no, public.next_order_amendment_no(),
    p_source, p_type, btrim(p_reason), p_baseline, v_scope, v_by, v_at, auth.uid()
  ) returning id into v_entry;

  return v_entry;
end;
$$;

/**
 * THE MERCHANDISER'S DOOR (doc/order/amendment.md §2–§3). `orders:edit`.
 *
 * One transaction: the entry, the frozen baseline and scope, the RE moved to
 * `amending`, and the budget sent back to draft for its fresh approval cycle
 * (§4). The order of the last two matters and is not an accident —
 * `re_status` is set to `amending` BEFORE the budget moves, because
 * `sync_re_status_from_budget()` only touches documents still reading
 * `approved`. Reversed, the budget's own trigger would unlock the RE
 * completely and the scope would be a comment.
 */
create or replace function public.open_order_amendment(
  p_order    uuid,
  p_source   text,
  p_type     text,
  p_reason   text,
  p_baseline jsonb
)
returns table (entry_id uuid, entry_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so     uuid;
  v_budget uuid;
  v_status text;
  v_open   text;
  v_entry  uuid;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to amend an order', errcode = '42501';
  end if;

  select a.sales_order_id, a.re_status into v_so, v_status
    from public.garment_order_amendments a where a.id = p_order;
  if not found then
    raise exception using message = 'That order no longer exists', errcode = 'P0002';
  end if;

  -- AN AMENDMENT IS FOR AN APPROVED ORDER. An `open` one needs none — the
  -- operator edits it directly (spec §1, "Pre-Approval Flexibility") — and
  -- saying so is better than opening an entry that unlocks nothing new.
  if v_status = 'amending' then
    select r.entry_no into v_open
      from public.order_budget_revisions r
      join public.garment_order_amendments a on a.re_amendment_id = r.id
     where a.id = p_order;
    raise exception using
      message = format('Amendment %s is already open on this order — close it first', coalesce(v_open, '')),
      errcode = 'P0001';
  elsif v_status <> 'approved' then
    raise exception using
      message = 'This order is not approved, so it needs no amendment — edit it directly',
      errcode = 'P0001';
  end if;

  -- The approved budget over this RE. `order_lock_of` is the ONE definition of
  -- which one that is; re-deriving it here could name a different budget from
  -- the one the lock is about.
  select l.budget_id into v_budget from public.order_lock_of(p_order, v_so) l;
  if v_budget is null then
    raise exception using
      message = 'This order is locked but its approved budget cannot be read — nothing was amended',
      errcode = 'P0001';
  end if;

  v_entry := public.order_amendment_record(
    v_budget, p_order, p_source, p_type, p_reason, p_baseline, true
  );

  -- 1. THE RE FIRST (see the doc comment above).
  update public.garment_order_amendments a
     set re_status = 'amending', re_status_at = now(), re_amendment_id = v_entry
   where (a.id = p_order or (v_so is not null and a.sales_order_id = v_so))
     and a.re_status = 'approved';

  -- 2. THEN THE BUDGET — back to draft, the decision cleared
  --    (chk_ob_decision_matches_status, 0428).
  update public.order_budgets
     set status = 'draft', decided_at = null, decided_by = null
   where id = v_budget;

  return query
    select r.id, r.entry_no from public.order_budget_revisions r where r.id = v_entry;
end;
$$;

/**
 * Close an entry — re-approved, or abandoned.
 *
 * `reapproved` is called from `approval_apply_terminal()` (0505) when the
 * revised budget is approved, IN THE TRIGGER rather than the action bar, for
 * 0504's own reason: a callback covers the happy path and strands the two cases
 * nobody watches (`approval_cancel`, and any sweeper running as service_role).
 *
 * Either way the RE goes back to `approved` if a budget covers it, and to
 * `open` if none does — read off `sync_re_status_from_budget()`'s own question
 * rather than assumed, because abandoning an amendment whose budget was
 * meanwhile reopened must not re-lock an order with nothing approving it.
 */
create or replace function public.close_order_amendment(p_entry uuid, p_outcome text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_n     int;
begin
  if p_outcome not in ('reapproved', 'abandoned') then
    raise exception using message = format('Unknown amendment outcome %s', p_outcome), errcode = '22023';
  end if;

  select r.garment_order_id into v_order
    from public.order_budget_revisions r
   where r.id = p_entry and r.outcome = 'open';
  if not found then
    -- Not an error: a second decision, or the approver's door (which opens no
    -- scope) reaching this by a shared path.
    return 0;
  end if;
  update public.order_budget_revisions
     set outcome = p_outcome, closed_at = now(), closed_by = auth.uid()
   where id = p_entry;

  with covered as (
    select a.id,
           exists (
             select 1 from public.order_budget_orders o
               join public.order_budgets b on b.id = o.budget_id
              where o.garment_order_id = a.id and b.status = 'approved'
           ) as has_approved
      from public.garment_order_amendments a
     where a.re_amendment_id = p_entry
  )
  update public.garment_order_amendments a
     set re_status = case when c.has_approved then 'approved' else 'open' end,
         re_status_at = now(),
         re_amendment_id = null
    from covered c
   where a.id = c.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---------- 8. Grants — BOTH halves, in one statement -------------------------
-- 0383's bug: `revoke … from public` alone left creator_names() an
-- unauthenticated name oracle until 0385, because Supabase's `anon=X/owner` is
-- a SEPARATE direct grant from Postgres's built-in EXECUTE TO PUBLIC.

revoke all on function public.order_amendment_of(uuid, uuid) from public, anon;
revoke all on function public.order_amendment_scope_of(uuid) from public, anon;
revoke all on function public.order_amendment_refusal(text, text, name, text, text[]) from public, anon;
revoke all on function public.order_amendment_type_label(text) from public, anon;
revoke all on function public.order_amendment_area_label(name) from public, anon;
revoke all on function public.next_order_amendment_no() from public, anon;
revoke all on function public.open_order_amendment(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.close_order_amendment(uuid, text) from public, anon;
revoke all on function public.order_lock_message(uuid, uuid) from public, anon;

-- INTERNAL: the shared body takes the budget id and checks no permission, so it
-- is not a door. Only the two wrappers and the 0505 trigger may call it.
revoke all on function public.order_amendment_record(uuid, uuid, text, text, text, jsonb, boolean)
  from public, anon, authenticated;

-- The app calls these.
grant execute on function public.order_amendment_of(uuid, uuid) to authenticated;
grant execute on function public.order_amendment_scope_of(uuid) to authenticated;
grant execute on function public.order_amendment_type_label(text) to authenticated;
grant execute on function public.order_amendment_area_label(name) to authenticated;
grant execute on function public.order_amendment_refusal(text, text, name, text, text[]) to authenticated;
grant execute on function public.next_order_amendment_no() to authenticated;
grant execute on function public.open_order_amendment(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.close_order_amendment(uuid, text) to authenticated;
grant execute on function public.order_lock_message(uuid, uuid) to authenticated;


-- ============================================================================
-- $verify$ — A BEHAVIOUR PROBE, ROLLED BACK.
--
-- THE 0577 LESSON (raagam-tg-argv-zero-based): 0576's own $verify$ asserted its
-- 47 triggers EXISTED and passed while 44 of them locked nothing, because
-- TG_ARGV is zero-based. A catalog check cannot tell a guard that refuses from
-- one that returns early. So this one makes the writes and reads the answers.
--
-- Everything it does is undone: the inner block always ends by raising a
-- sentinel, which rolls back to its savepoint, and only then are the collected
-- results judged.
-- ============================================================================

do $verify$
declare
  x        uuid;
  st       uuid;
  loc      uuid;
  b        uuid;
  e        uuid;
  r_locked text := 'not run';
  r_date   text := 'not run';
  r_price  text := 'not run';
  r_qty    text := 'not run';
  r_closed text := 'not run';
  n        int;
begin
  -- ---- structure, cheap and first ------------------------------------------
  if not exists (select 1 from pg_constraint where conname = 'chk_goa_re_status'
                   and pg_get_constraintdef(oid) like '%amending%') then
    raise exception '0601: chk_goa_re_status does not admit amending';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_goa_amending_has_entry') then
    raise exception '0601: an amending order is not required to name its entry';
  end if;
  if to_regclass('public.order_amendment_scopes') is null then
    raise exception '0601: order_amendment_scopes was not created';
  end if;

  -- THE SPEC'S WORKED EXAMPLE, asserted exactly: Delivery Date Extension opens
  -- one column of one table. A scope that quietly grew is a scope that stopped
  -- meaning anything.
  select count(*) into n from public.order_amendment_scopes where amendment_type = 'delivery_date_ext';
  if n <> 1 then
    raise exception '0601: delivery_date_ext names % tables, not 1', n;
  end if;
  if not exists (
    select 1 from public.order_amendment_scopes
     where amendment_type = 'delivery_date_ext'
       and table_name = 'garment_order_amendments'
       and columns = array['delivery_date']
       and not allows_insert and not allows_delete
  ) then
    raise exception '0601: delivery_date_ext does not open exactly garment_order_amendments.delivery_date';
  end if;

  -- T&A IS IN NO SCOPE — it is execution, as it is outside the lock.
  --
  -- `strpos`, NOT `like '%_ta_%'`: `_` is a LIKE WILDCARD, so that pattern means
  -- "contains ta with any character either side" and matched
  -- order_fabric_bom_yarn_STAges. This assertion failed the first time 0601 was
  -- applied, on a scope row that was entirely correct — which is the assertion
  -- doing its job in the one way that is easy to misread as the seed being
  -- wrong. 0576's own version of this check anchors the prefix
  -- (`like 'garment_order_amendment_ta_%'`) and so never saw it.
  if exists (
    select 1 from public.order_amendment_scopes
     where strpos(table_name::text, '_ta_') > 0
  ) then
    raise exception '0601: a T&A table carries an amendment scope — T&A is execution, not plan';
  end if;

  -- EVERY SCOPED TABLE IS ONE 0576 ACTUALLY LOCKS. A scope row for an unguarded
  -- table is the worst shape available: it reads as a considered permission while
  -- protecting nothing, and nothing else in the repo would notice.
  if exists (
    select 1 from public.order_amendment_scopes s
     where not exists (
       select 1 from pg_trigger g
        where g.tgrelid = ('public.' || s.table_name)::regclass
          and g.tgname = 'trg_order_lock')
  ) then
    raise exception '0601: a scope names a table that carries no trg_order_lock — it would protect nothing';
  end if;

  -- CLOSED TO EVERY TYPE — the enumeration above, held to. If a later migration
  -- scopes one of these, it edits this list too, and that edit is the record of
  -- the decision.
  if exists (
    select c.relname::text t
      from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where g.tgname = 'trg_order_lock' and n.nspname = 'public'
       and c.relname::text not in (select table_name::text from public.order_amendment_scopes)
       and c.relname::text not in (
         'garment_order_amendment_styles', 'garment_order_amendment_style_components',
         'garment_order_amendment_style_processes', 'garment_order_amendment_pack_types',
         'garment_order_amendment_pack_type_lines', 'garment_order_amendment_pack_components',
         'garment_order_amendment_files')
  ) then
    raise exception '0601: a locked table is in no scope and is not in the declared closed list — enumerate it';
  end if;

  -- EVERY LOCKED TABLE HAS A LABEL. An out-of-scope refusal naming "that
  -- section" tells the operator nothing, and it is the shape a newly-locked
  -- table arrives in.
  if exists (
    select c.relname::name t
      from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where g.tgname = 'trg_order_lock' and n.nspname = 'public'
       and public.order_amendment_area_label(c.relname::name) = 'that section'
  ) then
    raise exception '0601: a locked table has no operator-facing label — its refusal would say "that section"';
  end if;

  -- Every type offered must carry a scope, or open_order_amendment refuses it
  -- and the screen offers a door that cannot open.
  if exists (
    select t from unnest(array['qty_addition', 'qty_cancellation', 'price_change',
                               'delivery_date_ext', 'combo_colour_change', 'bom_revision']) t
     where not exists (select 1 from public.order_amendment_scopes s where s.amendment_type = t)
  ) then
    raise exception '0601: an offered amendment type has no scope rows';
  end if;

  -- The new sentence, in the words the TS half must match.
  if public.order_lock_message(gen_random_uuid()) is not null then
    raise exception '0601: order_lock_message answered for an order that is not locked';
  end if;

  -- ---- behaviour, on a real order — skipped on an empty database ------------
  select a.id into x from public.garment_order_amendments a
   where exists (select 1 from public.garment_order_amendment_styles s where s.amendment_id = a.id)
     and a.re_status = 'open'
     and a.delivery_date is not null
   limit 1;
  select id into loc from public.locations limit 1;
  if x is null or loc is null then
    raise notice '0601: no open order with styles — behaviour probe skipped';
    return;
  end if;
  select s.id into st from public.garment_order_amendment_styles s where s.amendment_id = x limit 1;

  begin
    insert into public.order_budgets (budget_date, status, location_id)
    values (current_date, 'draft', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal)
    values (b, x, '0601 verify');
    update public.order_budgets
       set status = 'approved', decided_at = now(), decided_by = gen_random_uuid()
     where id = b;

    -- 1. APPROVED refuses, with the spec's sentence.
    begin
      update public.garment_order_amendments set po_no = coalesce(po_no, '') || ' 0601' where id = x;
      r_locked := 'NOT refused';
    exception when others then
      r_locked := case when sqlerrm like '%Selected budget has been approved%'
                         and sqlerrm like '%Please use Garment Order Amendment%'
                       then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    -- 2. Open a Delivery Date Extension. `has_permission` is not readable in a
    --    migration (no auth.uid()), so the entry is written through the shared
    --    body and the status moved the way open_order_amendment does — the same
    --    two writes, in the same order, without the permission gate.
    e := public.order_amendment_record(b, x, 'customer', 'delivery_date_ext',
                                      '0601 verify', '{"v":1}'::jsonb, true);
    update public.garment_order_amendments a
       set re_status = 'amending', re_status_at = now(), re_amendment_id = e
     where a.id = x and a.re_status = 'approved';
    update public.order_budgets set status = 'draft', decided_at = null, decided_by = null where id = b;

    -- 3. The delivery date IS open.
    begin
      update public.garment_order_amendments
         set delivery_date = delivery_date + 1 where id = x;
      r_date := 'allowed';
    exception when others then
      r_date := 'refused: ' || sqlerrm;
    end;

    -- 4. A price row is NOT — and the refusal names the type.
    begin
      update public.garment_order_amendment_styles
         set description = coalesce(description, '') || ' 0601' where id = st;
      r_price := 'NOT refused';
    exception when others then
      r_price := case when sqlerrm like '%Delivery Date Extension%'
                      then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    -- 5. An INSERT into a table outside the scope is refused too — a scope that
    --    only guarded UPDATE would let a whole new grid row in.
    begin
      insert into public.garment_order_amendment_quantities (amendment_id, sno)
      values (x, 9901);
      r_qty := 'NOT refused';
    exception when others then
      r_qty := case when sqlerrm like '%Delivery Date Extension%'
                    then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    -- 6. Closing re-locks: the budget is draft now, so the RE goes back to open
    --    and the header is writable again.
    perform public.close_order_amendment(e, 'abandoned');
    begin
      update public.garment_order_amendments set po_no = coalesce(po_no, '') || ' 0601b' where id = x;
      r_closed := 'allowed';
    exception when others then
      r_closed := 'refused: ' || sqlerrm;
    end;

    raise exception '0601_ROLLBACK';
  exception when others then
    if sqlerrm <> '0601_ROLLBACK' then
      raise;
    end if;
  end;

  if r_locked <> 'refused' then
    raise exception '0601: an approved RE''s header write was % (expected the spec''s sentence)', r_locked;
  end if;
  if r_date <> 'allowed' then
    raise exception '0601: a Delivery Date Extension did not open delivery_date — %', r_date;
  end if;
  if r_price <> 'refused' then
    raise exception '0601: a style row was % under a Delivery Date Extension', r_price;
  end if;
  if r_qty <> 'refused' then
    raise exception '0601: a Quantities INSERT was % under a Delivery Date Extension', r_qty;
  end if;
  if r_closed <> 'allowed' then
    raise exception '0601: closing the amendment did not release the order — %', r_closed;
  end if;
end $verify$;
