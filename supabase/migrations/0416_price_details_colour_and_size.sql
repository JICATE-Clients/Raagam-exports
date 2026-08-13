-- ============================================================================
-- Raagam ERP — 0416 A price row says WHICH colour and WHICH size it is for
--
-- The Prices tab has carried `price_type` — Style-wise / Color-wise / Size-wise
-- — since 0128, and nothing else. So when a buyer priced per colourway the
-- operator added several rows for one style and NOTHING on the row said which
-- colourway each price belonged to.
--
-- `lib/orders/amendments/order-value.ts` has been recording that gap in prose
-- since it was written, under a heading that says it is a decision rather than
-- a bug:
--
--     "`AmendmentPriceDetail` carries `price_type` ... but NO colour and NO
--      size column. So when a buyer prices per colourway, the operator adds
--      several rows for one style and nothing on the row says which colourway
--      each price is for. The quantities to weight them by are not knowable
--      from the row either. This refuses rather than guessing."
--
-- It refuses by returning null, which is why a Color-wise order has never been
-- able to show an Average Rate or a Gross Value. This migration is the missing
-- half: with the colour and the size on the row, each rate can be weighted by
-- that combination's own quantity, which `garment_order_amendment_assort_lines`
-- and `..._assort_line_sizes` have held since 0414.
--
--
-- WHY `combo` IS TEXT AND `size_id` IS A uuid — they are not inconsistent, they
-- match what each thing already is elsewhere on this document. A combo is named,
-- not chosen: `garment_order_amendment_combos.combo` is text, and so is
-- `..._combo_components.color_name` and the assort line's own `combo`. A size IS
-- a master row: `..._style_sizes.size_id` and `..._assort_sizes.size_id` are both
-- uuid FKs into `config_lookups` kind 'size'. Joining a price to a quantity
-- therefore compares a normalised string on one axis and a uuid on the other,
-- exactly as the Quantities tab already does internally.
--
-- BOTH NULLABLE, and the blank is meaningful rather than missing: a Style-wise
-- row has no colour and no size by definition, and a Size-wise row has a size
-- and no colour. The mode says which columns are answerable, so a NOT NULL on
-- either would make three of the four modes unstorable.
--
-- NO CHECK TYING THEM TO `price_type`. It is tempting — "Color-wise implies a
-- combo" — and it is wrong here for the same reason the GSM rule could not be a
-- CHECK (0397): a half-entered row is a legitimate state on a screen the
-- operator is still filling in, and a constraint would reject the save rather
-- than let the screen say what is missing. The rule lives in `styleRate`, where
-- the Save button and the Order Sheet can both ask it.
--
-- 'Color-wise Size-wise' — the fourth mode — needs no migration at all:
-- `price_type` is text with no CHECK, so the tuple in types.ts is the only
-- declaration. That is recorded here because the next reader will look for the
-- missing statement.
--
-- Safe: `garment_order_amendment_price_details` holds 0 rows (0 amendments).
-- ============================================================================

alter table public.garment_order_amendment_price_details
  add column if not exists combo   text,
  add column if not exists size_id uuid;

alter table public.garment_order_amendment_price_details
  drop constraint if exists garment_order_amendment_price_details_size_id_fkey;

alter table public.garment_order_amendment_price_details
  add constraint garment_order_amendment_price_details_size_id_fkey
  foreign key (size_id) references public.config_lookups(id);

comment on column public.garment_order_amendment_price_details.combo is
  'WHICH COLOURWAY this rate is for (0416) — the combo NAME, matching '
  'garment_order_amendment_combos.combo and the assort line''s own combo text. '
  'NULL on a Style-wise or Size-wise row, where the rate is not per colour.';

comment on column public.garment_order_amendment_price_details.size_id is
  'WHICH SIZE this rate is for (0416) — config_lookups kind ''size'', matching '
  'garment_order_amendment_style_sizes.size_id and ..._assort_sizes.size_id. '
  'NULL on a Style-wise or Color-wise row. Together with `combo` this is what '
  'lets orderValue() weight each rate by that combination''s quantity instead '
  'of refusing to answer.';


-- ---------------------------------------------------------------------------
-- Verify from the catalog: `{"success": true}` means the SQL ran, not that it
-- did what it says.
-- ---------------------------------------------------------------------------
do $verify$
declare
  size_attnum smallint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_price_details'
       and column_name='combo' and data_type='text'
  ) then
    raise exception '0416: price_details.combo missing or not text';
  end if;

  select attnum into size_attnum from pg_attribute
   where attrelid = 'public.garment_order_amendment_price_details'::regclass
     and attname  = 'size_id';
  if size_attnum is null then
    raise exception '0416: price_details.size_id was not added';
  end if;

  -- The FK is the half that would silently not happen: `add column` succeeds on
  -- its own, and an unconstrained uuid accepts a size id from any kind at all.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid  = 'public.garment_order_amendment_price_details'::regclass
       and c.contype   = 'f'
       and c.confrelid = 'public.config_lookups'::regclass
       and c.conkey    = array[size_attnum]
  ) then
    raise exception '0416: price_details.size_id does not point at config_lookups';
  end if;

  -- The weighting this migration exists to enable must be reachable: a price
  -- can only be weighted if a quantity is stored per size AND per combo.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_assort_line_sizes'
       and column_name='size_id'
  ) then
    raise exception '0416: assort_line_sizes.size_id is gone — a rate cannot be weighted by size';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_assort_lines'
       and column_name='combo'
  ) then
    raise exception '0416: assort_lines.combo is gone — a rate cannot be weighted by colour';
  end if;
end $verify$;
