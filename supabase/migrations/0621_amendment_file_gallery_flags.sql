-- 0621 — Style gallery flags on the order's attached files
-- (user, 2026-09-23: "Style Thumbnail Attachments in Order Entry" + the Order
-- Entry listing's thumbnail column).
--
-- ## NO NEW TABLE, AND THAT WAS THE FIRST DECISION
--
-- The spec named an `order_style_attachments` table keyed to `order_styles`.
-- Neither exists here, and the thing it describes already does:
-- `garment_order_amendment_files` (0416) holds every document an order carries,
-- in the PRIVATE `garment-order-docs` bucket, by `storage_path` (never a URL),
-- filed against a style by its TEXT reference since 0479. A second table for
-- "the pictures" would be a second answer to "what is attached to this style?",
-- and the editor, the listing and the reports would each have to pick one.
-- So the two things the spec adds are two COLUMNS on the table that is already
-- the answer.
--
-- ## `is_primary` — THE STYLE'S COVER, ONE PER STYLE
--
-- The picture the listing shows at 48×48 and the gallery opens on. At most one
-- per `(amendment_id, style_ref_no)`, held by a PARTIAL unique index over
-- `coalesce(style_ref_no, '')`:
--
--   * PARTIAL (`where is_primary`), because the other rows of a style are all
--     `false` and a plain unique index over the flag would refuse the second
--     un-starred file.
--   * `coalesce`, because NULL is a real state here (0479: a document filed
--     against the ORDER, which is every row saved before that migration) and
--     NULLs are distinct in a unique index — without it the order-level group
--     could hold any number of stars.
--
-- NOT BACKFILLED. No existing row is starred, deliberately. `coverOf()` in
-- `lib/orders/amendments/style-gallery.ts` falls back to the first sketch
-- picture and then the first picture, so every existing order already has a
-- cover without one. Stamping a star now would record a choice nobody made,
-- and the fallback is the same "first sketch" the header's `sketchPath` reads.
--
-- The index is the guard, not the mechanism: `normalizeFileRows`
-- (`file-rows.ts`) calls `normalizePrimary` over the rows as they will be
-- written — AFTER the style demotion, which can move a starred file into the
-- order-level group — so a well-formed save never reaches a 23505. A stale tab
-- or a direct post does, and should.
--
-- ## `print_on_report` — OPT-IN, NO RULE
--
-- Printed in the "Style images" strip of the order's reports. Any number of
-- pictures may print, so there is no index. `false` by default and never
-- inferred: a report that guessed which picture to print would put a draft
-- sketch in front of a buyer.
--
-- ## THE LOCK AND THE AMENDMENT SCOPE NEED NOTHING, AND THAT IS CHECKED, NOT ASSUMED
--
-- `trg_order_lock` on this table (0576) is ROW-grained —
-- `refuse_when_order_locked('amendment_id')` refuses any insert, update or
-- delete while the order is approved — so the new columns are locked exactly
-- where `file_name` and `storage_path` already are, with no edit. And 0604
-- lists this table in its CLOSED-TO-EVERY-TYPE enumeration (ATTACHMENTS), with
-- no `order_amendment_scopes` row, so no amendment category opens a column of
-- it — these two included. Re-starring a cover after approval is therefore
-- refused like re-attaching a sketch is; the first client report of needing to
-- is what should open the table, on its own evidence (0604's words). The
-- verification below asserts both facts, so a later migration that makes the
-- lock column-aware or scopes this table has to come back here.

alter table public.garment_order_amendment_files
  add column if not exists is_primary      boolean not null default false,
  add column if not exists print_on_report boolean not null default false;

comment on column public.garment_order_amendment_files.is_primary is
  'The style''s cover picture — at most one per (amendment_id, style_ref_no), uq_goa_files_primary. Read through coverOf() (style-gallery.ts): an unstarred style falls back to its first sketch picture (0621).';
comment on column public.garment_order_amendment_files.print_on_report is
  'Printed in the order reports'' "Style images" strip. Opt-in; a report never guesses which picture to print (0621).';

create unique index if not exists uq_goa_files_primary
  on public.garment_order_amendment_files (amendment_id, coalesce(style_ref_no, ''))
  where is_primary;


-- ---------- verification ----------

do $verify$
declare
  probe_amend uuid;
  locked      boolean := false;
  refused     boolean := false;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'garment_order_amendment_files'
         and column_name in ('is_primary', 'print_on_report')
         and data_type = 'boolean' and is_nullable = 'NO') <> 2 then
    raise exception '0621: is_primary / print_on_report are not both boolean not null';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_goa_files_primary'
                    and indexdef like '%WHERE is_primary%'
                    and indexdef like '%COALESCE(style_ref_no%') then
    raise exception '0621: uq_goa_files_primary is missing, not partial, or not coalescing the order-level group';
  end if;

  -- THE LOCK IS STILL ROW-GRAINED. If it ever takes a column list, the two
  -- flags have to be named in it, and this is where that is noticed.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.garment_order_amendment_files'::regclass
                    and tgname = 'trg_order_lock'
                    and pg_get_triggerdef(oid) like '%refuse_when_order_locked(''amendment_id'')%') then
    raise exception '0621: trg_order_lock on the files table has changed shape — re-check that the new flags are locked';
  end if;

  -- STILL CLOSED TO EVERY AMENDMENT TYPE (0604 §3, ATTACHMENTS).
  if exists (select 1 from public.order_amendment_scopes
              where table_name::text = 'garment_order_amendment_files') then
    raise exception '0621: an amendment scope now opens the files table — decide whether it opens is_primary / print_on_report too';
  end if;

  -- An order that is NOT locked, so the probe is not refused for a reason
  -- that has nothing to do with the index.
  select a.id into probe_amend
    from public.garment_order_amendments a
   where not exists (select 1 from public.order_lock_of(a.id, null))
   limit 1;

  if probe_amend is null then
    raise notice '0621: no unlocked amendment to probe with — asserted structurally only';
    return;
  end if;

  begin
    insert into public.garment_order_amendment_files
      (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path, mime_type, is_primary)
    values (probe_amend, 9621, 'ZZ-0621-A', 'sketch', '__0621.jpg', '__0621_probe/a.jpg', 'image/jpeg', true);
  exception
    when unique_violation then
      raise exception '0621: a single star on a style was refused';
    -- P0001 is the lock's own `raise` (refuse_when_order_locked). NOT
    -- `when others`: a stray CHECK or NOT NULL on the new columns is exactly
    -- what this probe exists to surface, and it must not be read as "locked".
    when raise_exception then
      locked := true; -- the lock answered after all; nothing was written
  end;

  if locked then
    raise notice '0621: probe amendment refused by the lock — asserted structurally only';
    return;
  end if;

  -- A second star on the same style is refused.
  begin
    insert into public.garment_order_amendment_files
      (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path, mime_type, is_primary)
    values (probe_amend, 9622, 'ZZ-0621-A', 'sketch', '__0621.jpg', '__0621_probe/b.jpg', 'image/jpeg', true);
  exception when unique_violation then
    refused := true;
  end;
  if not refused then
    delete from public.garment_order_amendment_files where storage_path like '__0621_probe/%';
    raise exception '0621: two stars were admitted on one style';
  end if;

  -- A star on ANOTHER style, one on the ORDER level, and any number of
  -- unstarred files beside them all insert cleanly.
  insert into public.garment_order_amendment_files
    (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path, mime_type, is_primary, print_on_report)
  values (probe_amend, 9623, 'ZZ-0621-B', 'sketch', '__0621.jpg', '__0621_probe/c.jpg', 'image/jpeg', true,  true),
         (probe_amend, 9624, null,        'sketch', '__0621.jpg', '__0621_probe/d.jpg', 'image/jpeg', true,  true),
         (probe_amend, 9625, 'ZZ-0621-A', 'sketch', '__0621.jpg', '__0621_probe/e.jpg', 'image/jpeg', false, true),
         (probe_amend, 9626, 'ZZ-0621-A', 'sketch', '__0621.jpg', '__0621_probe/f.jpg', 'image/jpeg', false, false);

  -- …and the ORDER-level group is one group: a second null-style star is refused.
  refused := false;
  begin
    insert into public.garment_order_amendment_files
      (amendment_id, sno, style_ref_no, doc_kind, file_name, storage_path, mime_type, is_primary)
    values (probe_amend, 9627, null, 'sketch', '__0621.jpg', '__0621_probe/g.jpg', 'image/jpeg', true);
  exception when unique_violation then
    refused := true;
  end;

  delete from public.garment_order_amendment_files where storage_path like '__0621_probe/%';

  if not refused then
    raise exception '0621: two order-level stars were admitted — the index is not coalescing style_ref_no';
  end if;

  raise notice '0621 verified: flags present, one star per style incl. the order-level group, lock row-grained, table still closed to every amendment scope';
end $verify$;
