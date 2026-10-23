-- =====================================================================
-- Remove the simulator's test data before a real device goes live.
--
-- DO NOT RUN THIS ONCE REAL PUNCHES EXIST without checking the serials
-- below are still only the test ones. It deletes by serial number, not by
-- date, so a real reader accidentally registered as TESTSN001 would go too.
--
-- Deletes, deepest first: `punches` references `biometric_devices`
-- (on delete restrict), so the devices cannot go until their punches have.
--
-- Run: Supabase -> SQL Editor -> paste -> Run.
-- =====================================================================

begin;

-- What is about to go, so the numbers can be read BEFORE committing.
select 'punches to delete' as what, count(*) as rows
  from public.punches
 where device_sn in ('TESTSN001', 'TESTSN002')
union all
select 'devices to delete', count(*)
  from public.biometric_devices
 where serial_no in ('TESTSN001', 'TESTSN002')
union all
-- THE SAFETY CHECK. If this is not zero, there are punches from a device
-- that is NOT in the test list — i.e. real data exists. Read it before
-- committing; the delete below does not touch those rows, but their
-- presence means this script is being run later than intended.
select 'punches from OTHER devices (must review)', count(*)
  from public.punches
 where device_sn not in ('TESTSN001', 'TESTSN002');

delete from public.punches
 where device_sn in ('TESTSN001', 'TESTSN002');

delete from public.biometric_devices
 where serial_no in ('TESTSN001', 'TESTSN002');

-- Change to `rollback;` first to see the counts without deleting anything.
commit;
