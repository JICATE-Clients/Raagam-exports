-- 0721 — SAMPLE ENTRY'S MERCHANDISER IS AN HR ▸ STAFF MEMBER
--
-- Saving a Sample Entry failed with
--   insert or update on table "opportunities" violates foreign key
--   constraint "opportunities_merchandiser_id_fkey"
-- because the screen's Merchandiser picker lists HR ▸ Staff
-- (`getMerchandisers` → `listOrderPeople`, 0674's one people list) while
-- `opportunities.merchandiser_id` still referenced `profiles` (logins). A staff
-- id is never a profile id, so EVERY pick was refused.
--
-- The same save stamps the merchandiser on each style line, and
-- `styles.merchandiser_id` already references `staff` — so the header was the
-- one column of the two still pointing at the wrong table. 0674 moved Order
-- Entry's column (`garment_order_amendments.merchandiser_id`) the same way.
--
-- No row holds a value today (8 opportunities, 0 merchandisers, checked
-- 2026-10-13), so nothing is cleared; the guard below only makes a re-run safe.

update public.opportunities o
   set merchandiser_id = null
 where merchandiser_id is not null
   and not exists (select 1 from public.staff s where s.id = o.merchandiser_id);

alter table public.opportunities
  drop constraint if exists opportunities_merchandiser_id_fkey,
  add constraint opportunities_merchandiser_id_fkey
    foreign key (merchandiser_id) references public.staff (id) on delete set null;
