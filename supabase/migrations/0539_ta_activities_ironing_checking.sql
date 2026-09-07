-- ============================================================================
-- Raagam ERP — 0539 T&A activities: add Ironing and Checking
--
-- An external "T&A Backward Scheduling Engine" spec asked for a fixed 9-step
-- chain: Inspection, Packing, Ironing, Checking, Sewing, Cutting, PP Approval,
-- PP Send, Material Inhouse. `ta_activities` is this app's OWN open-ended
-- master (an order composes its own ladder by picking rows from it — see
-- `lib/orders/ta/order-ladder.ts`'s header), not a hardcoded chain, so the
-- spec is answered by EXTENDING the master, never replacing it.
--
-- Of the spec's 9 activities, 7 already exist here: FABRIC PLAN, ACCESSORIES
-- BOM, YARN PURCHASE, KNITTING, DYEING, MATERIALS IN-HOUSE, PP SEND,
-- PP APPROVAL, CUTTING, SEWING, PACKING, INSPECTION, SHIPMENT (13 rows total
-- as of this migration — MATERIALS IN-HOUSE / PP SEND / PP APPROVAL were
-- added by the concurrent `ta-approvals-engine` branch's own migrations,
-- already applied to this same live database). PP SEND and PP APPROVAL are
-- deliberately left untouched here: that branch bridges them to a separate
-- `ta_approvals` / `customer_approval_defaults` system (customer-specific
-- lead time, sample-approval tracking with proof), which is out of scope for
-- this migration and should not be duplicated.
--
-- ONLY IRONING AND CHECKING ARE ACTUALLY MISSING. Both are plain, fully
-- operator-editable activities (the spec marks them "Yes" editable) — no new
-- column, no locking mechanism, nothing beyond two ordinary master rows.
--
-- `sequence` IS A SEEDING/LISTING CONVENIENCE, NOT A CONSTRAINT ON ANY SAVED
-- ORDER. `seedTaLadder` reads it only when a BRAND NEW order's ladder is
-- first composed; every order past that point stores its own row order.
-- Renumbering it here to slot Checking/Ironing between Sewing and Packing
-- (the spec's own chronological order: Cutting → Sewing → Checking → Ironing
-- → Packing → Inspection) cannot alter any already-saved ladder.
-- ============================================================================

-- ---------- 1. make room: Packing/Inspection/Shipment shift two places down -

update public.ta_activities
   set sequence = sequence + 2
 where sequence >= 11;  -- PACKING(11→13), INSPECTION(12→14), SHIPMENT(13→15)

-- ---------- 2. the two new activities ---------------------------------------

insert into public.ta_activities (short_name, name, department, sequence, default_offset_days, is_active)
values
  ('CHECK', 'CHECKING', 'Quality',    11, 2, true),
  ('IRON',  'IRONING',  'Finishing',  12, 2, true);

-- ---------- 3. sensible non-zero defaults for the two locked-in-the-spec ----
-- ---------- steps this master already carries ------------------------------
--
-- Neither of these is made non-editable (see header — no locking mechanism
-- was added). `default_offset_days` only PREFILLS a new row's Days when an
-- operator adds it to their ladder; it was 0 for both, which is a real value
-- (an activity with no lead time) rather than the spec's intended 1-day
-- buffer. Bumping the prefill costs nothing for any order that has already
-- saved its own `days_required` — only new rows read this default.

update public.ta_activities
   set default_offset_days = 1
 where short_name in ('INSP', 'MATIH')
   and default_offset_days = 0;


-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_count int;
begin
  select count(*) into v_count from public.ta_activities where short_name in ('CHECK', 'IRON');
  if v_count <> 2 then
    raise exception '0539: expected exactly 2 new activities (CHECK, IRON), found %', v_count;
  end if;

  if exists (
    select 1 from public.ta_activities group by sequence having count(*) > 1
  ) then
    raise exception '0539: two activities now share a sequence number';
  end if;

  if exists (
    select 1 from public.ta_activities
     where short_name in ('CHECK', 'IRON')
       and (default_offset_days is distinct from 2 or department is null)
  ) then
    raise exception '0539: CHECK/IRON did not get their intended department or default days';
  end if;
end $assert$;
