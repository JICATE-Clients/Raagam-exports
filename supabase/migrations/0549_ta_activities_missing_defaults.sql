-- ============================================================================
-- Raagam ERP — 0549 Three of the client's named 9-step chain seed with no
-- default lead time
--
-- 0541 named the 9-step default chain (Inspection, Packing, Ironing, Checking,
-- Sewing, Cutting, PP Approval, PP Send, Material Inhouse) via `default_seed`,
-- but never set `default_offset_days` for three of them — PACK, SEW and CUT
-- are still 0, which `seedTaLadder()`
-- (`app/(app)/orders/_garment-order/garment-order-screen.tsx`, `a.
-- default_offset_days > 0 ? String(a.default_offset_days) : ""`) treats as
-- "no default", seeding the row BLANK on a brand-new order.
--
-- This is the master-data half of the same bug already fixed on the screen
-- side this session (`taLadder` reading a row's raw, possibly-blank
-- `days_required` instead of the computed default) — a blank Days box is
-- exactly the row that stops the backward-schedule walk and blanks every
-- activity further from delivery after it (`lib/ta/schedule.ts`,
-- `backwardSchedule`). Fixing the seed does not replace that fix; a reopened
-- OLD order still carries whatever it was last saved with, which is what the
-- screen-side fix covers.
--
-- Values are the client's own stated defaults (spec, 2026-09-10): Packing 2
-- days, Sewing 5 days, Cutting 2 days — matching Ironing and Checking, which
-- already carry 2 (0541's own seed left them alone because they were already
-- right).
-- ============================================================================

update public.ta_activities
   set default_offset_days = 2
 where short_name = 'PACK';

update public.ta_activities
   set default_offset_days = 5
 where short_name = 'SEW';

update public.ta_activities
   set default_offset_days = 2
 where short_name = 'CUT';


-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_pack int;
  v_sew  int;
  v_cut  int;
begin
  select default_offset_days into v_pack from public.ta_activities where short_name = 'PACK';
  select default_offset_days into v_sew  from public.ta_activities where short_name = 'SEW';
  select default_offset_days into v_cut  from public.ta_activities where short_name = 'CUT';

  if v_pack is distinct from 2 then
    raise exception '0549: PACK.default_offset_days expected 2, found %', v_pack;
  end if;
  if v_sew is distinct from 5 then
    raise exception '0549: SEW.default_offset_days expected 5, found %', v_sew;
  end if;
  if v_cut is distinct from 2 then
    raise exception '0549: CUT.default_offset_days expected 2, found %', v_cut;
  end if;
end $assert$;
