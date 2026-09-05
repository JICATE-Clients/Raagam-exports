-- ============================================================================
-- Raagam ERP — 0536 Slot the PP bridge (Materials In-House → PP Send → PP
-- Approval) into the existing ta_activities ladder, between Dyeing (5) and
-- Cutting (6).
--
-- ORDER MATTERS AND IS NOT ARBITRARY: the PP sample is cut from the BULK
-- fabric, not a swatch — the entire bulk fabric run (Fabric Plan, Yarn
-- Purchase, Knitting, Dyeing) has to be complete and the material physically
-- in-house BEFORE a PP sample can be made and sent, and only after the buyer
-- approves it can bulk Cutting start. So the bridge sits AFTER Dyeing (5),
-- BEFORE Cutting (formerly 6).
--
-- `department` for PPAPPR/PPSEND is 'Merchandising' — the merchandiser owns
-- getting the sample made, sent and chased. MATIH is 'Sourcing' — it is the
-- date Fabric BOM and Accessories BOM read as their own target delivery date.
-- ============================================================================

do $$
begin
  -- Open three slots. Idempotent-ish guard: only shift if CUTTING is still at
  -- its pre-bridge sequence (6) — re-running this file after it has already
  -- succeeded once must not shift the ladder a second time.
  if exists (
    select 1 from public.ta_activities
     where upper(short_name) = 'CUT' and sequence = 6
  ) then
    update public.ta_activities set sequence = sequence + 3 where sequence >= 6;
  end if;
end $$;

insert into public.ta_activities (short_name, name, sequence, department, default_offset_days, is_active)
select v.short_name, v.name, v.sequence, v.department, 0, true
from (values
  ('MATIH',  'MATERIALS IN-HOUSE', 6, 'Sourcing'),
  ('PPSEND', 'PP SEND',            7, 'Merchandising'),
  ('PPAPPR', 'PP APPROVAL',        8, 'Merchandising')
) as v(short_name, name, sequence, department)
where not exists (
  select 1 from public.ta_activities a where upper(a.short_name) = v.short_name
);

-- ----------------------------------------------------------------------------
-- Verify the FULL resulting sequence, by name — not just that 3 rows exist.
-- A wrong sequence produces a complete, plausible, wrong ladder, so this
-- checks every one of the 13 rows' position, not a count.
-- ----------------------------------------------------------------------------
do $verify$
declare
  expected record;
  actual_seq int;
begin
  for expected in
    select * from (values
      ('FABPLAN', 1), ('ACCBOM', 2), ('YRNPUR', 3), ('KNIT', 4), ('DYE', 5),
      ('MATIH', 6), ('PPSEND', 7), ('PPAPPR', 8),
      ('CUT', 9), ('SEW', 10), ('PACK', 11), ('INSP', 12), ('SHIP', 13)
    ) as t(short_name, sequence)
  loop
    select sequence into actual_seq from public.ta_activities
     where upper(short_name) = expected.short_name;
    if actual_seq is null then
      raise exception '0536: activity % is missing entirely', expected.short_name;
    end if;
    if actual_seq <> expected.sequence then
      raise exception '0536: % carries sequence %, expected % — the ladder is wrong, not just short a row',
        expected.short_name, actual_seq, expected.sequence;
    end if;
  end loop;

  raise notice '0536: ok — all 13 production activities in the correct sequence 1..13';
end $verify$;
