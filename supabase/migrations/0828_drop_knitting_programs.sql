-- 0828 · DROP knitting_programs (0110) — Knitting Hub Phase 4 (doc/process/knitting-plan.md §2.5).
--
-- 0110's "Process Planning ▸ Knitting Program" table never had a screen or a writer; its only
-- reader was a dashboard count, and it held no rows (checked 2026-11-11). A knitting order is
-- a process order of type knitting since 0825, so keeping this table would leave two answers
-- to "what is being knitted". The dashboard now counts knitting process orders, and the demo
-- seed no longer writes here.

-- The table first: its own policies may call the lv_ helper.
drop table if exists public.knitting_programs;
drop function if exists public.lv_knitting_programs(uuid);
drop sequence if exists public.seq_knitting_program;
