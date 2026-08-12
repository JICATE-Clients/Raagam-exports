-- ============================================================================
-- Raagam ERP — 0417 Garment Order Amendment ▸ Gross Value and Avg Rate may be NULL
--
-- Both columns were `numeric not null default 0` (0126:53-54), which was right
-- while an operator TYPED them. From 2026-08-12 they are calculated
-- (`lib/orders/amendments/order-value.ts`):
--
--     Gross Value  = SUM over style lines of (PO Qty x that style's rate)
--     Average Rate = Gross Value / total PO Qty
--
-- and a calculation has a third answer a typed field does not: "cannot be
-- determined". The Prices tab records `price_type` (Style-wise / Color-wise /
-- Size-wise) but carries no colour and no size column, so when a buyer prices
-- per colourway the rows cannot be weighted and the line has no single rate.
--
-- WRITING 0 FOR THAT IS A LIE, and an expensive one. A Gross Value of 0 reads
-- as "this order is worth nothing"; worse, a PARTIAL total reads as a correct
-- one — 21,000 on an order actually worth 36,000 looks exactly like an answer,
-- so it gets believed rather than reported. This is the same rule
-- `approval-qty.ts` already states for Projection ("returns NULL, never 0, when
-- it cannot answer") and the same failure AGENTS.md names under Cascading
-- filters, where an empty report reads as a real result.
--
-- NOT NULL is therefore dropped so the honest answer is representable. The
-- default stays 0, so nothing that inserts without these columns changes
-- behaviour, and EVERY EXISTING ROW KEEPS THE 0 IT HAS — this migration does
-- not rewrite history, exactly as 0383 declined to invent a creator for rows
-- that predated its column.
-- ============================================================================

alter table public.garment_order_amendments
  alter column gross_value drop not null,
  alter column avg_rate    drop not null;

comment on column public.garment_order_amendments.gross_value is
  'Calculated: SUM(style PO Qty x style rate), in currency_code. NULL means unanswerable (a style priced per colour/size, or none priced) — never a partial sum. See 0417.';
comment on column public.garment_order_amendments.avg_rate is
  'Calculated: gross_value / total PO Qty, to 6dp. NULL whenever gross_value is. See 0417.';

-- ----------------------------------------------------------------------------
-- Read it back out of the catalog, not out of this file's own success report.
-- ----------------------------------------------------------------------------
do $verify$
declare
  bad text;
begin
  select string_agg(column_name, ', ')
    into bad
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendments'
     and column_name in ('gross_value', 'avg_rate')
     and is_nullable  = 'NO';

  if bad is not null then
    raise exception '0417: still NOT NULL: %', bad;
  end if;

  -- The default must survive: dropping NOT NULL and the default together would
  -- silently turn every legacy insert path's omitted column into a null.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'garment_order_amendments'
         and column_name in ('gross_value', 'avg_rate')
         and column_default is not null) <> 2 then
    raise exception '0417: the default 0 was lost on one of the value columns';
  end if;
end $verify$;
