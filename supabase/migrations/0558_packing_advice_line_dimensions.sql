-- ============================================================================
-- Raagam ERP — 0558 Packing Advice ▸ line Carton Dimensions.
--
-- doc/order/update.md §3.1: "Attributes: Carton Numbering, Dimensions (L x W
-- x H), CBM (calculated), Gross Weight, and Net Weight." Gross/Net Weight
-- already existed on this table since 0033 and were wired up in 0557; there
-- was no dimension column of any kind to wire up for CBM.
--
-- CBM ITSELF IS NOT A COLUMN, DELIBERATELY. It is L x W x H (in metres) x
-- carton count — a pure function of three inputs and `ctns`, which this table
-- already carries. Storing it would be a second, driftable copy of a number
-- the app can always recompute; `lib/orders/packing-advice/cbm.ts` is the one
-- place it is calculated, read by the screen for display and never written
-- back.
--
-- `numeric(10,2)` IN CENTIMETRES, matching how a carton is actually measured
-- and labelled on the shop floor (tape measures read cm, not metres) —
-- `cbm.ts` divides by 100 three times to reach cubic metres.
-- ============================================================================

alter table public.packing_advice_lines
  add column if not exists length_cm numeric(10,2),
  add column if not exists width_cm numeric(10,2),
  add column if not exists height_cm numeric(10,2);

comment on column public.packing_advice_lines.length_cm is
  'Carton length in cm (0558, doc/order/update.md §3.1). Nullable — a carton
   not yet measured leaves this blank rather than reading 0. CBM is derived
   from this + width_cm + height_cm + ctns in lib/orders/packing-advice/cbm.ts,
   never stored.';

comment on column public.packing_advice_lines.width_cm is
  'Carton width in cm (0558). See length_cm''s comment for the full note.';

comment on column public.packing_advice_lines.height_cm is
  'Carton height in cm (0558). See length_cm''s comment for the full note.';
