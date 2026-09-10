-- ============================================================================
-- Raagam ERP — 0550 Drop the orphaned `assigned_employee_id` column
--
-- `garment_order_amendment_ta_activities.assigned_employee_id` exists live in
-- this database with NO migration file that added it and NO reference
-- anywhere in the TypeScript codebase (repo-wide grep, both checked before
-- writing this). It predates and is unrelated to 0547's `assigned_staff_id`,
-- which IS the column this repo's code (`lib/ta/worklist.ts`'s `mineOnly`
-- scoping, `staff_ta_kpi()`) is built against — two columns naming the same
-- concept is exactly the drift AGENTS.md's "one declaration" rules exist to
-- prevent everywhere else in this schema.
--
-- SAFE TO DROP: `select count(*) filter (where assigned_employee_id is not
-- null) from garment_order_amendment_ta_activities` returned 0 of 46 rows at
-- the time this migration was written — nothing depends on it.
--
-- Deliberately its OWN migration, not folded into 0547 — 0547 is complete,
-- self-verifying, purely additive, and already what this repo's in-progress
-- `lib/ta/worklist.ts` changes are written against; editing someone else's
-- finished migration to fold in an unrelated cleanup is not this migration's
-- place to happen.
-- ============================================================================

alter table public.garment_order_amendment_ta_activities
  drop column if exists assigned_employee_id;


-- ---------- assertions ------------------------------------------------------

do $assert$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'garment_order_amendment_ta_activities'
       and column_name  = 'assigned_employee_id'
  ) then
    raise exception '0550: assigned_employee_id still present after drop';
  end if;
end $assert$;
