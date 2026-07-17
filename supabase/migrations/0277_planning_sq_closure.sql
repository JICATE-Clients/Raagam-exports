-- ============================================================================
-- Raagam ERP — 0277 Planning ▸ SQ Closure
-- Additive to the existing sq_notes (0025). Legacy EDP2: Planning ▸
-- Materials-Garment Orders ▸ "SQ Closure" — close out an allocated SQ note
-- (allocated → closed) with a closure date + reason, mirroring how SQ
-- Cancellation flips status but capturing who/when/why. Extends the status
-- check with 'closed' and adds the closure columns. Existing sq_notes 'planning'
-- RLS policies already cover the update — no new policies needed.
-- ============================================================================

alter table public.sq_notes drop constraint if exists sq_notes_status_check;
alter table public.sq_notes add constraint sq_notes_status_check
  check (status in ('draft','allocated','cancelled','closed'));

alter table public.sq_notes
  add column if not exists closed_at      timestamptz,
  add column if not exists closed_by      uuid references public.profiles(id),
  add column if not exists closure_reason text;
