-- ============================================================================
-- Raagam ERP — 0516 A document number FOLLOWS THE ROWS
--
-- Delete every order and the next one is 0001 again (client 2026-09-03: "i have
-- deleted the order entry … it as first but again its starting from number 1",
-- then "all — because i have deleted all the order, all the order based only we
-- are moving"). Same for the garment style code. Those are the only two
-- counters in this database, and both are order-side, which is what "all the
-- order based" names.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DID INSTEAD, AND WHY THAT WAS NOT A BUG.
--
-- 0392 and 0395 number from a counter TABLE rather than a sequence, because the
-- serial RESETS every April and a sequence cannot. A counter table never hands
-- a number back: `sales_order_no_counters` was deliberately given no DELETE
-- policy, and the comment on it says losing a (location, year) row would
-- restart a year that is already part-issued.
--
-- That is the right rule for a live document — an SC No is quoted from memory
-- and off printed paperwork, and two orders that a human reads as 0009 is an
-- argument nobody can settle afterwards. It is the WRONG rule for a system
-- being loaded with test orders and cleared again, which is what is happening
-- now: Head Office has issued 12 numbers and holds 8 orders, so the next one
-- was going to be 0013 on a screen showing eight rows.
--
-- ---------------------------------------------------------------------------
-- THE RULE, IN ONE SENTENCE: the next serial is one more than the highest one
-- ACTUALLY IN USE, and the counter is pulled back to the rows when it has run
-- ahead of them.
--
--   delete everything          → next is 0001
--   delete the last 4 of 12    → next is 0009
--   delete 0002-0005 of 12     → next is 0013, because 0012 still exists
--
-- GAPS ARE NOT REFILLED, deliberately. Reusing 0002 while 0012 is on someone's
-- desk is the collision this whole file is careful about; only the TAIL is
-- reclaimed, which is the state a cleared test run actually leaves behind.
--
-- ---------------------------------------------------------------------------
-- THE SWITCH IS ONE FUNCTION, AND IT IS THE POINT.
--
-- `document_no_reclaims()` returns true today. At go-live, replace it with
-- `false` in a one-line migration and both documents are monotonic again —
-- `greatest(counter, in_use) + 1`, which can never reissue a number. There is
-- no second place to remember, and no screen or service reads the flag, so
-- flipping it cannot leave a UI saying something the database does not do.
--
-- ---------------------------------------------------------------------------
-- "IN USE" IS READ OFF THE STORED NUMBERS, AND IT HAS TO MATCH ALL THREE
-- SPELLINGS THIS DATABASE ACTUALLY HOLDS.
--
-- The serial is not a column — it only exists inside the composed string. Today
-- (2026-09-03) `sales_orders` holds 94 rows in two shapes:
--
--     HO/RE/26-27/0012     8 rows   the current format (0431 gave it the dash)
--     U2/RE//2627/2086    86 rows   the legacy import, undashed, DOUBLE SLASH
--
-- MATCHING ONLY THE DASHED FORM WOULD BE THE WORST POSSIBLE BUG HERE. Unit 2's
-- 86 rows would all fail to match, "in use" would answer 0, the counter would
-- be pulled from 2086 back to 1, and the next order would be U2/RE/26-27/0001 —
-- which is a DIFFERENT STRING from U2/RE//2627/0001, so `sales_orders_order_
-- number_key` would not stop it, and the company would hold two orders that
-- every human reads as Unit 2's number 1. So all three spellings are matched,
-- and the migration asserts against the real 2086 below rather than trusting
-- that they are.
--
-- THE PREFIXES ARE BUILT FROM THE FORMAT FUNCTION, not typed out again:
-- `left(sales_order_no_format(code, fy, 1), -4)` is the format minus the serial
-- it just padded to four. A change to the format therefore moves the scanner
-- with it, which is the same "one composer" rule 0395 and 0431 both record.
-- `like` is used rather than a regex so a location code never has to be escaped
-- into a pattern; codes are alphanumeric (HO, U2), and a code containing % or _
-- would need this revisited.
--
-- ---------------------------------------------------------------------------
-- CONCURRENCY: AN ADVISORY LOCK, BECAUSE THE OLD ATOMICITY ARGUMENT NO LONGER
-- HOLDS.
--
-- 0395's `insert … on conflict … do update set last_no = c.last_no + 1
-- returning` is one atomic statement, and that was the whole safety proof: two
-- operators saving at the same instant cannot be handed one number.
--
-- Reading "in use" breaks that proof and it is worth being explicit about why,
-- because the failure is silent. In READ COMMITTED, when session B blocks on
-- the counter row that A is updating, Postgres re-evaluates B's statement
-- against the updated row — but a SUBQUERY over another table is NOT
-- re-evaluated with the new snapshot ("it can see the effects of concurrent
-- updating commands on the same rows it is trying to update, but it does not
-- see effects of those commands on other rows"). So B would still read the
-- pre-A maximum, heal to the same value A just took, and issue A's number.
--
-- `pg_advisory_xact_lock`, keyed per (document, location, year), serialises the
-- whole read-then-allocate instead. B waits for A to COMMIT, then takes a fresh
-- statement snapshot, sees A's order, and answers one higher. The lock is
-- released by the commit, so nothing has to remember to unlock it.
--
-- The unique indexes stay the backstop and are not being relied on as the
-- mechanism: `sales_orders_order_number_key` and `garment_styles_code_key` both
-- exist, so the worst outcome this can ever have is a loud refusal to save.
--
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER ON THE TWO SCANNERS, AND ONLY ON THEM.
--
-- `sales_orders` is narrowed by RLS to the caller's current unit (0483-0488).
-- An under-count is the DANGEROUS direction — rows hidden from the caller would
-- read as "not in use" and reissue their numbers — so the scanner must see
-- every row for the location and year it is asked about, whoever is asking. It
-- returns one integer and nothing else. Both are revoked from public and anon
-- (AGENTS.md, "Function grants"): a scanner that answers a logged-out caller
-- would be a row-count oracle over the order book.
--
-- ADDITIVE AND IDEMPOTENT. Every function is `create or replace`; no data is
-- rewritten, no counter row is touched by this migration, and no existing
-- number changes. The first order raised after it applies is the first thing
-- that behaves differently.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The switch.
-- ---------------------------------------------------------------------------
create or replace function public.document_no_reclaims()
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select true;
$$;

comment on function public.document_no_reclaims() is
  'Does a deleted document release its number? TRUE while the system is being '
  'loaded and cleared with test data (client 2026-09-03) — the serial follows '
  'the rows, so clearing every order restarts at 0001. Replace the body with '
  'false at go-live and both the SC No and the style code become monotonic '
  'again (greatest(counter, in_use) + 1), which can never reissue a number. '
  'THE ONE place this is decided: assign_order_number(), '
  'peek_sales_order_number(), assign_garment_style_code() and '
  'peek_garment_style_code() all reach it through next_*_serial().';

revoke all on function public.document_no_reclaims() from public, anon;
grant execute on function public.document_no_reclaims() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. The highest SC No serial actually in use, for one (location, year).
--
-- Three spellings, all real — see the header. `max` ignores the NULLs the
-- non-matching rows produce, and answers 0 for a location with nothing left.
-- ---------------------------------------------------------------------------
create or replace function public.sales_order_serial_in_use(
  p_location_id uuid,
  p_fy          text
)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with pfx as (
    select
      -- 'HO/RE/26-27/' — the format minus the 4 digits it just padded.
      left(public.sales_order_no_format(l.code, p_fy, 1), -4) as current_form,
      -- 'U2/RE//2627/' — the legacy import's double slash and undashed year.
      l.code || '/RE//' || p_fy || '/'                        as legacy_form,
      -- 'U2/RE/2627/' — ours before 0431 gave the year its dash.
      l.code || '/RE/'  || p_fy || '/'                        as predash_form
    from public.locations l
    where l.id = p_location_id
  )
  select coalesce(max(t.tail::int), 0)
  from (
    select case
             when o.order_number like p.current_form || '%'
               then substr(o.order_number, length(p.current_form) + 1)
             when o.order_number like p.legacy_form || '%'
               then substr(o.order_number, length(p.legacy_form) + 1)
             when o.order_number like p.predash_form || '%'
               then substr(o.order_number, length(p.predash_form) + 1)
           end as tail
      from public.sales_orders o
      cross join pfx p
     where o.location_id = p_location_id
  ) t
  where t.tail ~ '^[0-9]+$';
$$;

comment on function public.sales_order_serial_in_use(uuid, text) is
  'The highest SC No serial this location has actually issued and still holds, '
  'for one fiscal year; 0 when it holds none. Matches all three spellings in '
  'the table — HO/RE/26-27/0012, the legacy double-slash U2/RE//2627/2086, and '
  'the pre-0431 undashed form — because missing a spelling would reset a '
  'counter that is 2,086 deep and reissue every number in it under a different '
  'string, which the unique index could not catch. SECURITY DEFINER: RLS '
  'narrows sales_orders to the caller''s unit, and a row it cannot see would '
  'read as a number not in use.';

revoke all on function public.sales_order_serial_in_use(uuid, text) from public, anon;
grant execute on function public.sales_order_serial_in_use(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. The serial the next order WOULD take. ONE definition, four readers.
--
-- `greatest(counter, in_use)` in the else branch is not belt-and-braces: the
-- counter is read under the CALLER's RLS, and 0395 accepted that a caller
-- without orders:view reads nothing there and is shown 0001. With the scanner
-- beside it that same caller now gets the true answer instead, and when the
-- switch is off this expression is exactly "never reissue".
-- ---------------------------------------------------------------------------
create or replace function public.next_sales_order_serial(
  p_location_id uuid,
  p_fy          text
)
returns int
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
           when public.document_no_reclaims() and counter > in_use then in_use + 1
           else greatest(counter, in_use) + 1
         end
  from (
    select
      coalesce((select c.last_no
                  from public.sales_order_no_counters c
                 where c.location_id = p_location_id and c.fy = p_fy), 0) as counter,
      public.sales_order_serial_in_use(p_location_id, p_fy)               as in_use
  ) s;
$$;

comment on function public.next_sales_order_serial(uuid, text) is
  'The serial the next order at this location and fiscal year would receive. '
  'THE one definition — assign_order_number() records what this says and '
  'peek_sales_order_number() shows it, so a preview cannot differ from the '
  'number saved (0395''s rule). Follows the rows while document_no_reclaims() '
  'is true; monotonic when it is not.';

revoke all on function public.next_sales_order_serial(uuid, text) from public, anon;
grant execute on function public.next_sales_order_serial(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. The assigner. Unchanged except for where the number comes from.
--
-- The advisory lock is taken BEFORE the serial is read — see the header. It
-- covers the read and the write together, which the single upsert statement can
-- no longer do on its own.
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  if new.order_number is not null and new.order_number <> '' then
    return new;
  end if;

  -- Refuse rather than invent a bucket. A shared fallback would collide with
  -- itself the moment a second location-less order was raised.
  if new.location_id is null then
    raise exception
      'An order needs a Location before it can be numbered — the SC No counts '
      'per location and restarts each April.'
      using errcode = '23502';
  end if;

  select l.code into v_loc
    from public.locations l
   where l.id = new.location_id;

  if v_loc is null or v_loc = '' then
    raise exception
      'Location % has no code, so it cannot start an SC No.', new.location_id
      using errcode = '23502';
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.order_date, current_date));

  -- Serialise the read-then-allocate per (document, location, year). Released
  -- on commit; two operators saving at once queue rather than collide.
  perform pg_advisory_xact_lock(
    hashtext('sales_order_no'),
    hashtext(new.location_id::text || v_fy)
  );

  v_next := public.next_sales_order_serial(new.location_id, v_fy);

  -- The counter is now a RECORD of what was issued rather than the thing that
  -- decides it. It is still written, because it is what the peek reads when the
  -- scanner is not available to the caller, and what a future monotonic
  -- go-live switch reads as its floor.
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, v_next)
  on conflict (location_id, fy) do update
    set last_no = excluded.last_no;

  new.order_number := public.sales_order_no_format(v_loc, v_fy, v_next);
  return new;
end;
$$;

comment on function public.assign_order_number() is
  'Assigns the SC No HO/RE/<fy>/<nnnn> on insert. The serial comes from '
  'next_sales_order_serial(), which follows the rows while '
  'document_no_reclaims() is true — delete every order and the next is 0001. '
  'An advisory lock covers the read and the write, because reading the rows '
  'means the old single-statement atomicity argument no longer holds. SECURITY '
  'INVOKER — the caller must hold orders:create, which is what the counter''s '
  'policies require.';

revoke all on function public.assign_order_number() from public, anon;
grant execute on function public.assign_order_number() to authenticated;

drop trigger if exists trg_so_code on public.sales_orders;
create trigger trg_so_code before insert on public.sales_orders
  for each row execute function public.assign_order_number();


-- ---------------------------------------------------------------------------
-- 5. The peek, now reading the same one definition.
-- ---------------------------------------------------------------------------
create or replace function public.peek_sales_order_number(
  p_location_id uuid,
  p_on          date default null
)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.sales_order_no_format(
           l.code,
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           public.next_sales_order_serial(
             p_location_id,
             public.fiscal_year_segment(coalesce(p_on, current_date))))
    from public.locations l
   where l.id = p_location_id;
$$;

comment on function public.peek_sales_order_number(uuid, date) is
  'The SC No the next order raised at p_location_id on p_on WOULD receive. '
  'Still a prediction and not a reservation — it consumes nothing, and the '
  'BEFORE INSERT trigger remains the only thing that assigns a real number. '
  'NULL when the location is unknown.';

revoke all on function public.peek_sales_order_number(uuid, date) from public, anon;
grant execute on function public.peek_sales_order_number(uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. The same three functions for the garment style code (STL/26-27/0007).
--
-- Keyed on the fiscal year alone — the style code has never been per-location.
-- 0431 restamped every existing code into the dashed form, so the other two
-- spellings are matched for safety rather than because rows in them are known
-- to survive: STL/2627/0002 (pre-0431) and STL-2627-1 (pre-0402, unpadded).
-- ---------------------------------------------------------------------------
create or replace function public.garment_style_serial_in_use(p_fy text)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with pfx as (
    select left(public.garment_style_code_format(p_fy, 1), -4) as current_form,
           'STL/' || p_fy || '/'                              as predash_form,
           'STL-' || p_fy || '-'                              as legacy_form
  )
  select coalesce(max(t.tail::int), 0)
  from (
    select case
             when s.code like p.current_form || '%'
               then substr(s.code, length(p.current_form) + 1)
             when s.code like p.predash_form || '%'
               then substr(s.code, length(p.predash_form) + 1)
             when s.code like p.legacy_form || '%'
               then substr(s.code, length(p.legacy_form) + 1)
           end as tail
      from public.garment_styles s
      cross join pfx p
  ) t
  where t.tail ~ '^[0-9]+$';
$$;

comment on function public.garment_style_serial_in_use(text) is
  'The highest garment style serial still held for one fiscal year; 0 when '
  'none. Matches the dashed form, the pre-0431 STL/2627/nnnn and the pre-0402 '
  'unpadded STL-2627-n. SECURITY DEFINER for the same reason the order scanner '
  'is: a row the caller cannot see would read as a code not in use.';

revoke all on function public.garment_style_serial_in_use(text) from public, anon;
grant execute on function public.garment_style_serial_in_use(text) to authenticated;


create or replace function public.next_garment_style_serial(p_fy text)
returns int
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
           when public.document_no_reclaims() and counter > in_use then in_use + 1
           else greatest(counter, in_use) + 1
         end
  from (
    select
      coalesce((select c.last_no
                  from public.garment_style_code_counters c
                 where c.fy = p_fy), 0)          as counter,
      public.garment_style_serial_in_use(p_fy)   as in_use
  ) s;
$$;

comment on function public.next_garment_style_serial(text) is
  'The serial the next garment style of this fiscal year would receive. THE '
  'one definition — assign_garment_style_code() records it and '
  'peek_garment_style_code() shows it.';

revoke all on function public.next_garment_style_serial(text) from public, anon;
grant execute on function public.next_garment_style_serial(text) to authenticated;


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

  perform pg_advisory_xact_lock(hashtext('garment_style_code'), hashtext(v_fy));

  v_next := public.next_garment_style_serial(v_fy);

  insert into public.garment_style_code_counters as c (fy, last_no)
  values (v_fy, v_next)
  on conflict (fy) do update
    set last_no = excluded.last_no;

  new.code := public.garment_style_code_format(v_fy, v_next);
  return new;
end;
$$;

comment on function public.assign_garment_style_code() is
  'Garment style code STL/<fy>/<nnnn>. The serial comes from '
  'next_garment_style_serial(), which follows the rows while '
  'document_no_reclaims() is true. SECURITY INVOKER — the caller must hold '
  'orders:create, which is what the counter table''s policies require.';

revoke all on function public.assign_garment_style_code() from public, anon;
grant execute on function public.assign_garment_style_code() to authenticated;

drop trigger if exists trg_garment_style_code on public.garment_styles;
create trigger trg_garment_style_code before insert on public.garment_styles
  for each row execute function public.assign_garment_style_code();


create or replace function public.peek_garment_style_code(p_on date default null)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.garment_style_code_format(
           public.garment_style_fy(coalesce(p_on, current_date)),
           public.next_garment_style_serial(
             public.garment_style_fy(coalesce(p_on, current_date))));
$$;

comment on function public.peek_garment_style_code(date) is
  'The code the next garment style dated p_on WOULD receive. Consumes nothing; '
  'the BEFORE INSERT trigger remains the only assigner.';

revoke all on function public.peek_garment_style_code(date) from public, anon;
grant execute on function public.peek_garment_style_code(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Self-verification.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
-- Every assertion below reads the CATALOG or the real rows, never this file.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ho  uuid;
  v_u2  uuid;
  v_n   int;
  v_txt text;
begin
  -- 7a. THE LEGACY DOUBLE-SLASH ROWS ARE SEEN. This is the assertion that
  --     matters most: 86 Unit 2 orders are spelled U2/RE//2627/2086, and a
  --     scanner blind to them would pull that counter back to 1.
  select id into v_u2 from public.locations where code = 'U2';
  if v_u2 is not null then
    v_n := public.sales_order_serial_in_use(v_u2, '2627');
    if v_n < 2000 then
      raise exception
        '0516: sales_order_serial_in_use(U2, 2627) = %, expected the legacy '
        'double-slash numbers to be matched (~2086). The scanner is blind to a '
        'spelling that exists, and would reissue every number in it.', v_n;
    end if;
  end if;

  -- 7b. THE CURRENT FORM IS SEEN TOO.
  select id into v_ho from public.locations where code = 'HO';
  if v_ho is not null then
    v_n := public.sales_order_serial_in_use(v_ho, '2627');
    if v_n = 0 then
      raise exception
        '0516: sales_order_serial_in_use(HO, 2627) = 0 while HO holds orders '
        'spelled HO/RE/26-27/nnnn — the current format is not being matched.';
    end if;
  end if;

  -- 7c. THE PEEK AND THE ASSIGNER CANNOT DRIFT, because they read one
  --     function. Assert the peek is exactly the format of that number.
  if v_ho is not null then
    v_txt := public.peek_sales_order_number(v_ho, current_date);
    if v_txt is distinct from public.sales_order_no_format(
         'HO', public.fiscal_year_segment(current_date),
         public.next_sales_order_serial(v_ho, public.fiscal_year_segment(current_date)))
    then
      raise exception '0516: the peek (%) is not the composed next serial.', v_txt;
    end if;
  end if;

  -- 7d. THE STYLE SCANNER SEES THE SEVEN DASHED CODES.
  if (select count(*) from public.garment_styles) > 0 then
    v_n := public.garment_style_serial_in_use('2627');
    if v_n = 0 then
      raise exception
        '0516: garment_style_serial_in_use(2627) = 0 while garment_styles holds '
        'STL/26-27/nnnn rows — the dashed form is not being matched.';
    end if;
  end if;

  -- 7e. NOTHING IS ANON-CALLABLE. Postgres grants EXECUTE TO PUBLIC on every
  --     new function and Supabase adds a separate anon grant; revoking one
  --     leaves the other standing (0383 → 0385 → 0386). Check the ACL.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('document_no_reclaims',
                         'sales_order_serial_in_use', 'next_sales_order_serial',
                         'garment_style_serial_in_use', 'next_garment_style_serial',
                         'assign_order_number', 'peek_sales_order_number',
                         'assign_garment_style_code', 'peek_garment_style_code')
       and (
         has_function_privilege('anon', p.oid, 'execute')
         -- A NULL acl is NOT "no grants" — it is Postgres's built-in default,
         -- which is EXECUTE TO PUBLIC. Treating it as clean is exactly how a
         -- check passes while the function is still open (0386 shipped a no-op
         -- that way).
         or p.proacl is null
         -- PUBLIC's entry is the one with an EMPTY grantee: '=X/postgres'. It
         -- has to be anchored at the START of an acl ITEM, which is why this
         -- unnests rather than searching the joined string. `'%=X/%'` over the
         -- whole array was the first cut and it matched 'postgres=X/postgres' —
         -- the OWNER's own grant, present on every correctly locked-down
         -- function in this database. It failed this migration on its first
         -- apply, which is the only reason it is written out here.
         or exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       )
  ) then
    raise exception
      '0516: one of this migration''s functions is executable by anon or by '
      'PUBLIC. Both grants must be revoked in one statement (AGENTS.md).';
  end if;

  raise notice '0516 OK — document numbers follow the rows; reclaims = %',
    public.document_no_reclaims();
end;
$$;
