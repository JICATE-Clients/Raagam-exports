-- 0755 — a PO line's NOTE / REMARK (user 2026-10-26, Raise PO).
--
-- The Purchase Manager's instruction to the vendor for ONE item — "PROCESS: CUT &
-- SEAL", "DTM 3-PLY / SHADE 402", an elastic tension. Typed beside the item on the
-- PO grid (lib/purchase/re-po).
--
-- TWO PLACES, ON PURPOSE. `note` keeps exactly what was typed, so the instruction is
-- never lost inside a longer string. `description` is saved as
-- "MAIN LABEL · L (PROCESS: CUT & SEAL)" — and since the PO print, the PO detail, the
-- GRN feed (grn-service copies the PO line's description into the receipt), QC and the
-- store logs all already read `description`, the note reaches every one of them with
-- no change to any of those screens.
--
-- Nullable, no default: every line saved before today simply has no note.

alter table public.po_line_items
  add column if not exists note text;

comment on column public.po_line_items.note is
  'The Purchase Manager''s item-level instruction to the vendor, as typed (capitals). Also appended to description as "(NOTE)".';
