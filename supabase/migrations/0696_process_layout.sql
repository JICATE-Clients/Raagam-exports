-- 0696 · Process master: which cloth LAYOUT a process is for (2026-10-09).
--
-- Fabric BOM ▸ Fabric Process offers every process flagged Fabric on every
-- fabric's route. Finishing steps are not layout-neutral: the master already
-- holds COMPACTING [OPEN WIDTH] and COMPACTING [TUBULAR] as two rows, and until
-- now nothing stopped a Tubular rib being given the open-width compactor. The
-- layout is a fact about the PROCESS, so it lives on the process: `layout`.
--
-- NULL means "either" — the ordinary case (Knitting, Dyeing, Stentering, …).
-- Additive and nullable, so every existing row and every saved route reads as
-- before. The picker only ever WITHHOLDS a process whose layout the fabric is
-- not cut in; a route that already holds one keeps it (AGENTS.md, Disabled rows).
--
-- Vocabulary is `order_fabric_bom_lines.layout_type` / `manual_entries.width_form`
-- ('open_width' | 'tubular'), so no translation is needed anywhere.
--
-- SEEDED BY EXACT NAME ONLY, for the two rows that already exist. STENTERING is
-- deliberately left NULL: the spec calls it an open-width step, but the master's
-- own route (standard-routes.ts) runs it before COMPACTING for every fabric, and
-- tagging it would withhold it from a tubular fabric's route without the client
-- having said so. It is an operator choice on the Process master form.

alter table public.processes add column if not exists layout text;

alter table public.processes drop constraint if exists processes_layout_check;
alter table public.processes
  add constraint processes_layout_check
  check (layout is null or layout in ('open_width', 'tubular'));

update public.processes
   set layout = 'open_width'
 where layout is null
   and upper(btrim(name)) = 'COMPACTING [OPEN WIDTH]';

update public.processes
   set layout = 'tubular'
 where layout is null
   and upper(btrim(name)) = 'COMPACTING [TUBULAR]';
