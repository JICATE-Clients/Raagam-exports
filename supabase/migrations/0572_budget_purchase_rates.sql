-- ============================================================================
-- Raagam ERP — 0572 Budget ▸ Purchase Rates: the per-line facts a purchase
-- rate needs
--
-- `doc/order/budget-purchase-rates.md`, client blueprint 2026-09-18 (Purchase
-- Rates tab, Yarn / Fabric / Accessories child tabs). The blueprint's own SQL —
-- `budget_yarn_purchases`, `budget_accessories_purchases`, a GENERATED
-- `line_total` — is NOT used: 0428 already has one line table keyed by
-- `source`, and `amount` is deliberately derived with no column (0428's header).
-- What the blueprint genuinely adds is five facts about ONE LINE, and they are
-- five additive columns on `order_budget_lines`.
--
--
-- `rate` IS IN THE LINE'S OWN CURRENCY, AND NULL CURRENCY MEANS INR
--
-- A yarn bought from Bangladesh is quoted in dollars, and the purchaser types
-- the dollar price — converting it by hand before typing would put a number in
-- the box that matches no quotation anyone holds. So the rate stays in the
-- currency it was quoted in, and `INR Rate = rate x ex_rate` is DERIVED by
-- `lineInrRate()` in lib/orders/budget/totals.ts, for 0428's reason: a stored
-- INR rate beside a stored rate and a stored ex_rate is three numbers stating
-- two facts.
--
-- NULL `currency_code` = INR, and that is what makes this migration safe to
-- apply over existing budgets: every row written before today has a `rate` in
-- rupees, and with no backfill at all it keeps exactly that meaning. A default
-- of 'INR' would say the same thing twice (the code AND the null) and invite a
-- reader to wonder which one wins.
--
-- The two travel together — `chk_obl_currency_pair`. A currency with no rate
-- cannot be converted, and a rate with no currency is a multiplier applied to
-- rupees, which would quietly scale an INR price by 83. `ex_rate` is strictly
-- positive (`chk_obl_ex_rate_positive`) for the reason `order_budgets.
-- exchange_rate` is: a rate of 0 zeroes every converted figure, and zero reads
-- as "free", not as "unknown".
--
--
-- FOC IS A REAL LINE AT AMOUNT 0
--
-- A trim the customer supplies free (`material_bom_amendment_items.is_foc`,
-- 0474) is still a line of the budget — the operator must see it is covered,
-- and a purchase ceiling for it must be zero rather than absent. So it is
-- PULLED like any material line, counted as priced without a rate, and adds
-- nothing to cost. Same spelling as 0474, 0359 and 0369: one concept, one name.
--
--
-- IMPORT IS A FLAG, NOT A CURRENCY
--
-- Pulled from the Material BOM item's supply type (compared case-insensitively
-- — AGENTS.md "Nominated vendors": the supply-type enums disagree on case).
-- It is not inferred from `currency_code`: an imported trim can be bought from
-- an Indian agent in rupees, and a dollar quotation can come from a local
-- exporter.
--
--
-- `specification` — the blueprint's "Brand / Specifications" column. Free text,
-- capitalised by the Zod schema (`capsTextNullable`), never here.
--
--
-- SIZE-WISE RATE IS DELIBERATELY NOT HERE
--
-- The blueprint shows a SizeWiseRate checkbox. A checkbox with no per-size rate
-- grid behind it is a stated rule nothing enforces, and the grid needs the
-- requirement split per size, which the budget does not hold. Deferred to its
-- own design rather than half-added as a column that means nothing yet.
-- ============================================================================


alter table public.order_budget_lines
  add column if not exists specification text,
  add column if not exists currency_code text references public.currencies(code),
  add column if not exists ex_rate       numeric(14,6),
  add column if not exists is_foc        boolean not null default false,
  add column if not exists is_import     boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_currency_pair') then
    alter table public.order_budget_lines
      add constraint chk_obl_currency_pair
      check ((currency_code is null) = (ex_rate is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_obl_ex_rate_positive') then
    alter table public.order_budget_lines
      add constraint chk_obl_ex_rate_positive
      check (ex_rate is null or ex_rate > 0);
  end if;
end
$$;

comment on column public.order_budget_lines.specification is
  'Brand / Specifications (Budget ▸ Purchase Rates). Free text, stored in capitals by the Zod schema. 0572.';
comment on column public.order_budget_lines.currency_code is
  'The currency `rate` is quoted in. NULL = INR, which is what every row written before 0572 was — so no backfill. Travels with ex_rate (chk_obl_currency_pair). 0572.';
comment on column public.order_budget_lines.ex_rate is
  'Rupees per unit of currency_code. NULL exactly when currency_code is NULL; strictly positive, because 0 would read as "free". INR Rate = rate x ex_rate is DERIVED by lineInrRate() and has no column. 0572.';
comment on column public.order_budget_lines.is_foc is
  'Free of cost: the customer supplies it. A real line at amount 0 — shown, counted as priced without a rate, adding nothing to cost. Pulled from material_bom_amendment_items.is_foc (0474). 0572.';
comment on column public.order_budget_lines.is_import is
  'Imported material. Pulled from the Material BOM item''s supply type (case-insensitive). Not inferred from currency_code — an import can be bought in rupees. 0572.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable. An
-- `add column if not exists` that found a namesake of the wrong shape reports
-- success too, so every column's shape is asserted, and both CHECKs by their
-- definition rather than by name.
--
-- No new function, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ----------------------------------------------------------------------------

do $verify$
declare
  c   record;
  fk  int;
  def text;
begin
  for c in
    select * from (values
      ('specification', 'text',    'YES', null::text),
      ('currency_code', 'text',    'YES', null),
      ('ex_rate',       'numeric', 'YES', null),
      ('is_foc',        'boolean', 'NO',  'false'),
      ('is_import',     'boolean', 'NO',  'false')
    ) as v(col, typ, nullable, dflt)
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
      raise exception '0572: order_budget_lines.% is missing or not % / nullable=% / default %',
        c.col, c.typ, c.nullable, coalesce(c.dflt, 'none');
    end if;
  end loop;

  -- The currency is a real FK to currencies(code), not a free-text column that
  -- happens to hold codes.
  select count(*) into fk
    from pg_constraint
   where conrelid = 'public.order_budget_lines'::regclass
     and confrelid = 'public.currencies'::regclass
     and contype = 'f';
  if fk <> 1 then
    raise exception '0572: expected one FK from order_budget_lines to currencies, found %', fk;
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'chk_obl_currency_pair';
  if def is null or def not like '%currency_code IS NULL%' or def not like '%ex_rate IS NULL%' then
    raise exception '0572: chk_obl_currency_pair is missing or does not pair the two columns (%)', def;
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'chk_obl_ex_rate_positive';
  if def is null or def not like '%ex_rate > %' then
    raise exception '0572: chk_obl_ex_rate_positive is missing or wrong (%)', def;
  end if;

  -- NO "nothing was backfilled" assertion, unlike 0474's. There is no update
  -- statement above to assert against, and a "no line has a currency" check
  -- would raise on every correct replay once an operator has typed one.
end $verify$;
