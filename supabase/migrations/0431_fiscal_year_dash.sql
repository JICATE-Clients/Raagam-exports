-- ============================================================================
-- Raagam ERP — 0431 The fiscal year gets its dash: STL/26-27/0003
--
-- The client asked for the year segment of every document number to be
-- punctuated (2026-08-18): STL/2627/0003 -> STL/26-27/0003, and explicitly
-- "not only this style number, all number format".
--
-- This is a RESTORATION, not an invention. scripts/check-picker-identity.mts:57
-- has carried `SO/26-27/0401` all along as a sample of the RP-Software number
-- the operators have quoted for years; 2627 was ours.
--
-- ---------------------------------------------------------------------------
-- IT REVERSES 0402, WHICH SAID THE OPPOSITE IN SO MANY WORDS. DELIBERATE.
--
-- 0402 carries this, seven days old:
--
--   -- THE FISCAL YEAR STAYS WHOLE, and that is a decision rather than an
--   -- omission. `2627` is one segment, not `26/27` […]
--
-- That was the client's instruction on 2026-08-11 and it was recorded
-- correctly. On 2026-08-18 the same client specified the dash. The later
-- instruction wins, and 0402's paragraph is SUPERSEDED rather than overlooked —
-- so a reader who finds it on its own is holding a rule this file breaks on
-- purpose. Putting the year back together needs a new client decision, not a
-- tidy-up. This is the same shape of reversal 0402 itself recorded against
-- 0393's unpadded serial, and it is written down for the same reason.
--
-- The consistency 0402 was protecting is PRESERVED: the Style serial and the
-- SC No still segment their year identically, because both go through the one
-- label function below. Two documents punctuating a year differently is the
-- inconsistency nobody reports and everybody has to remember.
--
-- ---------------------------------------------------------------------------
-- THE DASH GOES IN THE COMPOSERS, NOT IN fiscal_year_segment(). THIS IS THE
-- WHOLE DESIGN, AND GETTING IT WRONG RE-MINTS ISSUED NUMBERS.
--
-- fiscal_year_segment() looks like the obvious place — one definition, and
-- every present and future format would inherit the dash for free. It is a
-- trap, because that function's output is also the COUNTER PRIMARY KEY:
--
--   garment_style_code_counters (fy text primary key)            0392:127
--   sales_order_no_counters     (location_id, fy) primary key    0395:178
--
-- Change it and `on conflict (fy)` / `on conflict (location_id, fy)` match
-- nothing: a fresh row is inserted at last_no = 1 and the series restarts
-- MID-YEAR, re-issuing STL/26-27/0001 when STL/2627/0003 is already out. And it
-- fails SILENTLY — the composed strings differ, so the unique index on
-- garment_styles.code never fires. The client's instruction was that the serial
-- carries on (STL/2627/0003 -> STL/26-27/0004), so this is not a style
-- preference; it is the requirement.
--
-- It would also strand supabase/seed/sales-order-no-cutover.sql:71-73, which
-- hardcodes fy '2627' and is still unrun — the open SC No cutover.
--
-- So: fiscal_year_segment() keeps returning 2627 and remains the ONE definition
-- of the April-March boundary. It is the KEY. The dash is a LABEL, applied when
-- the number is composed. The counters are not touched by this migration at all.
--
-- ---------------------------------------------------------------------------
-- EXISTING NUMBERS ARE RESTAMPED — ALSO A REVERSAL, ALSO ON INSTRUCTION.
--
-- 0395 and 0402 each declined to rewrite issued numbers, and each said why: a
-- number is what the record is called on paper, in email and in the legacy
-- system. The client was asked directly on 2026-08-18 and chose to restamp, so
-- section 3 rewrites the three existing style codes. Nothing else in the
-- database holds a copy — verified by scanning every text column in `public`
-- for the shape, which found garment_styles.code and nothing else — so there is
-- no denormalised copy left pointing at a number that no longer exists.
--
-- THE RESTAMP COMPOSES THROUGH THE COMPOSER rather than editing the string. A
-- regexp_replace that inserts a dash would be a THIRD copy of the format, free
-- to disagree with the two below; passing the parsed (fy, serial) back through
-- garment_style_code_format() means a restamped row is byte-identical to what
-- the trigger would mint for the same inputs. It also fixes the one row still
-- in the pre-0402 shape (STL-2627-1, created 2026-08-10, the day 0392 landed)
-- for free: parsed as fy 2627 serial 1, it composes to STL/26-27/0001, which
-- fills its own serial and collides with nothing.
--
-- ADDITIVE AND IDEMPOTENT: every function is `create or replace`, and both
-- updates match only the OLD shapes — a restamped code contains no four-digit
-- year segment, so a second run selects zero rows. `26--27` is unreachable for
-- the same reason, and fiscal_year_label() is a no-op on its own output besides.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The label, once.
--
-- IMMUTABLE — a pure function of its argument, which is what lets the composers
-- stay immutable and the peeks call them without a per-row planner cost.
--
-- It takes the SEGMENT and returns the LABEL. It deliberately does not know
-- about dates: which year a document belongs to is fiscal_year_segment()'s job
-- and this function must not become a second place that knows about April.
--
-- The guard is `~ '^[0-9]{4}$'` rather than a blind left/right split, and that
-- is what makes it idempotent: '26-27' does not match, so it comes back
-- untouched instead of becoming '26--7'. Anything unexpected passes through
-- unchanged too — a label function is not the place to reject a value the
-- counter has already accepted as a key.
-- ---------------------------------------------------------------------------
create or replace function public.fiscal_year_label(p_fy text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
           when p_fy ~ '^[0-9]{4}$'
             then left(p_fy, 2) || '-' || right(p_fy, 2)
           else p_fy
         end;
$$;

comment on function public.fiscal_year_label(text) is
  'How a fiscal-year segment is WRITTEN in a document number: 2627 -> 26-27 '
  '(client, 2026-08-18). The ONE place the dash lives — garment_style_code_format() '
  'and sales_order_no_format() both call it, so the Style serial and the SC No '
  'cannot punctuate a year differently. Deliberately NOT applied inside '
  'fiscal_year_segment(): that value is the primary key of both number counters, '
  'and changing it would orphan every counter row and restart the series at 0001 '
  'mid-year without raising anything. Idempotent — a value that is already '
  'dashed is returned unchanged.';

revoke all on function public.fiscal_year_label(text) from public, anon;
grant execute on function public.fiscal_year_label(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The two composers — the only functions in the database that embed a year.
--
-- Unchanged in every other respect: same signatures, same volatility, same
-- callers (each is shared by an assigner and a peek, which is what stops a
-- preview from showing a different string from the one saved).
--
-- `greatest(4, length(p_next::text))` STAYS. The pad is a FLOOR, not a width:
-- lpad() TRUNCATES, so a bare lpad(…, 4, '0') stamps the 12,345th document with
-- serial 1234 — a duplicate of an issued number, in the field the record is
-- identified by. Caught for real on 0395's first apply; do not simplify it.
-- ---------------------------------------------------------------------------
create or replace function public.garment_style_code_format(
  p_fy   text,
  p_next int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select 'STL/' || public.fiscal_year_label(p_fy) || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.garment_style_code_format(text, int) is
  'Composes a garment style serial: 2627 + 1 -> STL/26-27/0001. The ONE place '
  'the format lives — assign_garment_style_code() and peek_garment_style_code() '
  'both call it. The year is punctuated by fiscal_year_label() (0431, client '
  '2026-08-18), which deliberately supersedes 0402''s whole-year 2627. The pad '
  'is a FLOOR, not a width — a bare lpad() would truncate style 12345 to 1234 '
  'and duplicate an issued code.';

create or replace function public.sales_order_no_format(
  p_location_code text,
  p_fy            text,
  p_next          int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_location_code || '/RE/' || public.fiscal_year_label(p_fy) || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.sales_order_no_format(text, text, int) is
  'Composes an SC No: HO + 2627 + 1 -> HO/RE/26-27/0001. The ONE place the '
  'format lives — assign_order_number() and peek_sales_order_number() both call '
  'it. The year is punctuated by fiscal_year_label() (0431, client 2026-08-18). '
  'The 4-digit pad is a FLOOR, not a width — bare lpad() would truncate order '
  '12345 to 1234 and duplicate an existing SC No.';

-- ---------------------------------------------------------------------------
-- 3. Restamp what is already issued.
--
-- Composed BY THE COMPOSER, never by editing the string — see the header. The
-- subselect parses (fy, serial) out of the old shape and hands them back in, so
-- a restamped row is byte-identical to what the trigger would mint today.
--
-- Two old shapes for styles, one statement: the 0402 slashed form
-- (STL/2627/0002) and the pre-0402 dashed, unpadded form (STL-2627-1). Both
-- carry the same two facts; only the punctuation differs.
--
-- The BEFORE INSERT trigger is not involved in an UPDATE, so nothing here can
-- consume a counter number. That is asserted in section 4.
-- ---------------------------------------------------------------------------
update public.garment_styles g
   set code = public.garment_style_code_format(s.fy, s.serial)
  from (
    select x.id,
           coalesce(x.slashed[1], x.dashed[1])       as fy,
           coalesce(x.slashed[2], x.dashed[2])::int  as serial
      from (
        select id,
               regexp_match(code, '^STL/([0-9]{4})/([0-9]+)$') as slashed,
               regexp_match(code, '^STL-([0-9]{4})-([0-9]+)$') as dashed
          from public.garment_styles
         where code is not null
      ) x
     where x.slashed is not null or x.dashed is not null
  ) s
 where g.id = s.id;

-- Sales orders: none carry an SC No yet (the 0395 cutover seed is unrun), so
-- this selects nothing today. It is written anyway — the migration must be
-- correct on a database where orders HAVE been numbered, and leaving it out
-- would make that database's history depend on when this file happened to run.
update public.sales_orders o
   set order_number = public.sales_order_no_format(s.loc, s.fy, s.serial)
  from (
    select x.id, x.m[1] as loc, x.m[2] as fy, x.m[3]::int as serial
      from (
        select id, regexp_match(order_number, '^(.+)/RE/([0-9]{4})/([0-9]+)$') as m
          from public.sales_orders
         where order_number is not null
      ) x
     where x.m is not null
  ) s
 where o.id = s.id;

-- ---------------------------------------------------------------------------
-- 4. Self-verification.
--
-- A migration reporting success proves the SQL ran, not that it achieved its
-- stated goal (0386). These assert the things that would otherwise be silently
-- wrong — above all that the counters came through untouched, which is the
-- failure this design exists to avoid and the one that leaves no trace.
-- ---------------------------------------------------------------------------
do $$
declare
  v_style_last int;
  v_peek       text;
  v_bad        int;
begin
  -- (a) The two target strings, character for character.
  if public.garment_style_code_format('2627', 1) <> 'STL/26-27/0001' then
    raise exception '0431: style format(2627, 1) should be STL/26-27/0001, got %',
      public.garment_style_code_format('2627', 1);
  end if;
  if public.sales_order_no_format('HO', '2627', 1) <> 'HO/RE/26-27/0001' then
    raise exception '0431: SC No format(HO, 2627, 1) should be HO/RE/26-27/0001, got %',
      public.sales_order_no_format('HO', '2627', 1);
  end if;

  -- (b) The label is idempotent. A second application must not give 26--27 —
  --     which is what a blind left/right split would produce, and what the
  --     restamp in section 3 would have written on a re-run.
  if public.fiscal_year_label('26-27') <> '26-27' then
    raise exception '0431: fiscal_year_label is not idempotent — 26-27 gave %',
      public.fiscal_year_label('26-27');
  end if;

  -- (c) The pad is still a FLOOR. A bare lpad(…, 4, '0') returns 1234 here and
  --     would duplicate style 1234's code.
  if public.garment_style_code_format('2627', 12345) <> 'STL/26-27/12345' then
    raise exception '0431: the 4-digit pad TRUNCATED — format(2627, 12345) gave %',
      public.garment_style_code_format('2627', 12345);
  end if;

  -- (d) THE KEY IS STILL THE KEY. fiscal_year_segment() must be undashed, or
  --     every `on conflict` in the two assigners stops matching.
  if public.fiscal_year_segment(date '2026-08-11') <> '2627' then
    raise exception '0431: fiscal_year_segment is no longer the counter key — gave %',
      public.fiscal_year_segment(date '2026-08-11');
  end if;
  -- And the April boundary has not moved.
  if public.fiscal_year_segment(date '2026-03-31') <> '2526' then
    raise exception '0431: the April boundary moved — 2026-03-31 gave %',
      public.fiscal_year_segment(date '2026-03-31');
  end if;

  -- (e) NO COUNTER ROW WAS DISTURBED. A dashed key is the signature of the
  --     mistake this migration is designed around.
  select count(*) into v_bad from public.garment_style_code_counters where fy !~ '^[0-9]{4}$';
  if v_bad > 0 then
    raise exception '0431: % garment style counter row(s) have a non-key fy', v_bad;
  end if;
  select count(*) into v_bad from public.sales_order_no_counters where fy !~ '^[0-9]{4}$';
  if v_bad > 0 then
    raise exception '0431: % sales order counter row(s) have a non-key fy', v_bad;
  end if;

  -- (f) THE SERIAL CARRIES ON — the client's second instruction. The peek must
  --     be the number AFTER the counter, not a restart, and it must agree with
  --     the composer rather than carrying a copy of the string.
  select coalesce(max(last_no), 0) into v_style_last
    from public.garment_style_code_counters
   where fy = public.fiscal_year_segment(current_date);
  v_peek := public.peek_garment_style_code();
  if v_peek <> public.garment_style_code_format(
                 public.fiscal_year_segment(current_date), v_style_last + 1) then
    raise exception '0431: peek returned % but the counter says the next is %',
      v_peek,
      public.garment_style_code_format(
        public.fiscal_year_segment(current_date), v_style_last + 1);
  end if;

  -- (g) NOTHING IS LEFT IN THE OLD SHAPE, and nothing was mangled into a double
  --     dash. Checked over the data rather than over the statements that wrote
  --     it — a restamp that matched zero rows would pass a statement-level test.
  select count(*) into v_bad from public.garment_styles
   where code is not null and (code ~ 'STL[-/][0-9]{4}[-/]' or code like '%--%');
  if v_bad > 0 then
    raise exception '0431: % style code(s) still in the old shape or double-dashed', v_bad;
  end if;
  select count(*) into v_bad from public.sales_orders
   where order_number is not null
     and (order_number ~ '/RE/[0-9]{4}/' or order_number like '%--%');
  if v_bad > 0 then
    raise exception '0431: % SC No(s) still in the old shape or double-dashed', v_bad;
  end if;

  -- (h) Grants, read FROM THE CATALOG rather than by trusting the revoke above
  --     (AGENTS.md "Function grants"; 0385/0386 are what that lesson cost).
  --     Testing `anon` covers BOTH grant paths, since anon inherits anything
  --     granted to PUBLIC.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fiscal_year_label',
                         'garment_style_code_format',
                         'sales_order_no_format')
       and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception '0431: a number-format function is still executable by anon';
  end if;

  if not has_function_privilege('authenticated',
       'public.fiscal_year_label(text)'::regprocedure, 'execute') then
    raise exception '0431: fiscal_year_label is not callable by authenticated';
  end if;
end $$;
