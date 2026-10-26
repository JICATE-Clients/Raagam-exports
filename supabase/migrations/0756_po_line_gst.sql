-- 0756 — GST PER PO LINE (user 2026-10-26, Raise PO).
--
-- One PO can carry thread at 5 %, labels at 12 % and polybags at 18 %, so the slab
-- belongs to the LINE. The header keeps `gst_kind` (CGST+SGST vs IGST — a fact about
-- the vendor's state, the same for every line) and its `gst_pct` becomes the PO's
-- DEFAULT slab, the one a line follows until the Purchase Manager changes it. The
-- header `gst_amount` stays the PO's total GST, now the sum of these lines.
--
-- Nullable, no default: lines saved before today carry their PO header's single slab
-- and nothing here invents a per-line figure for them.

alter table public.po_line_items
  add column if not exists gst_pct    numeric(5,2),
  add column if not exists gst_amount numeric(16,2);

comment on column public.po_line_items.gst_pct is
  'This line''s GST slab in percent (0 / 5 / 12 / 18). NULL on lines saved before 0756 — read the PO header''s gst_pct for those.';
comment on column public.po_line_items.gst_amount is
  'GST on this line, in the PO''s currency: amount × gst_pct / 100. The header gst_amount is the sum.';
