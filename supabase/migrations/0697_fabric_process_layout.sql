-- 0697 · Fabric Process: a route step may belong to ONE cloth layout (2026-10-09).
--
-- A route was keyed to the FABRIC (0492): one fabric, one route. A fabric cut
-- both Open Width and Tubular (a jersey with an Open Width body and Tubular
-- sleeves) is two different cloths to the dye house and the compactor, with their
-- own steps and losses — Manual already counts them as two entries (`width_form`),
-- and Fabric Process now draws them as two cards.
--
-- `layout` is a THIRD branch axis beside `combo` and `component_id`, read by the
-- same filter (`stagesForGroup`): NULL = the step applies to every layout (every
-- row saved before this, and every fabric cut one way only); 'open_width' /
-- 'tubular' = the step applies to that layout's weight alone.
--
-- Same vocabulary as `manual_entries.width_form`, so a requirement row's layout
-- compares to a step's with no translation. Additive and nullable.

alter table public.order_fabric_bom_processes add column if not exists layout text;

alter table public.order_fabric_bom_processes drop constraint if exists order_fabric_bom_processes_layout_check;
alter table public.order_fabric_bom_processes
  add constraint order_fabric_bom_processes_layout_check
  check (layout is null or layout in ('open_width', 'tubular'));

comment on column public.order_fabric_bom_processes.layout is
  'The cloth layout this step belongs to — open_width or tubular — when the same '
  'fabric is cut both ways and runs a different route in each. NULL = every layout.';
