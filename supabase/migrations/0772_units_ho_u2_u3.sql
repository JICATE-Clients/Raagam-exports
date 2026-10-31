-- 0772 — the units are Raagam HO, Unit 2 and Unit 3 (user 2026-10-31).
--
-- Unit 1 is not used: on the day, 0 users allocated, 0 purchase orders and
-- 0 orders carried it. So the row is RENAMED in place, not deleted and replaced —
-- its id is unchanged, so anything that might point at it later still resolves.
-- Head Office keeps its code (HO, the default unit) and takes the name the client
-- uses for it. Matched on code, so a re-run finds nothing to change.

update public.locations
   set code = 'U3', name = 'Unit 3', updated_at = now()
 where code = 'U1';

update public.locations
   set name = 'Raagam HO', updated_at = now()
 where code = 'HO';
