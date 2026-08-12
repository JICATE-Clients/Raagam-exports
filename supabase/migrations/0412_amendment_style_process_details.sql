-- ============================================================================
-- Raagam ERP — 0412 Garment Order Amendment ▸ Style(s) ▸ Process ▸ "Details"
--
-- The legacy Process Details grid is FOUR columns, not two (client screenshot
-- 2026-08-12, 10:15):
--
--   S No · Type · Process · Details
--
-- 0411 built Type and Process. This adds the fourth. `S No` is the row's
-- position and is rendered by `ChildGrid`, not stored — `sno` already carries it.
--
--
-- FREE TEXT, AND THE EVIDENCE FOR THAT IS THE MISSING ICON
--
-- Every field in this app that resolves to a master carries the legacy ⓘ glyph,
-- and the standing icon-field rule turns each one into a searchable dropdown.
-- In the reference screenshot the Process cell HAS that icon, in red; the
-- Details cell has none, and is a plain wide box. So Details is a remark the
-- operator types, not a second lookup.
--
-- That reading is worth stating because `processes.has_sub_categories` (0227)
-- exists and would be the obvious candidate for a "details" picker. It is NOT
-- what this column is: a sub-category would have carried an icon like every
-- other lookup on the screen. If the client later says Details should offer a
-- process's sub-categories, this column becomes an FK and the text is migrated —
-- but guessing that now would have put a dropdown where the operator expects to
-- type, which is the harder mistake to notice.
--
--
-- NOT CAPSED
--
-- The CAPITALS rule is for a field's stored VALUE where that value is a name.
-- This is a free-text remark, the same category as `<Textarea>` content, which
-- doc/ui/LAYOUT.md §11 exempts by construction. Capsing an operator's note would
-- shout it back at them.
--
-- NULLABLE, like both columns 0411 added, and for the identical reason: a row
-- mid-typing has no answer yet, and `normalizeStyleProcesses` drops the row
-- rather than the database refusing it.
-- ============================================================================


alter table public.garment_order_amendment_style_processes
  add column if not exists details text;

comment on column public.garment_order_amendment_style_processes.details is
  'Free-text remark against one process of one style line. Legacy "Details" column; not a lookup — see 0412.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The column is asserted to be TEXT and NULLABLE rather than merely present: a
-- NOT NULL added by a later hand would turn every half-typed row into a 23502
-- at save time, which is exactly what 0411 leaves its own columns nullable to
-- prevent, and that is not something "the column exists" would catch.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_type text;
  col_null text;
begin
  select data_type, is_nullable into col_type, col_null
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_style_processes'
     and column_name  = 'details';

  if col_type is null then
    raise exception '0412: details column was not added';
  end if;
  if col_type <> 'text' then
    raise exception '0412: details is %, expected text', col_type;
  end if;
  if col_null <> 'YES' then
    raise exception '0412: details is NOT NULL, which makes a half-typed row a save error';
  end if;
end $verify$;
