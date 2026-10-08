-- 0691 · Process master: what KIND of garment process this is (2026-10-08).
--
-- Sample Costing's Making & charges step lists CMT operations (Cutting, Stitching,
-- Checking, Ironing, Packing …) and Embellishments (Print, Embroidery, Wash …) by
-- PICKING them from the Process master — no hardcoded Print / Embroidery / Wash
-- columns. Which master row is an operation and which is an embellishment is a
-- fact about the process, so it lives on the process: `garment_kind`.
--
-- Additive and nullable: a process with no kind is simply not offered in either
-- picker. It is operator-maintained on the Process master form (a Select shown
-- under "For ▸ Garments"). It is NOT one of the three system kind flags
-- (is_print / is_dyeing / is_knitting) the client removed from the form — those
-- steer the Fabric BOM; this one only sorts the garment charge pickers.
--
-- SEEDED BY EXACT NAME ONLY, for rows that already exist. No row is inserted:
-- the live master has no Cutting / Stitching / Sewing / Checking / Ironing /
-- Pressing / Packing yet, so those are for the operator to add and classify.

alter table public.processes add column if not exists garment_kind text;

alter table public.processes drop constraint if exists processes_garment_kind_check;
alter table public.processes
  add constraint processes_garment_kind_check
  check (garment_kind is null or garment_kind in ('cmt', 'embellishment'));

update public.processes
   set garment_kind = 'cmt'
 where garment_kind is null
   and upper(btrim(name)) in ('CUTTING', 'STITCHING', 'SEWING', 'CHECKING', 'IRONING', 'PRESSING', 'PACKING');

update public.processes
   set garment_kind = 'embellishment'
 where garment_kind is null
   and upper(btrim(name)) in ('PRINTING', 'EMBROIDERY', 'WASHING', 'BIO WASH', 'DIP-WASH');
