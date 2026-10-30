-- Raagam ERP — 0771 Budget ▸ CMTs ▸ Breakup: operations from the CMT master
--
-- Client 2026-10-30 (screenshots 3870 + "CMT OPERATIONS ₹ / piece"): "CMT
-- breakup connect with master like costing operation … same, duplicate it in
-- budget breakup". The breakup was five FIXED boxes (0574: Cutting · Sewing /
-- Making · Checking · Ironing · Packing). The Sample Costing's CMT table is a
-- LIST: Operation picked from Master Data ▸ Materials ▸ CMT Processes (0735)
-- and a Rate per piece, as many lines as the style needs. The budget's
-- breakup now has the same shape.
--
-- ONE JSONB COLUMN, NOT A CHILD TABLE
--
-- Budget lines are saved by delete-and-reinsert (updateOrderBudget), and an
-- order revision's Reject restores them from `budget_snapshot` as whole rows.
-- A column rides through both untouched; a child table would need its own
-- save, its own RLS + `lv_*` unit predicate, and its own place in the revert.
-- The breakup only EXPLAINS the rate — nothing joins on an operation — so the
-- list is held on the line it explains:
--
--   cmt_ops = [{ "cmt_process_id": uuid, "name": text, "rate": number }, …]
--
-- `name` is stored beside the id so a report prints the operation even after
-- the master row is renamed or switched off.
--
-- THE RATE AND ITS BREAKUP STILL CANNOT DISAGREE — `chk_obl_cmt_ops`
--
-- 0574's rule, carried over: whenever a breakup is present, `rate` EQUALS the
-- sum of its operations (each rounded to 4dp, as numeric(14,4) stores a rate),
-- and only a `cmt` line may carry one. The app derives the rate the same way
-- (`cmtBreakupTotal`, lib/orders/budget/totals.ts), so a save that passed the
-- schema cannot fail this check.
--
-- The five 0574 columns are LEFT IN PLACE, always NULL from here on: no
-- budget line holds a value in them (checked 2026-10-30, 0 of 6 CMT lines), and
-- dropping them would break restoring an older `budget_snapshot` that names
-- them. `chk_obl_cmt_breakup` stays satisfied by their being null.
-- ----------------------------------------------------------------------------

alter table public.order_budget_lines
  add column if not exists cmt_ops jsonb;

comment on column public.order_budget_lines.cmt_ops is
  'CMT breakup (0771): [{cmt_process_id, name, rate}] per piece, operations from cmt_processes. NULL = not broken up. When set, rate = sum of the rounded rates (chk_obl_cmt_ops). Replaces 0574''s five fixed columns.';

-- The sum the check compares `rate` with. IMMUTABLE (it reads only its
-- argument), so it may sit in a CHECK.
create or replace function public.obl_cmt_ops_total(ops jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(round((e ->> 'rate')::numeric, 4)), 0)
  from jsonb_array_elements(ops) as e
$$;

-- AGENTS.md "Function grants": both grants, in one statement.
revoke all on function public.obl_cmt_ops_total(jsonb) from public, anon;
grant execute on function public.obl_cmt_ops_total(jsonb) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_cmt_ops') then
    alter table public.order_budget_lines
      add constraint chk_obl_cmt_ops
      check (
        cmt_ops is null
        or (
          source = 'cmt'
          and jsonb_typeof(cmt_ops) = 'array'
          and jsonb_array_length(cmt_ops) > 0
          and rate = public.obl_cmt_ops_total(cmt_ops)
        )
      );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog — `{"success": true}` means the SQL
-- ran, not that it achieved its goal.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_budget_lines'
      and column_name = 'cmt_ops' and data_type = 'jsonb' and is_nullable = 'YES'
  ) then
    raise exception '0771: order_budget_lines.cmt_ops is missing or not a nullable jsonb';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_cmt_ops') then
    raise exception '0771: chk_obl_cmt_ops is missing';
  end if;
  if public.obl_cmt_ops_total('[{"rate": 1.23456}, {"rate": 2}]'::jsonb) <> 3.2346 then
    raise exception '0771: obl_cmt_ops_total does not round each term to 4dp';
  end if;
  if has_function_privilege('anon', 'public.obl_cmt_ops_total(jsonb)', 'execute') then
    raise exception '0771: obl_cmt_ops_total is executable by anon';
  end if;
end
$verify$;
