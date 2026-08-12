-- ============================================================================
-- Raagam ERP — ROLLBACK for 0401_restore_ta_plan_tables
--
-- Run BY HAND, only if 0401's reconstructed shape turns out to be wrong on the
-- shared database. It undoes 0401 exactly and returns the schema to its
-- post-0332 state (TA Plan tables absent, card back to `unavailable`).
--
-- THIS IS DELIBERATELY NOT A NUMBERED MIGRATION. As `supabase/migrations/0402_*`
-- it would run immediately after 0401 on any replay — creating the tables and
-- then dropping them again, in order, every time. A rollback belongs outside
-- the sequence, which is why it sits here beside `demo-data-cleanup.sql` and
-- `sales-order-no-cutover.sql` rather than in `migrations/`.
--
-- BEFORE RUNNING, CHECK FOR DATA. 0401 shipped with these tables empty, but
-- once TA Plan is live an operator can enter plans within minutes, and `cascade`
-- below will take them with no warning:
--
--   select (select count(*) from public.ta_plan_docs)       as plans,
--          (select count(*) from public.ta_plan_activities) as activities;
--
-- Anything other than 0/0 means someone has used the screen. Export first.
--
-- AFTER RUNNING, put the screen back behind its guard or it will 500 rather
-- than grey out:
--   · lib/nav/module-groups.ts  — restore `status: "unavailable"` +
--     `unavailableNote` on the `/orders/ta-plan` child
--   · lib/nav/hub-count-map.ts  — set `"/orders/ta-plan": null`
--
-- Also delete the migration row, or the CLI will believe 0401 is still applied:
--   delete from supabase_migrations.schema_migrations
--    where name = '0401_restore_ta_plan_tables';
-- ============================================================================

-- Children first — `ta_plan_activities` FKs `ta_plan_docs`, and `ta_plan_docs`
-- FKs `shipment_plans`. `cascade` covers it either way; the order documents the
-- dependency rather than relying on it.
drop table if exists public.ta_plan_activities cascade;
drop table if exists public.ta_plan_docs       cascade;
drop sequence if exists public.seq_ta_plan_doc;

-- The shipment_plans STUB. Dropping it is correct here — 0401 created it, and
-- nothing else in this database references it now that ta_plan_docs is gone.
-- If Planning has been rebuilt in the meantime this table is NO LONGER a stub
-- and dropping it would destroy real Planning data, so this statement is left
-- commented out. Uncomment only after confirming Planning is still dropped:
--   select count(*) from public.shipment_plans;   -- 0 = still the empty stub
-- drop table if exists public.shipment_plans cascade;
