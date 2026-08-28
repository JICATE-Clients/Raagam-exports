-- =============================================================================
-- 0471 — Order Unit becomes a stored answer again: PCS or SET, on the style line
--
-- Client 2026-08-27: "that order unit need to show pcs and set".
--
-- ## WHY IT WAS BLANK ON EVERY ORDER
--
-- Order Unit stopped being asked on 2026-08-11 ("Order Unit (PCS/SET) is
-- sufficient") and was read through `style_id` off the Style master's
-- `unit_kind` instead — sound while the Style was a picked master row.
--
-- On 2026-08-25 the Style became MANUAL ENTRY ("allow it manual entry now,
-- unwire that style mapping"), so there is no `style_id` and nothing to resolve.
-- The stand-in derived the unit from the line's COORDINATES, reading
-- `COORDINATE_LIMITS` backwards: 1 coordinate is a Piece, 2-6 a Set. The
-- reasoning is exact — the ranges are disjoint and `check-style-rules.mts`
-- asserts they stay so.
--
-- IT WAS ALSO UNREACHABLE. Measured on the live database before this migration:
--
--     garment_order_amendment_styles              4 rows
--     garment_order_amendment_style_coordinates   0 rows
--
-- No order has ever recorded a coordinate, so `filledCoordinates()` returned 0
-- on every line, `unitKindFromCoordinates(0)` returned null, and the column was
-- blank on 100% of orders. A derivation whose only input is never captured is
-- not a fallback; it is a blank column with an explanation attached.
--
-- The damage ran downstream: `price_details.unit` is seeded from this value, so
-- all 14 stored price rows carry an empty unit. The rule that refused to guess
-- PCS — "a guess here is a guess that gets stored" — was right about the danger
-- and was storing an empty string instead, which is not the safer of the two.
--
-- ## SO IT IS ASKED AGAIN, AND THIS REVERSES 2026-08-11 DELIBERATELY
--
-- That decision was correct FOR ITS TIME: the question was already answered by
-- the Style master, so putting it to the operator twice invited two answers that
-- could disagree. The 08-25 unwiring removed the master's answer and left the
-- question with nobody to answer it. Restoring the field is not undoing 08-11;
-- it is following it to where its premise stopped holding.
--
-- ## A TEXT KIND, NOT A UOM FK — `order_unit_id` IS LEFT ALONE
--
-- `order_unit_id` (a `uoms` FK) is still on this table and stays frozen, exactly
-- as `plan_unit_id` beside it does: `writeChildren` deletes and reinserts a grid
-- wholesale, so a column dropped from the payload is nulled on the next save
-- rather than preserved, and both are carried through untouched for that reason.
--
-- It is NOT reused here because it answers a different question. It offered nos
-- / mtr / kg / gross / yard / set — a stock unit — and the client's replacement
-- is the two-valued PCS / SET, which is the same vocabulary `garment_styles.
-- unit_kind` (0392) and `COORDINATE_LIMITS` already speak. Storing 'piece' /
-- 'set' means the coordinate cap, the Style master and the order line all read
-- ONE vocabulary; pointing at a uoms row would make the order the only place
-- that spells it differently.
--
-- ## NULLABLE, WITH NO DEFAULT
--
-- NULL is "not answered", which is what every one of the four existing lines
-- genuinely is — nobody was ever asked. Defaulting to 'piece' would stamp an
-- invented unit onto four real PO quantities and, through the price seed, onto
-- rows a buyer is invoiced from. The screen derives from coordinates as a
-- fallback where the stored value is null, so an older line keeps whatever it
-- could already work out.
--
-- The CHECK is what makes the vocabulary enforceable rather than conventional:
-- `lib/data-io` writes straight to Postgres, and a text column with no check is
-- one spreadsheet import away from holding 'Pcs', 'pieces' or 'PC'.
-- =============================================================================

alter table public.garment_order_amendment_styles
  add column if not exists unit_kind text;

do $ck$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'garment_order_amendment_styles_unit_kind_ck'
  ) then
    alter table public.garment_order_amendment_styles
      add constraint garment_order_amendment_styles_unit_kind_ck
      check (unit_kind is null or unit_kind in ('piece', 'set'));
  end if;
end $ck$;

comment on column public.garment_order_amendment_styles.unit_kind is
  'Order Unit for this style line: ''piece'' (shown PCS) or ''set'' (SET). '
  'Asked of the operator again from 2026-08-27 — the 08-11 decision to derive it '
  'assumed a Style master to read it from, and 08-25 made the Style manual entry. '
  'NULL is "not answered", never PCS: the word is seeded into '
  'price_details.unit. Same vocabulary as garment_styles.unit_kind (0392) and '
  'COORDINATE_LIMITS, so the coordinate cap and this column cannot disagree (0471).';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog, and EXERCISE the check rather than
-- looking up its name — `{"success": true}` means the SQL ran, not that the
-- constraint bites. A check constraint that was created but does not reject is
-- the exact shape of a guard that reads as protection and is not.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  probe_id    uuid;
  refused     boolean := false;
  col_ok      boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_order_amendment_styles'
       and column_name = 'unit_kind'
  ) into col_ok;
  if not col_ok then
    raise exception '0471: garment_order_amendment_styles.unit_kind missing';
  end if;

  select is_nullable = 'YES' into col_ok
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_styles'
     and column_name = 'unit_kind';
  if not col_ok then
    raise exception '0471: unit_kind must be nullable — NULL is "not answered"';
  end if;

  select id into probe_amend from public.garment_order_amendments limit 1;

  if probe_amend is null then
    raise notice '0471: no amendment to probe with — check asserted structurally only';
  else
    -- The two legal values must be ACCEPTED.
    insert into public.garment_order_amendment_styles
      (amendment_id, sno, style_ref_no, po_qty, unit_kind)
    values (probe_amend, 9471, 'ZZ-0471-PROBE', 0, 'piece')
    returning id into probe_id;
    delete from public.garment_order_amendment_styles where id = probe_id;

    insert into public.garment_order_amendment_styles
      (amendment_id, sno, style_ref_no, po_qty, unit_kind)
    values (probe_amend, 9471, 'ZZ-0471-PROBE', 0, 'set')
    returning id into probe_id;
    delete from public.garment_order_amendment_styles where id = probe_id;

    -- ...and anything else REFUSED. 'PCS' is the display word, not the stored
    -- one, and is the likeliest thing to arrive from an import.
    begin
      insert into public.garment_order_amendment_styles
        (amendment_id, sno, style_ref_no, po_qty, unit_kind)
      values (probe_amend, 9471, 'ZZ-0471-PROBE', 0, 'PCS');
    exception when check_violation then
      refused := true;
    end;

    delete from public.garment_order_amendment_styles
     where style_ref_no = 'ZZ-0471-PROBE';

    if not refused then
      raise exception '0471: the check accepted ''PCS'' — it does not bite';
    end if;
  end if;

  raise notice '0471 verified: unit_kind present, nullable, and the check refuses anything but piece/set';
end $verify$;
