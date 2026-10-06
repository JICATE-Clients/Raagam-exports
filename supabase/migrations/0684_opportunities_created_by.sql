-- ============================================================================
-- Raagam ERP — 0684 opportunities.created_by
--
-- Sample Entry (0683) lists enquiries with the house's Created Date / Created
-- User pair (AGENTS.md "Created Date / Created User"), and `opportunities` was
-- one of the tables 0383 / 0388 never reached: it has `owner_id` (defaulting to
-- the creator) but no `created_by`. `owner_id` is the SALES OWNER and can be
-- reassigned, so reading it as the creator would print the wrong person the
-- day an enquiry changes hands.
--
-- NO BACKFILL — 0383's stated rule: inventing a creator is a lie in an audit
-- column. The 3 rows that exist read "—".
-- ============================================================================
alter table public.opportunities
  add column if not exists created_by uuid default auth.uid() references public.profiles(id) on delete set null;
