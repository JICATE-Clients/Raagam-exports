-- ============================================================================
-- Raagam ERP — 0575 Budget ▸ Other Expenses · Other Incomes: the HEAD a line is
-- booked under, and the PERCENTAGE rate type
--
-- `doc/order/budget-purchase-rates.md` "Phase 4", client blueprints 2026-09-18:
-- Other Expenses (Cost Head · Description · Type · Rate Type Qty / Flat /
-- Percentage · UOM · Qty · Rate · Value) and Other Incomes (Income Head ·
-- Description · Percentage / Flat · Rate · Value). The blueprint's tables and
-- its SQL view are not used — one line table keyed by `source` (0428 · 0572),
-- and the view's totals are `budgetTotals`, which REFUSES where SQL would
-- part-sum.
--
--
-- THE HEADS ARE TWO `config_lookups` KINDS — NOT THE FINANCE `cost_heads`
--
-- `cost_heads` looks like the obvious home and is the wrong one, three ways:
--
--   1. ITS RLS IS GATED ON `finance`. A merchandiser building a budget holds
--      `orders` permissions; against `cost_heads` their picker would come back
--      EMPTY — not refused, empty, which reads as "nobody has set up any
--      heads" (AGENTS.md: an empty list gets believed rather than reported).
--   2. IT HAS NO INLINE ADD. A new head ("THIRD-PARTY AUDIT") would mean
--      leaving the budget for a finance screen the operator may not reach.
--      A lookup kind carries `LookupDialogPicker`'s inline Add / Modify, gated
--      on `masters` like every other picker of its shape (Packing Advice's
--      Warehouse).
--   3. IT IS A GL VOCABULARY — cost centres an accountant posts to. "Duty
--      Drawback" and "RoDTEP" are export incentives a merchandiser budgets for;
--      mixing the two lists would put ledger codes in front of the one and
--      budget words in front of the other.
--
-- So: `expense_head` and `income_head`, one column `cost_head_id →
-- config_lookups(id)`, and each tab's picker offers only its own kind. One
-- column rather than two because a line is one or the other by its `source`,
-- and a second column would be a second place for the head to disagree with it.
--
-- `order_budget_lines` has NO other FK to `config_lookups`, so no bare embed on
-- this table becomes ambiguous (asserted below; `npm run check:embeds`).
--
--
-- `rate_type` GAINS `percent`
--
-- Amount = the line scope's INR gross sales x rate / 100 — `lineAmount` in
-- lib/orders/budget/totals.ts. So a percentage is (a) at most 100: 150% of
-- sales as a commission is a typo, not a deal, and (b) in NO currency: it is a
-- share of a figure already converted to INR, and a currency on it would be a
-- conversion applied to a ratio. `chk_obl_percent` states both; the Zod schema
-- clears the currency before it gets here.
--
--
-- SEEDED WITH THE CLIENT'S OWN EXAMPLES, and nothing more — the words on the
-- blueprint (TESTING, FOB, BANK CHARGES, COMMISSION, INSPECTION / DUTY
-- DRAWBACK, RODTEP, ROSCTL). Inventing heads beside them is the
-- defaulted-vocabulary mistake AGENTS.md files under "Near misses".
-- ============================================================================


-- ---------- 1. The head ------------------------------------------------------

alter table public.order_budget_lines
  add column if not exists cost_head_id uuid references public.config_lookups(id);

create index if not exists idx_obl_cost_head on public.order_budget_lines(cost_head_id);

comment on column public.order_budget_lines.cost_head_id is
  'The Expense Head (source = expense) or Income Head (source = income) — '
  'config_lookups kinds expense_head / income_head, NOT the finance cost_heads '
  'master (finance-gated RLS, no inline add, a GL vocabulary). 0575.';


-- ---------- 2. `percent` -----------------------------------------------------

alter table public.order_budget_lines
  drop constraint if exists chk_obl_rate_type;

alter table public.order_budget_lines
  add constraint chk_obl_rate_type
  check (rate_type in ('per_unit', 'flat', 'percent'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_percent') then
    alter table public.order_budget_lines
      add constraint chk_obl_percent
      check (
        rate_type <> 'percent'
        or ((rate is null or rate <= 100) and currency_code is null)
      );
  end if;
end
$$;

comment on column public.order_budget_lines.rate_type is
  'per_unit = rate x Reqd; flat = the rate IS the charge; percent = rate % of '
  'the line scope''s INR gross sales (0575: at most 100, never in a currency). '
  '"Per KG" / "Per Piece" is per_unit with its word read off uom_id. 0573 · 0575.';


-- ---------- 3. The two kinds -------------------------------------------------
--
-- RESTATED IN FULL — the idiom 0369, 0372, 0398, 0415, 0492 and 0504 each used:
-- a CHECK is only as correct as the last migration to write it, and a kind left
-- out of a restatement makes every existing row of that kind a violation. The
-- list below is 0504's (the last rewrite in this repo — 0563 and 0564 mention
-- the constraint and deliberately do not swap it), checked value-for-value and
-- in order against the live catalog on 2026-09-18, plus the two new kinds.

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
    'fabric_stage','process_loss_for','fabric_process_type','yarn_stage',
    -- 0575: Budget ▸ Other Expenses / Other Incomes — see the header.
    'expense_head','income_head'
  ]));


-- ---------- 4. The client's own heads ----------------------------------------
--
-- `where not exists` on the kind and EITHER the code or the name, because
-- `config_lookups` carries a unique index on each (`uq_config_lookups_kind_code`,
-- `uq_config_lookups_kind_name`, both case- and space-insensitive): a head an
-- operator already added under another code must not make this seed fail, and a
-- re-run adds nothing. A renamed seed row is never overwritten (0279's idiom).
-- The code IS the name, which is what the inline Add form writes too.

insert into public.config_lookups (kind, code, name, is_active)
select v.kind, v.name, v.name, true
  from (values
    ('expense_head', 'TESTING'),
    ('expense_head', 'FOB'),
    ('expense_head', 'BANK CHARGES'),
    ('expense_head', 'COMMISSION'),
    ('expense_head', 'INSPECTION'),
    ('income_head',  'DUTY DRAWBACK'),
    ('income_head',  'RODTEP'),
    ('income_head',  'ROSCTL')
  ) as v(kind, name)
 where not exists (
   select 1 from public.config_lookups c
    where c.kind = v.kind
      and (lower(trim(c.name)) = lower(v.name) or lower(trim(c.code)) = lower(v.name))
 );


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. The
-- kind CHECK is asserted VALUE BY VALUE — all 59 — because the failure a
-- restatement risks is a kind silently dropped, which no count of rows would
-- show until someone saved one. The seed is asserted by its own question (each
-- head exists), never by a row count.
--
-- No new function, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ----------------------------------------------------------------------------

do $verify$
declare
  def text;
  v   text;
  fk  int;
begin
  perform 1
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'order_budget_lines'
     and column_name = 'cost_head_id'
     and data_type = 'uuid'
     and is_nullable = 'YES';
  if not found then
    raise exception '0575: order_budget_lines.cost_head_id is missing or not a nullable uuid';
  end if;

  -- ONE FK to config_lookups, and only one: a second would make every bare
  -- `config_lookups(...)` embed on this table a 300 (AGENTS.md).
  select count(*) into fk
    from pg_constraint
   where conrelid = 'public.order_budget_lines'::regclass
     and confrelid = 'public.config_lookups'::regclass
     and contype = 'f';
  if fk <> 1 then
    raise exception '0575: expected one FK from order_budget_lines to config_lookups, found %', fk;
  end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_rate_type';
  foreach v in array array['per_unit', 'flat', 'percent'] loop
    if def is null or def not like '%''' || v || '''%' then
      raise exception '0575: chk_obl_rate_type does not admit % (%)', v, def;
    end if;
  end loop;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_obl_percent';
  if def is null or def not like '%<= %100%' or def not like '%currency_code IS NULL%' then
    raise exception '0575: chk_obl_percent is missing or wrong (%)', def;
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'config_lookups_kind_check';
  if def is null then
    raise exception '0575: config_lookups_kind_check is missing';
  end if;
  foreach v in array array[
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
    'fabric_stage','process_loss_for','fabric_process_type','yarn_stage',
    'expense_head','income_head'
  ] loop
    if def not like '%''' || v || '''%' then
      raise exception '0575: config_lookups_kind_check no longer admits % — every row of that kind would now violate it', v;
    end if;
  end loop;

  -- No existing row may fall outside the new list (the restatement's real risk).
  if exists (
    select 1 from public.config_lookups
     where not (kind = any (array[
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
       'fabric_stage','process_loss_for','fabric_process_type','yarn_stage',
       'expense_head','income_head'
     ]))
  ) then
    raise exception '0575: a config_lookups row carries a kind the restated CHECK does not admit';
  end if;

  foreach v in array array[
    'expense_head:TESTING', 'expense_head:FOB', 'expense_head:BANK CHARGES',
    'expense_head:COMMISSION', 'expense_head:INSPECTION',
    'income_head:DUTY DRAWBACK', 'income_head:RODTEP', 'income_head:ROSCTL'
  ] loop
    if not exists (
      select 1 from public.config_lookups
       where kind = split_part(v, ':', 1)
         and (lower(trim(name)) = lower(split_part(v, ':', 2))
              or lower(trim(code)) = lower(split_part(v, ':', 2)))
    ) then
      raise exception '0575: the head % was not seeded', v;
    end if;
  end loop;
end $verify$;
