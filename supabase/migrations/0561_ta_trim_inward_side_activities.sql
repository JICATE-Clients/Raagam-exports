-- ============================================================================
-- Raagam ERP — 0561 T&A: Sewing Trims Inward + Packing Trims Inward, as SIDE
-- activities that hang off Cutting / Packing without joining the chain
--
-- Client, 2026-09-15 (T&A Dynamic Backward Scheduling spec, §1 "Single Inward
-- Date Limitation"): every Material BOM item shared ONE arrival date (Materials
-- In-House), but sewing trims (threads, buttons, labels) are needed before
-- CUTTING and packing trims (cartons, polybags, hangers) before PACKING.
--
-- Decisions the client made on 2026-09-15:
--   1. Offsets are OPERATOR-EDITABLE per order with a default preset — so the
--      preset is `default_offset_days` (2), which `seedTaLadder` already
--      prefills into Days, and nothing is pinned.
--   2. MATERIALS IN-HOUSE STAYS as the main-fabric arrival (critical path);
--      the two trim rows are ADDED beside it.
--   3. The worklist's "due" date stays the START date.
--
-- ## WHY A COLUMN AND NOT JUST TWO MORE ROWS
--
-- The ladder (`lib/orders/ta/order-ladder.ts`) is one straight chain: every
-- row is dated back from the row after it. Two ordinary rows slotted before
-- Cutting and Packing would push Cutting, PP Approval, PP Send and Materials
-- In-House back by the trims' lead time — the trims would be ON the critical
-- path they only feed. `anchor_activity_id` is what says "this row is dated
-- off THAT activity's start and takes no time out of the chain". NULL (every
-- existing row) is an ordinary chain step, exactly as before.
--
-- `sequence` only places the rows in the grid (`seedTaLadder` sorts by it);
-- a side row's arithmetic does not read its position. Each is slotted just
-- above the activity it hangs off, so it reads next to what it feeds.
-- ============================================================================

alter table public.ta_activities
  add column if not exists anchor_activity_id uuid
    references public.ta_activities (id) on delete set null;

alter table public.ta_activities
  drop constraint if exists ta_activities_anchor_not_self;
alter table public.ta_activities
  add constraint ta_activities_anchor_not_self check (anchor_activity_id is distinct from id);

comment on column public.ta_activities.anchor_activity_id is
  'SIDE activity (0561): dated N working days (Days) before this activity''s start, and never part of the backward chain, so its lead time cannot push the production path back. NULL = an ordinary chain step.';

-- ---------- the two side activities, each slotted just above its anchor -----

do $seed$
declare
  v_cut  public.ta_activities%rowtype;
  v_pack public.ta_activities%rowtype;
begin
  select * into v_cut  from public.ta_activities where short_name = 'CUT';
  select * into v_pack from public.ta_activities where short_name = 'PACK';
  if v_cut.id is null or v_pack.id is null then
    raise exception '0561: CUT and PACK must exist in ta_activities before trims can hang off them';
  end if;

  if not exists (select 1 from public.ta_activities where short_name = 'SEWTRIM') then
    update public.ta_activities set sequence = sequence + 1 where sequence >= v_cut.sequence;
    insert into public.ta_activities
      (short_name, name, department, sequence, default_offset_days, is_active, default_seed, anchor_activity_id)
    values
      ('SEWTRIM', 'SEWING TRIMS INWARD', 'Stores', v_cut.sequence, 2, true, true, v_cut.id);
  end if;

  if not exists (select 1 from public.ta_activities where short_name = 'PACKTRIM') then
    -- Re-read: the shift above moved PACK down one place.
    select * into v_pack from public.ta_activities where short_name = 'PACK';
    update public.ta_activities set sequence = sequence + 1 where sequence >= v_pack.sequence;
    insert into public.ta_activities
      (short_name, name, department, sequence, default_offset_days, is_active, default_seed, anchor_activity_id)
    values
      ('PACKTRIM', 'PACKING TRIMS INWARD', 'Stores', v_pack.sequence, 2, true, true, v_pack.id);
  end if;
end $seed$;


-- ---------- assertions ------------------------------------------------------

do $assert$
begin
  if not exists (
    select 1 from public.ta_activities t join public.ta_activities a on a.id = t.anchor_activity_id
     where t.short_name = 'SEWTRIM' and a.short_name = 'CUT' and t.default_seed
  ) then
    raise exception '0561: SEWTRIM is not seeded and anchored to CUT';
  end if;

  if not exists (
    select 1 from public.ta_activities t join public.ta_activities a on a.id = t.anchor_activity_id
     where t.short_name = 'PACKTRIM' and a.short_name = 'PACK' and t.default_seed
  ) then
    raise exception '0561: PACKTRIM is not seeded and anchored to PACK';
  end if;

  if exists (select 1 from public.ta_activities where short_name = 'MATIH' and anchor_activity_id is not null) then
    raise exception '0561: MATERIALS IN-HOUSE must stay on the chain (client 2026-09-15)';
  end if;

  -- Scoped to the two new rows: a pre-existing duplicate elsewhere is not this
  -- migration's to fix, and must not abort it.
  if exists (
    select 1 from public.ta_activities t
     where t.short_name in ('SEWTRIM', 'PACKTRIM')
       and exists (select 1 from public.ta_activities o where o.sequence = t.sequence and o.id <> t.id)
  ) then
    raise exception '0561: a trim activity shares its sequence number with another activity';
  end if;
end $assert$;
