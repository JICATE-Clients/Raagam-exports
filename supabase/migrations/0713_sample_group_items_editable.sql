-- 0713 — Sample ▸ Grouping: an SWO's samples stay editable at every status
-- (user 2026-10-12: "allow to edit the created group — there is no option now").
--
-- 0702 froze an SWO's samples the moment it left Draft, because the flow then
-- ran on to a purchase and a distribution that read those rows. That flow was
-- removed the same day (Fabric received → Distribute; the SWO now ends at its
-- IW), so the freeze guards nothing and only stops the planner correcting a
-- batch. The group-DELETE guard (past Draft cannot be deleted) is unchanged.
drop trigger if exists trg_guard_sample_group_items on public.sample_group_items;
drop function if exists public.guard_sample_group_items();
