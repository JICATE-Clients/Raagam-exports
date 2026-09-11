-- ============================================================================
-- Raagam ERP — 0555 Approvals Worklist ▸ dispatch details: Send Time and a
-- typed Courier Proof / Reference, plus the Expected Approval Date it feeds.
--
-- doc/ui/order/tafollowup.md §2 asks the dispatch action to capture a Send
-- Time alongside the existing Send Date, and a "Courier Proof / Reference"
-- that may be a waybill scan OR a typed tracking/reference number — today
-- `markApprovalSent` (lib/ta/approvals-worklist-actions.ts) only ever writes
-- a `proof_path` from an uploaded file. Both new columns are nullable: a
-- courier dispatch is often only known to the day, and a scanned file
-- remains a fully legitimate proof on its own with no reference typed.
--
-- ADDED TO THE HISTORY TABLE TOO (0544). `markApprovalRework` freezes a
-- point-in-time COPY of the live row before resetting it for the next
-- attempt — a rejected attempt's dispatch time/reference has to travel into
-- that archive the same way actual_sent_date and proof_path already do, or
-- the History sheet silently drops them the first time a sample is reworked.
-- ============================================================================

alter table public.garment_order_amendment_ta_approvals
  add column if not exists actual_sent_time time,
  add column if not exists proof_reference text;

comment on column public.garment_order_amendment_ta_approvals.actual_sent_time is
  'Clock time the sample was actually dispatched, alongside actual_sent_date. Nullable — optional on the dispatch modal (doc/ui/order/tafollowup.md §2).';
comment on column public.garment_order_amendment_ta_approvals.proof_reference is
  'A typed courier/waybill/tracking reference, independent of proof_path (an uploaded scan). Either satisfies "Courier Proof / Reference" when the approval requires proof.';

alter table public.garment_order_amendment_ta_approval_history
  add column if not exists actual_sent_time time,
  add column if not exists proof_reference text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approvals'
      and column_name = 'actual_sent_time'
  ) then
    raise exception '0555: actual_sent_time was not added to garment_order_amendment_ta_approvals';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approvals'
      and column_name = 'proof_reference'
  ) then
    raise exception '0555: proof_reference was not added to garment_order_amendment_ta_approvals';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approval_history'
      and column_name = 'actual_sent_time'
  ) then
    raise exception '0555: actual_sent_time was not added to garment_order_amendment_ta_approval_history';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approval_history'
      and column_name = 'proof_reference'
  ) then
    raise exception '0555: proof_reference was not added to garment_order_amendment_ta_approval_history';
  end if;
end $$;
