-- ===========================================================================
-- 0549 — one phone number per address, not two.
--
-- 0535 gave each address a `phone` AND a `mobile`, because the legacy screen
-- draws both. The client keeps one (2026-09-09: "why 2 keep only phone") — a
-- landline and a mobile against the same address is a distinction nobody here
-- maintains, and two boxes for one fact is two places for it to be stale.
--
-- `phone` is the survivor because that is the one the client named. It is not a
-- landline-only column: whatever number reaches the person at that address goes
-- in it.
--
-- Checked before writing: 0 staff rows, 0 with either mobile set. Nothing to
-- carry across — and unlike 0547 there is nowhere to carry it TO, so this drops
-- rather than migrates. `if exists` keeps it re-runnable.
--
-- THE CONTACT GRIDS ARE UNTOUCHED. `staff_external_references` and
-- `staff_emergency_contacts` (0547) keep both numbers: those rows are OTHER
-- PEOPLE, reached in an emergency, where a mobile is the one that answers. The
-- address block is about a place; a referee is about a person.
-- ===========================================================================

alter table public.staff
  drop column if exists perm_mobile,
  drop column if exists corr_mobile;

comment on column public.staff.perm_phone is
  'The contact number at the permanent address. `perm_mobile` was dropped in 0549 — one number per address, per the client.';

comment on column public.staff.corr_phone is
  'The contact number at the correspondence address. See perm_phone. 0549.';
