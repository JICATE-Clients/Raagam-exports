-- ============================================================================
-- Raagam ERP — 0574 Budget ▸ CMTs: the per-operation breakup of a CMT rate
--
-- `doc/order/budget-purchase-rates.md` "Phase 3", client blueprint 2026-09-18:
-- one CMT row per style (and coordinate), amount = SQ Qty x CMT Rate, with an
-- OPTIONAL breakup of that rate into Cutting · Sewing / Making · Checking ·
-- Ironing · Packing per piece. The blueprint's `budget_cmt_expenses` +
-- `budget_cmt_operation_breakup` tables are not used — one line table keyed by
-- `source`, for 0572's and 0428's reason. `budget_cmts` (0369) is the dropped
-- Planning module's table; it is not live and is not reused.
--
--
-- FIVE COLUMNS, NOT A CHILD TABLE
--
-- The operations are a FIXED five, named by the client, with no master behind
-- them (nothing live holds a CMT operation vocabulary). A child table keyed by
-- operation would be a vocabulary with exactly one possible set of rows, plus a
-- join on every read of a budget. Five nullable columns say the same thing and
-- sit on the line they explain.
--
-- NULL is "not broken up" and 0 is "this operation is done free" (the buyer
-- irons, packing is in the making charge) — different answers, which is why
-- there is no default. Each is non-negative for `rate`'s own reason (0428): a
-- negative charge is a credit wearing the wrong label.
--
--
-- THE RATE AND ITS BREAKUP CANNOT DISAGREE — `chk_obl_cmt_breakup`
--
-- `rate` stays THE rate for every reader: `lineAmount`, the totals, the
-- approval context, the purchase ceiling. The breakup only explains it. So
-- whenever any operation is set, `rate` must EQUAL their sum, and the breakup
-- is only allowed on a `cmt` line. Without the check, a rate edited after its
-- breakup was typed would leave the line saying two different prices, and the
-- document would cost one and explain the other.
--
-- The equality is EXACT and safe to state as one: `rate` and all five columns
-- are `numeric(14,4)` — decimal, not binary — so Postgres rounds each on write
-- and adds them without error. The app derives `rate` from the breakup with the
-- same 4dp rounding (`cmtBreakupTotal`, lib/orders/budget/totals.ts), so a save
-- through the schema always satisfies it; the check is what holds `lib/data-io`
-- and hand-written SQL to the same rule.
-- ============================================================================


alter table public.order_budget_lines
  add column if not exists cutting_rate  numeric(14,4),
  add column if not exists making_rate   numeric(14,4),
  add column if not exists checking_rate numeric(14,4),
  add column if not exists ironing_rate  numeric(14,4),
  add column if not exists packing_rate  numeric(14,4);

do $$
declare
  col text;
begin
  foreach col in array array['cutting_rate', 'making_rate', 'checking_rate', 'ironing_rate', 'packing_rate'] loop
    if not exists (select 1 from pg_constraint where conname = 'chk_obl_' || col || '_nonneg') then
      execute format(
        'alter table public.order_budget_lines add constraint %I check (%I is null or %I >= 0)',
        'chk_obl_' || col || '_nonneg', col, col
      );
    end if;
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'chk_obl_cmt_breakup') then
    alter table public.order_budget_lines
      add constraint chk_obl_cmt_breakup
      check (
        (cutting_rate is null and making_rate is null and checking_rate is null
          and ironing_rate is null and packing_rate is null)
        or (
          source = 'cmt'
          and rate = coalesce(cutting_rate, 0) + coalesce(making_rate, 0)
                   + coalesce(checking_rate, 0) + coalesce(ironing_rate, 0)
                   + coalesce(packing_rate, 0)
        )
      );
  end if;
end
$$;

comment on column public.order_budget_lines.cutting_rate is
  'CMT breakup: Cutting, per piece. NULL = not broken up; 0 = done free. When any of the five is set, rate = their sum (chk_obl_cmt_breakup). 0574.';
comment on column public.order_budget_lines.making_rate is
  'CMT breakup: Sewing / Making, per piece. See cutting_rate. 0574.';
comment on column public.order_budget_lines.checking_rate is
  'CMT breakup: Checking, per piece. See cutting_rate. 0574.';
comment on column public.order_budget_lines.ironing_rate is
  'CMT breakup: Ironing, per piece. See cutting_rate. 0574.';
comment on column public.order_budget_lines.packing_rate is
  'CMT breakup: Packing, per piece. See cutting_rate. 0574.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. Each
-- column's shape is asserted INCLUDING its scale — the equality in
-- chk_obl_cmt_breakup is only exact because every term is numeric(14,4), so a
-- namesake of another scale found by `add column if not exists` would make the
-- check reject correct rows. `rate` itself is asserted too, for the same
-- reason. The CHECKs are asserted by their definitions.
--
-- No new function, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col text;
  def text;
begin
  foreach col in array array['rate', 'cutting_rate', 'making_rate', 'checking_rate', 'ironing_rate', 'packing_rate'] loop
    perform 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'order_budget_lines'
       and column_name = col
       and data_type = 'numeric'
       and numeric_precision = 14
       and numeric_scale = 4
       and is_nullable = 'YES';
    if not found then
      raise exception '0574: order_budget_lines.% is missing or not a nullable numeric(14,4)', col;
    end if;
  end loop;

  foreach col in array array['cutting_rate', 'making_rate', 'checking_rate', 'ironing_rate', 'packing_rate'] loop
    select pg_get_constraintdef(oid) into def
      from pg_constraint where conname = 'chk_obl_' || col || '_nonneg';
    if def is null or def not like '%' || col || ' >= %' then
      raise exception '0574: the non-negative check on % is missing or wrong (%)', col, def;
    end if;
  end loop;

  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'chk_obl_cmt_breakup';
  if def is null then
    raise exception '0574: chk_obl_cmt_breakup is missing';
  end if;
  if def not like '%''cmt''%' then
    raise exception '0574: chk_obl_cmt_breakup does not restrict the breakup to cmt lines (%)', def;
  end if;
  foreach col in array array['cutting_rate', 'making_rate', 'checking_rate', 'ironing_rate', 'packing_rate'] loop
    -- ILIKE: the catalog prints it back as COALESCE(col, (0)::numeric).
    if def not ilike '%coalesce(' || col || '%' then
      raise exception '0574: chk_obl_cmt_breakup does not add % into the rate (%)', col, def;
    end if;
  end loop;
end $verify$;
