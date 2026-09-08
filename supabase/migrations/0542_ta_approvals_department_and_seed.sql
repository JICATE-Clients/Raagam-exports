-- ============================================================================
-- Raagam ERP — 0542 TA Approvals: department column, the doc's 10 new
-- milestones, and a real uniqueness guarantee
--
-- `doc/approval.md` is a developer handover spec for a 16-milestone Approvals
-- Engine. Research this session found this app already has a substantial,
-- unmerged head start (the `ta-approvals-engine` branch, live on this same
-- database): `ta_approvals` (8 seeded milestones: FIT SAMPLE, PHOTO SAMPLE,
-- SIZE SET, SMS, LAP DIP, STRIKE-OFF, TRIMS APPROVAL, PP SAMPLE),
-- `customer_approval_defaults` and `garment_order_amendment_ta_approvals`.
--
-- CLIENT DECISION (2026-09-07): the milestone list is a UNION, not a
-- replacement — all 8 existing rows stay, and the 10 genuinely new names the
-- doc adds are seeded alongside them (18 total). Two of the doc's 16 —
-- Photo Sample and SMS — are simply not named in the doc; they are NOT
-- removed, because nothing asked for that and a master row someone may
-- already be relying on does not get deleted to match an external document's
-- omission.
--
-- ## `department`, ADDED NOW BECAUSE THE MASTER IS GETTING A REAL SCREEN
--
-- The doc's dictionary carries a "Responsible Department" column; this table
-- never had one; every row today is MERCHANDISING in practice (a fact, not a
-- constraint) so the column is added with that as its default rather than
-- inventing per-row values nobody has stated. Mirrors `ta_activities
-- .department` (0035) — the production ladder's own master already has this
-- exact column, for the same reason.
--
-- ## `short_name` GETS A REAL UNIQUE CONSTRAINT
--
-- `ta_approvals` had none — nothing stopped a second "PPSAMPLE" row, which
-- would break the PP-Sample bridge in `lib/orders/amendments/actions.ts`
-- (`.ilike("short_name", "PPSAMPLE").maybeSingle()` — a SECOND match there is
-- silently ambiguous, `maybeSingle()` throws on more than one row). The new
-- master screen also needs this for its own dup-check to mean anything at the
-- database layer, not just in the browser.
-- ============================================================================

alter table public.ta_approvals
  add column if not exists department text not null default 'MERCHANDISING';

comment on column public.ta_approvals.department is
  'Responsible department for this approval milestone (doc/approval.md §2). Every row is MERCHANDISING in practice today; the column exists so the master screen has a real field rather than an assumed constant.';

-- Idempotent: safe to re-run, and this is what the master screen's own
-- dup-check ultimately answers to.
create unique index if not exists uq_ta_approvals_short_name
  on public.ta_approvals (short_name);


-- ---------- the 10 new milestones -------------------------------------------
--
-- All BEFORE_SHIPMENT_DATE — every one of these, like the 6 existing sample/
-- technical approvals they sit beside (Lap Dip, Strike-off, Trims, PP Sample),
-- is a pre-production technical checkpoint the buyer must clear before
-- shipment, not a lead-in scheduled off the order date the way Fit Sample /
-- Photo Sample / Size Set / SMS are. `sequence` continues after the existing
-- 8 (1-8 already taken — verified from the catalog immediately below, not
-- assumed from the seed migration's own text).

do $seed$
declare
  v_next_seq int;
begin
  select coalesce(max(sequence), 0) + 1 into v_next_seq from public.ta_approvals;

  insert into public.ta_approvals
    (short_name, name, apply_condition, standard_days, sequence, requires_proof, department, is_active)
  values
    ('PILOTRUN',  'PILOT RUN APPROVAL',          'BEFORE_SHIPMENT_DATE', 10, v_next_seq + 0, true, 'MERCHANDISING', true),
    ('SHIPSAMPLE','SHIPMENT SAMPLE APPROVAL',    'BEFORE_SHIPMENT_DATE', 7,  v_next_seq + 1, true, 'MERCHANDISING', true),
    ('FABLABTEST','FABRIC LAB TEST APPROVAL',    'BEFORE_SHIPMENT_DATE', 14, v_next_seq + 2, true, 'MERCHANDISING', true),
    ('WHITESEAL', 'WHITE SEAL SAMPLE APPROVAL',  'BEFORE_SHIPMENT_DATE', 7,  v_next_seq + 3, true, 'MERCHANDISING', true),
    ('BLACKSEAL', 'BLACK SEAL SAMPLE APPROVAL',  'BEFORE_SHIPMENT_DATE', 7,  v_next_seq + 4, true, 'MERCHANDISING', true),
    ('GOLDSEAL',  'GOLD SEAL SAMPLE APPROVAL',   'BEFORE_SHIPMENT_DATE', 7,  v_next_seq + 5, true, 'MERCHANDISING', true),
    ('BASEHANGER','BASE HANGER APPROVAL',        'BEFORE_SHIPMENT_DATE', 5,  v_next_seq + 6, true, 'MERCHANDISING', true),
    ('BULKHANGER','BULK HANGER APPROVAL',        'BEFORE_SHIPMENT_DATE', 5,  v_next_seq + 7, true, 'MERCHANDISING', true),
    ('FPTTEST',   'FPT TESTING APPROVAL',        'BEFORE_SHIPMENT_DATE', 10, v_next_seq + 8, true, 'MERCHANDISING', true),
    ('GPTTEST',   'GPT TESTING APPROVAL',        'BEFORE_SHIPMENT_DATE', 10, v_next_seq + 9, true, 'MERCHANDISING', true)
  on conflict do nothing;
end $seed$;


-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_count int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ta_approvals' and column_name = 'department'
  ) then
    raise exception '0542: department was not added';
  end if;

  select count(*) into v_count from public.ta_approvals;
  if v_count <> 18 then
    raise exception '0542: expected 18 ta_approvals rows after seeding, found %', v_count;
  end if;

  if exists (
    select 1 from public.ta_approvals group by sequence having count(*) > 1
  ) then
    raise exception '0542: two approvals now share a sequence number';
  end if;

  -- The unique index actually refuses a duplicate short_name.
  begin
    insert into public.ta_approvals (short_name, name, apply_condition)
    values ('PPSAMPLE', '__0542_probe', 'BEFORE_SHIPMENT_DATE');
    raise exception '0542: short_name admitted a duplicate of an existing row';
  exception when unique_violation then
    null; -- expected
  end;
end $assert$;
