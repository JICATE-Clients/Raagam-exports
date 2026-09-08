-- ============================================================================
-- Raagam ERP — 0540 A T&A activity can be BYPASSED before it is DONE
--
-- On the shop floor, departments do not wait for a full block to finish
-- before the next one starts: the first 500 pieces Sewing finishes on day one
-- are routed to Checking and Ironing immediately, well ahead of the date the
-- production ladder scheduled for that step. The T&A worklist
-- (`lib/ta/worklist.ts`, `app/(app)/orders/ta-worklist/`) has no way to record
-- that today — only `status`/`actual_date`, which mean "the WHOLE activity is
-- done", a claim that is false until the last piece clears it.
--
-- NOT A FOURTH `status` VALUE. 0481's own header (the migration that gave
-- this table its `status` column) argues explicitly against extending that
-- vocabulary: those three values are the state machine the worklist buckets
-- rows by, and a fourth spelling would not read as a new option, it would
-- read as a row in no bucket and no worklist. A bypass is a genuinely
-- INDEPENDENT signal — an activity can be `in_progress` (or even `pending`)
-- and ALSO have pieces already bypassed ahead of it — so it gets its own pair
-- of columns beside `status`, never inside it.
--
-- NULL IS "NOTHING REGISTERED YET", NOT ZERO. Same convention `days_required`
-- already uses on this table: 0 is a real (if strange) answer, so the column
-- must be able to say "no bypass has been logged" without borrowing a number
-- that could also be a genuine one.
-- ============================================================================

alter table public.garment_order_amendment_ta_activities
  add column if not exists bypassed_qty integer,
  add column if not exists bypassed_at date;

comment on column public.garment_order_amendment_ta_activities.bypassed_qty is
  'Cumulative pieces routed past this activity ahead of its own scheduled target_date (0540). NULL = nothing registered; independent of status/actual_date, which describe the activity as a whole.';
comment on column public.garment_order_amendment_ta_activities.bypassed_at is
  'The date the most recent bypassed_qty was registered. NULL alongside bypassed_qty NULL.';

alter table public.garment_order_amendment_ta_activities
  drop constraint if exists garment_order_amendment_ta_activities_bypassed_qty_check;

alter table public.garment_order_amendment_ta_activities
  add constraint garment_order_amendment_ta_activities_bypassed_qty_check
  check (bypassed_qty is null or bypassed_qty > 0);

-- `bypassed_qty <= the order's own total pieces` is NOT expressible as a
-- CHECK here — the ceiling lives on `garment_order_amendment_styles.po_qty`,
-- summed across a different table entirely, and a CHECK cannot see another
-- table's rows. That ceiling is enforced in `registerBypass()`
-- (`lib/ta/worklist-actions.ts`), the same place the read side
-- (`lib/ta/worklist.ts`) already sums `orderQty`.


-- ---------- assertions ------------------------------------------------------

do $assert$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'garment_order_amendment_ta_activities'
       and column_name  = 'bypassed_qty'
  ) then
    raise exception '0540: bypassed_qty was not added';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'garment_order_amendment_ta_activities'
       and column_name  = 'bypassed_at'
  ) then
    raise exception '0540: bypassed_at was not added';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_ta_activities'::regclass
       and conname  = 'garment_order_amendment_ta_activities_bypassed_qty_check'
  ) then
    raise exception '0540: the bypassed_qty > 0 CHECK was not created';
  end if;

  -- `status` is untouched — still exactly the three values 0481 declared.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_ta_activities'::regclass
       and conname  = 'garment_order_amendment_ta_activities_status_check'
       and pg_get_constraintdef(oid) = $$CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'done'::text])))$$
  ) then
    raise exception '0540: the status CHECK changed shape — bypass must never become a 4th status value';
  end if;
end $assert$;
