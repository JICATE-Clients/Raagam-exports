-- 0774 — PO line: Ply apart from Gauge, and LL (cm) as free text (user 2026-10-31).
--
-- 1. PLY. Raise PO's fabric spec had one "Ply / Gauge" box, so the knitter's PO
--    carried "2 PLY 24 GG" as one string in `gauge`. Ply is its own field now:
--    `po_line_items.ply`, text ("SINGLE", "2-PLY"), NULL when not stated.
--
-- 2. LL (cm), FREE TEXT. `loop_length` was numeric in millimetres (0762). The
--    operator writes "2.80", "2.85-2.90", "AS PER SAMPLE" — none of which a number
--    column can hold — and the unit is now centimetres. The one value on record
--    (30 mm) is carried across as 3 cm, so the PO still says what it said.
--    `order_fabric_bom_manual_entries.loop_length` is NOT changed: the BOM no longer
--    edits it (2026-10-30), it holds no values, and `po_fabric_specs` still reads it
--    as a pre-fill only.

alter table public.po_line_items
  add column if not exists ply text;

alter table public.po_line_items
  alter column loop_length type text
  using case
    when loop_length is null then null
    else trim(trailing '.' from trim(trailing '0' from (loop_length / 10)::numeric(12, 3)::text))
  end;

comment on column public.po_line_items.ply is
  'Fabric ply as typed on Raise PO (0774) — free text, separate from gauge.';
comment on column public.po_line_items.loop_length is
  'LL (cm) as typed on Raise PO (0774) — free text: a figure, a range or a note. Was numeric mm (0762).';
