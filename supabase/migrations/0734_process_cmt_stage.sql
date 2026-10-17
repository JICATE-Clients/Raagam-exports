-- 0734 · Process master: the CMT production STAGE, and a standard rate (2026-10-17).
--
-- The "CMT Process Master" spec (Cutting · Sewing · Checking · Ironing · Packing,
-- each holding sub-operations such as Size Stickering or Thread Trimming) is NOT a
-- new master. 0691 already put CMT operations on the Process master
-- (`garment_kind = 'cmt'`), and Sample Costing's CMT lines already point at
-- `processes` (0692). A second list of the same operations would leave two
-- places to add "SIZE STICKERING", and the costing could read only one of them.
-- So the two facts the spec adds are columns on `processes`:
--
--   cmt_stage      which of the five stages the operation belongs to. Sample
--                  Costing ▸ CMT operations narrows its operation picker to the
--                  stage picked beside it. Only meaningful on a CMT operation,
--                  so the check refuses it on anything else. Required on the
--                  Process form while the kind is CMT (`cmtStageProblem` in
--                  process-types.ts, read by the screen AND both actions).
--                  NOT NOT NULL here: a CMT row added since 0691 and never
--                  staged must still load; the form holds it on its next save.
--   standard_rate  ₹ per piece, OPTIONAL. Pre-fills a costing line's rate when
--                  the operation is picked and the rate is still blank. It is a
--                  starting figure, never a price: the costing line keeps its
--                  own rate, and changing the master never rewrites a costing.
--
-- The spec's "Operation Type" is the existing garment kind (CMT operation /
-- Embellishment). Its third word, "Special Process", has no home in the costing
-- (a line is CMT or Embellishment, 0692's check), so it is not added.
--
-- SEEDED BY EXACT NAME ONLY, as 0691 was. No row is inserted: the spec's
-- sub-operations are the operator's to add on the Process master.

alter table public.processes add column if not exists cmt_stage text;
alter table public.processes add column if not exists standard_rate numeric;

alter table public.processes drop constraint if exists processes_cmt_stage_check;
alter table public.processes
  add constraint processes_cmt_stage_check
  check (
    cmt_stage is null
    or (cmt_stage in ('cutting', 'sewing', 'checking', 'ironing', 'packing') and garment_kind = 'cmt')
  );

alter table public.processes drop constraint if exists processes_standard_rate_check;
alter table public.processes
  add constraint processes_standard_rate_check
  check (standard_rate is null or standard_rate >= 0);

update public.processes
   set cmt_stage = case upper(btrim(name))
                     when 'CUTTING'   then 'cutting'
                     when 'STITCHING' then 'sewing'
                     when 'SEWING'    then 'sewing'
                     when 'CHECKING'  then 'checking'
                     when 'IRONING'   then 'ironing'
                     when 'PRESSING'  then 'ironing'
                     when 'PACKING'   then 'packing'
                   end
 where garment_kind = 'cmt'
   and cmt_stage is null
   and upper(btrim(name)) in ('CUTTING', 'STITCHING', 'SEWING', 'CHECKING', 'IRONING', 'PRESSING', 'PACKING');
