-- ============================================================================
-- Raagam ERP — 0402 The Style serial: STL/2627/0001
--
-- The client named the string they want for a garment style's serial
-- (2026-08-11): STL/2627/0001. Three changes to what 0393 mints:
--
--   * separators are SLASHES, not dashes;
--   * the running number is PADDED to four digits (81 -> 0081);
--   * the fiscal year is UNCHANGED and stays whole.
--
-- THE FISCAL YEAR STAYS WHOLE, and that is a decision rather than an omission.
-- `2627` is one segment, not `26/27`, so garment_style_fy() is not touched by
-- this migration at all. It also keeps the Style serial reading the same shape
-- as the SC No (0395: HO/RE/2627/0001) — the same operators quote both numbers
-- all day, and two documents that segment their year differently is the kind of
-- inconsistency nobody reports and everybody has to remember.
--
-- ---------------------------------------------------------------------------
-- THE PADDING DELIBERATELY REVERSES 0393. DO NOT "FIX" IT BACK.
--
-- 0393 carries this line, and it is one day old:
--
--   -- Unpadded: STL-2627-81, not STL-2627-0081 (client, 2026-08-10).
--
-- That was the client's instruction on 2026-08-10 and it was recorded correctly.
-- On 2026-08-11 the same client specified the target string STL/2627/0001,
-- which is padded. The later instruction wins. The earlier comment is
-- SUPERSEDED, not overlooked — so a reader who finds 0393 on its own is holding
-- a rule this file breaks on purpose, and undoing the padding needs a new client
-- decision, not a tidy-up. That is the whole reason this paragraph exists.
--
-- ---------------------------------------------------------------------------
-- EXISTING CODES ARE NOT REWRITTEN.
--
-- There is no UPDATE on public.garment_styles in this file, deliberately. A
-- style's code is how the record is referred to on paper, in email and in the
-- legacy system, so restamping numbers that have already been issued would
-- break every one of those references in order to make a column look uniform.
-- Styles already saved keep STL-2627-81; only codes assigned from here take the
-- new shape. The table will therefore hold BOTH formats, and that is correct —
-- same rule 0383 states for created_by, where inventing history to fill a column
-- is the worse answer.
--
-- ---------------------------------------------------------------------------
-- ONE FORMAT, ONE PLACE — the half 0393 did not quite reach.
--
-- 0393 factored the fiscal-year rule into garment_style_fy() so the assigner and
-- the peek could not drift, and THAT PROPERTY IS PRESERVED HERE: both functions
-- below still call it, and neither contains any year arithmetic of its own.
--
-- What 0393 left duplicated was the FORMAT — written out once in each function.
-- This migration is precisely what that costs: a format change becomes two edits
-- that must agree, and the failure mode is silent and nasty, a preview that
-- confidently shows the operator a different string from the one the trigger
-- saves. So the format moves into garment_style_code_format(), exactly as 0395
-- did for the SC No with sales_order_no_format(). After this there is one copy
-- of the string, and the next change to it is one edit.
--
-- ---------------------------------------------------------------------------
-- THE PAD IS A FLOOR, NOT A WIDTH — the trap 0395 already sprang once.
--
-- Postgres lpad(string, length, fill) is a WIDTH: it TRUNCATES anything longer.
-- `lpad('12345', 4, '0')` is '1234', so padding naively to 4 would stamp the
-- 12,345th style of a fiscal year STL/2627/1234 — a duplicate of style 1234's
-- code, in the field the record is identified by. `greatest(4, length(...))` is
-- what makes the 4 a minimum instead. Copied deliberately from
-- sales_order_no_format(), where this was a real bug caught on the first apply;
-- do not simplify it back to a bare lpad().
--
-- ADDITIVE AND IDEMPOTENT: every statement is `create or replace` (plus one
-- trigger re-assert), so re-running this changes nothing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The format, once.
--
-- IMMUTABLE because it is a pure function of its arguments — which is what lets
-- the peek call it without a per-row planner cost, the same reason
-- garment_style_fy() is immutable.
--
-- It takes the fiscal-year segment rather than computing one: the year rule is
-- garment_style_fy()'s job and this function must not become a second place
-- that knows about April.
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
  select 'STL/' || p_fy || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.garment_style_code_format(text, int) is
  'Composes a garment style serial: 2627 + 1 -> STL/2627/0001. The ONE place '
  'the format lives — assign_garment_style_code() and peek_garment_style_code() '
  'both call it, so the preview can never show a different string from the one '
  'saved. Slashes and the 4-digit pad are the client''s 2026-08-11 instruction, '
  'which deliberately supersedes 0393''s unpadded STL-2627-81. The pad is a '
  'FLOOR, not a width — a bare lpad() would truncate style 12345 to 1234 and '
  'duplicate an issued code.';

revoke all on function public.garment_style_code_format(text, int) from public, anon;
grant execute on function public.garment_style_code_format(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The assigner.
--
-- Same signature and same behaviour as 0393 — an explicitly supplied code is
-- still honoured and still does not advance the counter, and it is still
-- SECURITY INVOKER so the counter's own policies decide whether the caller may
-- take a number. The only change is the string it composes, and it no longer
-- composes it here.
-- ---------------------------------------------------------------------------
create or replace function public.assign_garment_style_code()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_fy   text;
  v_next int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  v_fy := public.garment_style_fy(coalesce(new.style_date, current_date));

  -- `as c` so the DO UPDATE can name the EXISTING row unambiguously.
  insert into public.garment_style_code_counters as c (fy, last_no)
  values (v_fy, 1)
  on conflict (fy) do update
    set last_no = c.last_no + 1
  returning c.last_no into v_next;

  new.code := public.garment_style_code_format(v_fy, v_next);
  return new;
end;
$$;

revoke all on function public.assign_garment_style_code() from public, anon;
grant execute on function public.assign_garment_style_code() to authenticated;

-- `create or replace` preserves the function's OID, so the existing trigger
-- already picks up this body and nothing below is needed on a database that has
-- run 0393. It is re-asserted anyway, for the same reason 0393 re-asserted it:
-- a database that somehow never got there is still on the generic
-- assign_code('STL', …) trigger, and that one would quietly mint the old shape.
drop trigger if exists trg_garment_style_code on public.garment_styles;
create trigger trg_garment_style_code before insert on public.garment_styles
  for each row execute function public.assign_garment_style_code();

-- ---------------------------------------------------------------------------
-- 3. The peek — what the NEXT code would be, without taking it.
--
-- Signature, volatility and security are unchanged from 0393, and so is the
-- consequence its header states: the answer is a PREDICTION, not a reservation.
-- It does not touch the counter, so opening the New Style form a hundred times
-- burns no numbers; two operators with the form open at once both see the same
-- number and only one gets it. The trigger remains the sole authority.
--
-- What changes is that the format is no longer written out a second time here.
-- That is the drift this pair is protected against: before, showing STL/… on
-- screen while saving STL-… took one forgotten edit.
-- ---------------------------------------------------------------------------
create or replace function public.peek_garment_style_code(p_on date default null)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.garment_style_code_format(
           public.garment_style_fy(coalesce(p_on, current_date)),
           coalesce(
             (select c.last_no
                from public.garment_style_code_counters c
               where c.fy = public.garment_style_fy(coalesce(p_on, current_date))),
             0) + 1);
$$;

comment on function public.peek_garment_style_code(date) is
  'The code the next garment style created on p_on WOULD receive, e.g. '
  'STL/2627/0001. Does not consume the counter, so it is a prediction rather '
  'than a reservation — the BEFORE INSERT trigger remains the only thing that '
  'assigns a real number. Format comes from garment_style_code_format() so a '
  'preview cannot disagree with what is saved.';

revoke all on function public.peek_garment_style_code(date) from public, anon;
grant execute on function public.peek_garment_style_code(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-verification.
--
-- A migration reporting success proves the SQL ran, not that it achieved its
-- stated goal (0386). These assert the four things that would silently be
-- wrong, and the grants are checked FROM THE CATALOG rather than by reading the
-- revoke statements above — which is the specific lesson 0385/0386 cost.
--
-- Nothing asserts that existing codes were left alone: there is no statement in
-- this file that writes to public.garment_styles, and that absence is the
-- guarantee. An assertion here could only re-read rows this migration never
-- touched and report success for free.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before int;
  v_after  int;
  v_peek   text;
  v_fy     text;
begin
  -- (a) The target string the client wrote down, character for character.
  if public.garment_style_code_format('2627', 1) <> 'STL/2627/0001' then
    raise exception '0402: format(2627, 1) should be STL/2627/0001, got %',
      public.garment_style_code_format('2627', 1);
  end if;

  -- (b) The pad is a FLOOR. A bare lpad(…, 4, '0') returns 1234 here and would
  --     duplicate style 1234's code — this is the assertion that catches it.
  if public.garment_style_code_format('2627', 12345) <> 'STL/2627/12345' then
    raise exception '0402: the 4-digit pad TRUNCATED — format(2627, 12345) gave %',
      public.garment_style_code_format('2627', 12345);
  end if;

  -- (c) The fiscal year is still one whole four-character segment. 0393 owns
  --     the April boundary and this migration must not have moved it.
  v_fy := public.garment_style_fy(date '2026-08-11');
  if v_fy <> '2627' then
    raise exception '0402: FY for 2026-08-11 should be 2627, got %', v_fy;
  end if;
  if public.garment_style_fy(date '2026-03-31') <> '2526' then
    raise exception '0402: the April boundary moved — 2026-03-31 gave %',
      public.garment_style_fy(date '2026-03-31');
  end if;

  -- (d) The peek still does not consume, and it agrees with the format
  --     function rather than carrying a copy of the string.
  select coalesce(max(last_no), 0) into v_before
    from public.garment_style_code_counters where fy = v_fy;
  v_peek := public.peek_garment_style_code(date '2026-08-11');
  select coalesce(max(last_no), 0) into v_after
    from public.garment_style_code_counters where fy = v_fy;

  if v_before <> v_after then
    raise exception '0402: peek CONSUMED a number (% -> %)', v_before, v_after;
  end if;
  if v_peek <> public.garment_style_code_format(v_fy, v_before + 1) then
    raise exception '0402: peek returned %, expected %',
      v_peek, public.garment_style_code_format(v_fy, v_before + 1);
  end if;

  -- (e) The trigger points at the function this file replaced. `create or
  --     replace` preserves the OID, so this should hold — but 0392 asserted the
  --     same thing for the same reason: the table was once on the generic
  --     assign_code() trigger, which would mint the old shape from a function
  --     nothing here edits.
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.garment_styles'::regclass
       and t.tgname = 'trg_garment_style_code'
       and not t.tgisinternal
       and t.tgfoid = 'public.assign_garment_style_code()'::regprocedure
  ) then
    raise exception
      '0402: trg_garment_style_code is not pointed at assign_garment_style_code()';
  end if;

  -- (f) Function grants, read from the catalog (AGENTS.md "Function grants").
  --     Testing `anon` alone covers BOTH grant paths: anon inherits anything
  --     granted to PUBLIC, so Postgres's built-in EXECUTE TO PUBLIC and
  --     Supabase's separate direct anon grant both show up here. Revoking one
  --     and leaving the other is exactly what 0383 shipped.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('garment_style_code_format',
                         'assign_garment_style_code',
                         'peek_garment_style_code')
       and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception '0402: a style-code function is still executable by anon';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'peek_garment_style_code'
       and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    raise exception '0402: peek_garment_style_code is not callable by authenticated';
  end if;
end $$;
