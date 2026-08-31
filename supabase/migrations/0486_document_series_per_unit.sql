-- ============================================================================
-- Raagam ERP — 0486 Phase 4: which document series restart per unit
--
-- The client's 2026-08-31 decision was "every document series restarts per
-- unit". Acting on it literally would have been WRONG for one of the two
-- counters that exist, because it collides with the client's FIRST decision of
-- the same day — that units share ONE master list.
--
-- This migration changes no counter. It records the collision, resolves it, and
-- asserts the resolution, so that the next reader who finds "every series per
-- unit" written down does not "fix" `garment_style_code_counters` and re-mint
-- issued style codes.
--
--
-- ## THERE ARE EXACTLY TWO COUNTERS, AND THEY ANSWER DIFFERENTLY
--
--   sales_order_no_counters      (location_id, fy)   per-unit    — CORRECT
--   garment_style_code_counters  (fy)                global      — CORRECT
--
-- An SC No names a DOCUMENT. A document is raised by one GST entity, appears in
-- that entity's books, and its series is exactly what an auditor expects to run
-- unbroken per company. 0395 already built this, self-test and all: a second
-- location's first order reads 0001, not 0003.
--
-- A style code names a MASTER. `garment_styles` carries no `location_id` at all
-- (verified against the catalog, not assumed) — a style is one of the shared
-- master records decision 1 puts in a single list. Making its counter per-unit
-- would require styles to become unit-scoped, which is the direct negation of
-- that decision: the same style would need a row per unit, and STL/26-27/0001
-- would name two different garments.
--
-- So: **a DOCUMENT series is per unit; a MASTER series is global.** That is the
-- rule, and it decides every counter added later without another conversation.
--
--
-- ## AND CHANGING IT WOULD HAVE BEEN SILENTLY DESTRUCTIVE
--
-- 0431 documents the trap in full and it applies verbatim here. The counter's
-- primary key IS the key `on conflict` matches on. Widen it to
-- (location_id, fy) and `on conflict (fy)` matches nothing: a fresh row is
-- inserted at last_no = 1 and the series RESTARTS MID-YEAR, re-issuing
-- STL/26-27/0001 while STL/26-27/0007 is already out.
--
-- It fails silently, which is the part worth dwelling on. The composed strings
-- differ, so the unique index on `garment_styles.code` never fires. Nothing
-- errors. There are 7 styles today and the counter reads 7; a duplicate would
-- surface as two garments answering to one code, discovered by a person, later.
--
--
-- ## PO / GRN / DC ARE NOT NUMBERED BY COUNTERS YET
--
-- The catalog holds two counter tables and no others. Every future document
-- series therefore gets this decision for free IF it is written to the 0395
-- shape — `(location_id, fy)` primary key, upserted in the trigger. Doing that
-- at birth costs nothing; retrofitting it costs the re-minting hazard above.
-- That is the whole reason this file exists rather than a comment in a ticket.
-- ============================================================================

-- ==========================================================================
-- 1. Write the rule where the next reader will be standing
-- ==========================================================================
comment on table public.sales_order_no_counters is
  'Running SC No per (location, fiscal year). Resets each April by virtue of a new fy key rather than by anything resetting it. No DELETE policy: dropping a row restarts that branch at 0001 and mints duplicates. location-scope: exempt -- the allocator itself. Its rows are not data anyone reads, and a policy here can only fail an INSERT mid-allocation and strand a document number. PER-UNIT BY DESIGN (0395, client 2026-08-31): an SC No names a DOCUMENT, and a document belongs to one GST entity.';

comment on table public.garment_style_code_counters is
  'Running style serial per fiscal year, GLOBAL ACROSS UNITS BY DESIGN (0486). A style code names a MASTER, and units share one master list (client 2026-08-31) — garment_styles carries no location_id. Do NOT widen this primary key to (location_id, fy) to satisfy "every series per unit": that rule is about DOCUMENT series, and widening the key makes `on conflict (fy)` match nothing, restarting the series mid-year and silently re-issuing codes already in use (see 0431).';

-- ==========================================================================
-- 2. Assert the resolution, from the catalog
--
--    These are not decoration. Each one fails loudly if a later migration
--    "corrects" one of the two counters toward the other.
-- ==========================================================================
do $$
declare
  v_def text;
begin
  -- 2a. SC No stays PER-UNIT. If someone narrows this to (fy), two units start
  --     sharing one series and Unit 2's first order reads 0008.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.sales_order_no_counters'::regclass and c.contype = 'p';

  if v_def is null or v_def !~ 'location_id' or v_def !~ 'fy' then
    raise exception '0486: sales_order_no_counters must key on (location_id, fy) — found %', coalesce(v_def, '<none>');
  end if;

  -- 2b. The style counter stays GLOBAL. This is the assertion that stops a
  --     well-meaning reading of "every series per unit" from re-minting codes.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.garment_style_code_counters'::regclass and c.contype = 'p';

  if v_def is null or v_def ~ 'location_id' then
    raise exception '0486: garment_style_code_counters must stay keyed on (fy) alone — a style is a shared master, and widening this key restarts the series mid-year (0431). Found %', coalesce(v_def, '<none>');
  end if;

  -- 2c. The premise of 2b, stated so it cannot rot: styles are shared. If a
  --     later migration gives garment_styles a location_id, the reasoning above
  --     no longer holds and this decision must be revisited deliberately rather
  --     than left standing on a fact that changed underneath it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_styles'
      and column_name = 'location_id'
  ) then
    raise exception '0486: garment_styles grew a location_id. The style counter is global BECAUSE styles are shared masters; that premise no longer holds. Revisit 0486 rather than deleting this check.';
  end if;

  -- 2d. Exactly two counter tables. A third added later inherits neither
  --     decision by default, and this is where its author finds out.
  if (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname like '%\_counters') <> 2 then
    raise exception '0486: the number of *_counters tables changed. A new document series must key on (location_id, fy) like 0395; a new master series stays global like garment_style_code_counters. Decide, then update this assertion.';
  end if;
end $$;
