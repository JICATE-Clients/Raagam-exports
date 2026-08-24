-- ============================================================================
-- Raagam ERP — 0462 Order Info ▸ Styles Details: Season and Year come back OUT
--
-- 0461 added four columns to `garment_order_amendment_styles` so the Style
-- master's header fields could be entered on the order line. Two of them are
-- withdrawn here, unused, before anything writes to them —
-- `approved_sample_id` and `style_category_id` stay and are wired.
--
-- THIS IS NOT A CHANGE OF MIND. It is two EXPLICIT client decisions that 0458
-- did not read before adding the columns, both recorded in
-- `amendment-screen.tsx` where the header fields are rendered:
--
--   * Season — 2026-08-11: "They stay in the header — the client was explicit
--     that they belong here and NOT ON THE STYLE ROWS, where they have never
--     been." Season is also a live FACET on the order header: it is the second
--     thing narrowing the Style picker (`styleOptionsFor`), so it has a job at
--     order level that it would not have per line.
--
--   * Year — 2026-08-14, withdrawn from the order ENTIRELY: "the year is
--     already defined on the linked Style Master (`style_year`), so re-typing
--     it on the order was a second place to state one fact." Putting a Year
--     cell on the style row is precisely the thing that sentence refused, and
--     it would be re-added one level further in.
--
-- So the answer to "bring the whole Style entry onto the line" is FIVE fields,
-- not seven: Approved Sample No, Article No., Style Category, Style Description
-- and the Coordinates grid. The order already states its season, and the year
-- is the master's alone.
--
-- DROPPED RATHER THAN LEFT STANDING. A column nothing reads and nothing writes
-- is a column the next reader will wire up, and there is a live instruction
-- against wiring these two. They were created minutes earlier in the same
-- session and hold ZERO rows, so nothing is lost — which is the only condition
-- under which this module drops rather than freezes (0408's rule: freezing
-- protects STORED VALUES, and there are none).
--
-- `garment_order_amendments.season` (the header's own) and `amend_year` are
-- UNTOUCHED. This is only about the per-style copies.
-- ============================================================================

alter table public.garment_order_amendment_styles
  drop column if exists season,
  drop column if exists style_year;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog: the two are gone, the two that
-- earned their place are still here, and the header's own season is untouched.
-- ----------------------------------------------------------------------------

do $verify$
declare
  gone_cols  int;
  kept_cols  int;
  header_col int;
begin
  select count(*) into gone_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_styles'
     and column_name in ('season', 'style_year');
  if gone_cols <> 0 then
    raise exception '0462: % of (season, style_year) survived on the style line', gone_cols;
  end if;

  select count(*) into kept_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_styles'
     and column_name in ('approved_sample_id', 'style_category_id');
  if kept_cols <> 2 then
    raise exception '0462: the drop took approved_sample_id / style_category_id with it (found %)', kept_cols;
  end if;

  select count(*) into header_col
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendments'
     and column_name in ('season', 'amend_year');
  if header_col <> 2 then
    raise exception '0462: the ORDER HEADER lost season / amend_year (found %)', header_col;
  end if;
end $verify$;
