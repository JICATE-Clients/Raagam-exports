-- ============================================================================
-- Raagam ERP — 0479 Orders ▸ Order Management ▸ Order Entry ▸ Styles Details:
-- a document belongs to a STYLE LINE, not to the order
--
-- Client 2026-08-31: "Add File" moves off the order header and onto each row of
-- Styles Details, and a style cannot be saved without one.
--
-- Adds `garment_order_amendment_files.style_ref_no`.
--
--
-- ## THE KEY, AND WHY IT IS NOT A uuid AND NOT AN ORDINAL
--
-- This is the one choice in the migration and getting it wrong is silent.
--
-- `writeChildren` (lib/orders/amendments/actions.ts) DELETES AND REINSERTS every
-- child grid wholesale on each save:
--
--     delete from <child> where amendment_id = ...   -- all of them
--     insert  into <child> ...                        -- all of them, again
--
-- So `garment_order_amendment_styles.id` is a DIFFERENT uuid after every save.
-- A `style_id uuid references ..._styles(id)` would be correct for exactly as
-- long as the operator did not press Save, and would then either fail on the FK
-- or point at a row that no longer exists.
--
-- An ORDINAL is no better and is worse for being plausible. Two independent
-- reasons, and the second was measured off the screen rather than reasoned:
--
--   * `normalizeStyles` re-numbers `sno` BY POSITION after dropping blank lines
--     (`.map((r, i) => ({ ...r, sno: i + 1 }))`), so deleting the first of three
--     styles renumbers the other two — and every file keyed to "style 2" would
--     silently follow the wrong garment from then on. Nothing errors; the sketch
--     for style 2 is simply filed under style 3.
--   * The SCREEN NEVER LEARNS THE FINAL ORDINAL. It sends `sno: 0` on every
--     style row and the server assigns the real one, so the client has no value
--     to key a file by at the moment the operator attaches it.
--
-- `style_ref_no` TEXT is what survives, and it is not a new idea here — it is
-- the key EVERY per-style child of this amendment already uses:
--
--     garment_order_amendment_style_sizes        (0407)  style_ref_no text
--     garment_order_amendment_style_components   (0457)  style_ref_no text
--     garment_order_amendment_style_coordinates  (0461)  style_ref_no text
--     garment_order_amendment_pack_components    (0467)  style_ref_no text
--
-- and the normalizers all compare it through one helper, `styleKey()` (trim +
-- upper-case), so a file joins that family rather than inventing a sixth rule.
--
-- It is the operator's OWN reference for the garment, so it also survives the
-- thing an ordinal cannot: the operator re-ordering the grid.
--
--
-- ## NULLABLE, AND NULL MEANS "THE ORDER'S", NOT "UNANSWERED"
--
-- Every row that exists today has no style — the field was on the header until
-- this change — and a backfill would have to invent one. There is no honest
-- value to invent: an order with three styles gives no clue which of them the
-- buyer's order sheet was for, and picking the first would put a made-up fact
-- in front of production.
--
-- So NULL is a real, permanent state: a document filed against the ORDER rather
-- than against one of its garments. That also keeps the header's own attachment
-- corner expressible, and it is what an unmatched reference DEMOTES TO rather
-- than being deleted — see the next section.
--
--
-- ## `uq_goa_files_path` IS LEFT EXACTLY AS 0416 WROTE IT, DELIBERATELY
--
-- The obvious move on reading this migration is to widen that index — it is
-- `(amendment_id, storage_path)`, so it refuses the same object under two
-- styles, and "one buyer order sheet covering every style" sounds like a case
-- the client would want. **It is not, and widening it would be a regression.**
--
-- Each upload mints a FRESH `crypto.randomUUID()` path
-- (`components/ui/file-attachments.tsx`), so one object is attached exactly
-- once and there is no way for the screen to produce the same `storage_path`
-- under two styles at all. Attaching the same document to two styles means
-- uploading it twice, which yields two paths and two rows, and passes the index
-- untouched.
--
-- What widening it would do is PERMIT a state nothing can create and nothing
-- can resolve: two rows over one bucket object, where removing either leaves
-- the other pointing at bytes the first one's delete was entitled to reclaim.
-- The index earns its keep by making that unrepresentable.
--
-- So the guard 0416 wrote — "the same file added twice in one session, which is
-- the operator error that actually happens (a double-click on the picker)" — is
-- unchanged and still correct at the grain it was written for. The verify block
-- below asserts it still bites, so a later reader cannot quietly widen it.
--
--
-- ## AN UNMATCHED REFERENCE IS DEMOTED, NOT DROPPED — AND THIS DIFFERS FROM
-- ## EVERY SIBLING ON PURPOSE
--
-- The five per-style normalizers DROP a child whose style is not among the ones
-- the save is writing. `normalizeFileRows` does not: it NULLs the reference and
-- keeps the row, demoting the document to an order-level one.
--
-- The asymmetry is the point, and it is about the BUCKET. A size whose style
-- vanished is a size with no meaning, and deleting the row costs nothing. A file
-- whose style ref was retyped still has an object sitting in
-- `garment-order-docs` that nothing else references — deleting its row orphans
-- those bytes with no row left to reach or remove them by. Demoting keeps the
-- document visible in the header's attachment corner, where the operator can
-- re-file it or delete it properly.
--
-- Stated here as well as in the normalizer because it is exactly the kind of
-- divergence a later reader "corrects" into consistency with its siblings.
--
--
-- ## NOT `not null`, EVEN THOUGH THE FIELD IS MANDATORY
--
-- "A style cannot be saved without a file" is a rule about a STYLE having a
-- file, not about a FILE having a style — the two are not the same statement and
-- only the first is what the client asked for. It is enforced on the screen (the
-- Save button and the required declaration), where the operator can be told
-- which line is missing one. `not null` here would reject the order-level rows
-- above and answer a mandatory-field question with a 23502.
-- ============================================================================


alter table public.garment_order_amendment_files
  add column if not exists style_ref_no text;

comment on column public.garment_order_amendment_files.style_ref_no is
  'The style line this document belongs to, by the operator''s own reference '
  '(client 2026-08-31: Add File moves onto each Styles Details row). TEXT and '
  'not a uuid or an ordinal, because writeChildren deletes and reinserts the '
  'styles wholesale on every save, normalizeStyles re-numbers sno by position, '
  'and the screen never learns the final sno at all — same key, and the same '
  'styleKey() comparison, as the sizes (0407), components (0457), coordinates '
  '(0461) and pack components (0467). NULL is a document filed against the '
  'ORDER rather than a garment: what every row predating this migration is, and '
  'what a reference matching no live style is DEMOTED to rather than deleted '
  '(the bytes are still in the bucket). 0479.';

create index if not exists idx_goa_files_style
  on public.garment_order_amendment_files(amendment_id, style_ref_no);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog, and EXERCISE the index that this
-- migration deliberately did NOT change.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- The probe paths are deleted with `in (...)`, not `like '__0479_probe/%'`.
-- `_` is a SINGLE-CHARACTER WILDCARD in a LIKE pattern, so that predicate reads
-- as an exact prefix and is not one: it also matches any two characters
-- followed by `0479`, any character, `probe/`. It happens to match the probe
-- rows, so the migration would work and the delete would be quietly fuzzy over
-- real data. Caught in review before this ran anywhere.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  refused     boolean := false;
  nullable    boolean;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_order_amendment_files'
       and column_name = 'style_ref_no'
  ) then
    raise exception '0479: style_ref_no was not added';
  end if;

  select is_nullable = 'YES'
    into nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_files'
     and column_name = 'style_ref_no';
  if not nullable then
    raise exception '0479: style_ref_no must be nullable — NULL is an order-level document, which is what every existing row is';
  end if;

  /* TEXT, not a uuid. A uuid here would mean the add ran against the wrong
     intent even though it ran — and it is the reading this migration's header
     exists to argue against. */
  if (select data_type from information_schema.columns
       where table_schema = 'public'
         and table_name = 'garment_order_amendment_files'
         and column_name = 'style_ref_no') <> 'text' then
    raise exception '0479: style_ref_no is not text';
  end if;

  /* THE 0416 INDEX MUST STILL BE THERE, AND AT ITS ORIGINAL GRAIN. Asserted
     because widening it to include the style column is the plausible-looking
     change a later reader makes, and it would permit two rows over one bucket
     object. See the header. */
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_goa_files_path') then
    raise exception '0479: uq_goa_files_path is gone — one bucket object could now be claimed by two rows';
  end if;

  select id into probe_amend from public.garment_order_amendments limit 1;

  if probe_amend is null then
    raise notice '0479: no amendment to probe with — the column was asserted structurally only';
  else
    -- The same object is still refused a second time, whatever style each row
    -- names. That is the point of leaving the index alone: a path is minted per
    -- upload, so two rows over one path can only ever be a double-click.
    begin
      insert into public.garment_order_amendment_files
        (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path)
      values (probe_amend, 9479, 'ZZ-0479-A', 'sketch', '__0479.jpg', '__0479_probe/a.jpg'),
             (probe_amend, 9480, 'ZZ-0479-B', 'sketch', '__0479.jpg', '__0479_probe/a.jpg');
    exception when unique_violation then
      refused := true;
    end;
    delete from public.garment_order_amendment_files
     where storage_path in ('__0479_probe/a.jpg', '__0479_probe/b.jpg');
    if not refused then
      raise exception '0479: one storage_path was admitted twice — uq_goa_files_path has been widened or dropped';
    end if;

    -- A style-filed row and an order-level row both insert cleanly. This is the
    -- whole of what the migration adds, and it is asserted rather than assumed
    -- because a stray CHECK or NOT NULL would be invisible until the first save.
    insert into public.garment_order_amendment_files
      (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path)
    values (probe_amend, 9481, 'ZZ-0479-A', 'order_sheet', '__0479.pdf', '__0479_probe/c.pdf'),
           (probe_amend, 9482, null,        'order_sheet', '__0479.pdf', '__0479_probe/d.pdf');
    delete from public.garment_order_amendment_files
     where storage_path in ('__0479_probe/c.pdf', '__0479_probe/d.pdf');
  end if;

  raise notice '0479 verified: style_ref_no present, text and nullable; uq_goa_files_path untouched and still refusing a repeated path';
end $verify$;
