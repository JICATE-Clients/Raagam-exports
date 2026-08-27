-- ----------------------------------------------------------------------------
-- 0472 - Pack type(s) gets the child grid it always had in legacy.
--
-- Client 2026-08-27, screenshot 2518: "for the pack type we missed 4 field
-- table ... the style and combo from the previous tab data".
--
-- The legacy Pack type(s) tab is MASTER-DETAIL and the conversion took only the
-- master. Above: S No | Pack Type ("ABC PK"). Beneath each row, expandable:
--
--     S No | StyleRefNo    | Style No | Combo | Qty
--        1 | 00090/2627/C  | TAMTAM   | 1     | 2
--        2 | 00090/2627/C  | TAMTAM   | 2     | 2
--        ...
--
-- So a pack type is not merely a WORD, it is a word plus what goes in it: how
-- many of each colourway of each style that method packs.
--
-- ## KEYED BY `pack_type` TEXT, like every other child here is keyed by
-- ## `style_ref_no`
--
-- `uq_goa_pack_types_method` already makes `(amendment_id, pack_type)` unique,
-- so the text identifies the parent exactly - the same property `style_ref_no`
-- has and the same reason the styles' four children key on it rather than on an
-- FK. It also keeps this table inside `writeChildren`'s flat
-- delete-all-then-reinsert, which is what every sibling uses; a real FK would
-- need the pairing dance `writeComboTree` does for combo structures, and would
-- need it only to re-derive a value the text already carries.
--
-- ## `style` IS STORED AND IS NOT A SECOND SOURCE OF TRUTH
--
-- Legacy's StyleRefNo and Style No were the style master's code and its name.
-- The Garment Order's Style became MANUAL ENTRY on 2026-08-25, so a line has one
-- string and it answers both - `price_details` and `combos` already store
-- `style` set to the ref for exactly this reason ("THE REF IS THE NAME NOW").
-- This table follows them rather than inventing a third convention.
--
-- ## NO `pieces` COLUMN
--
-- What one pack type packs in total is the SUM of `qty` over its lines, and a
-- column for a sum is a second source of truth for an addition - 0414 refused
-- `pcs_per_pack` and 0467 refused `pieces_per_pack` on the same test. `qty` is
-- typed and derivable from nothing, so it earns its column.
-- ----------------------------------------------------------------------------

create table if not exists public.garment_order_amendment_pack_type_lines (
  id            uuid primary key default gen_random_uuid(),
  amendment_id  uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The pack type this line belongs to, BY VALUE. See the header.
  pack_type     text,
  sno           int not null default 0,

  -- Which style line. TEXT, not an FK - the order keys styles by ref no.
  style_ref_no  text,
  -- The style's name. Equal to `style_ref_no` on a manually entered line, and
  -- kept as its own column so a legacy import carrying both still round-trips.
  style         text,

  -- The colourway, BY VALUE, as `combos.combo` holds it. Free text for the same
  -- reason 0403 made the colour free text: Colour Cards was withdrawn.
  combo         text,

  -- How many pieces of this (style, combo) the pack type packs.
  qty           numeric(16,3) not null default 0,

  created_at    timestamptz not null default now()
);

create index if not exists idx_goa_pack_type_lines_amend
  on public.garment_order_amendment_pack_type_lines(amendment_id);

-- The lookup the screen does: "what does THIS pack type pack".
create index if not exists idx_goa_pack_type_lines_type
  on public.garment_order_amendment_pack_type_lines(amendment_id, pack_type);

-- One line per (pack type, style, colourway). Naming the same colourway of the
-- same style twice under one method says nothing the first row did not - the
-- shape `uq_goa_pack_components_member` already uses one table across.
create unique index if not exists uq_goa_pack_type_lines_member
  on public.garment_order_amendment_pack_type_lines(
    amendment_id, pack_type, style_ref_no, combo
  );

alter table public.garment_order_amendment_pack_type_lines enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_pack_components` (0467) and
-- `garment_order_amendment_style_sizes` (0407), so the amendment child tables
-- stay one family rather than a dozen dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_pack_type_lines');
end $rls$;

comment on table public.garment_order_amendment_pack_type_lines is
  'What one packing method packs - style, colourway and quantity, the child '
  'grid beneath each Pack type(s) row in legacy. Keyed to its parent by '
  '`pack_type` text, which `uq_goa_pack_types_method` makes unique (0472).';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal - 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and
-- 0467 itself was committed and not applied for a day while the service already
-- embedded the table it declares.
--
-- The unique key is asserted BY EXERCISING IT rather than by looking its name
-- up. What is worth knowing is not that `uq_goa_pack_type_lines_member` exists,
-- but that the SAME style in a SECOND COLOURWAY is ACCEPTED - the five rows of
-- the client's own screenshot differ in nothing but the combo, so a key without
-- it would refuse the exact document this migration was written for.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  refused     boolean := false;
  kept        int;
  col         text;
  n_pol       int;
  rls_on      boolean;
begin
  -- 1. Every column exists, named ONE BY ONE. A count of 8 is satisfied by
  -- eight columns of the wrong names, and `create table if not exists` is
  -- silent when it does nothing - which is exactly the case on a re-run.
  foreach col in array array[
    'id','amendment_id','pack_type','sno','style_ref_no','style','combo','qty','created_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'garment_order_amendment_pack_type_lines'
         and column_name = col
    ) then
      raise exception '0472: column %.% missing', 'garment_order_amendment_pack_type_lines', col;
    end if;
  end loop;

  -- 2. RLS is ON and all four policies landed. A table with RLS enabled and no
  -- policies denies everyone, which reads on screen as an empty grid rather
  -- than as an error.
  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'garment_order_amendment_pack_type_lines';
  if not coalesce(rls_on, false) then
    raise exception '0472: row level security is not enabled';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'garment_order_amendment_pack_type_lines';
  if n_pol <> 4 then
    raise exception '0472: expected 4 policies, found %', n_pol;
  end if;

  -- 3. Exercise the key against a real amendment, then take it all back out.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is null then
    raise notice '0472: no amendment to probe against - key not exercised';
    return;
  end if;

  insert into public.garment_order_amendment_pack_type_lines
    (amendment_id, pack_type, sno, style_ref_no, style, combo, qty)
  values
    (probe_amend, '0472 PROBE', 1, '00090/2627/C', '00090/2627/C', '1', 2),
    -- THE ROW THE CLIENT'S SCREENSHOT IS MADE OF: same method, same style,
    -- different colourway. It must be ACCEPTED.
    (probe_amend, '0472 PROBE', 2, '00090/2627/C', '00090/2627/C', '2', 2);

  begin
    insert into public.garment_order_amendment_pack_type_lines
      (amendment_id, pack_type, sno, style_ref_no, style, combo, qty)
    values (probe_amend, '0472 PROBE', 3, '00090/2627/C', '00090/2627/C', '1', 9);
  exception when unique_violation then
    refused := true;
  end;

  select count(*) into kept
    from public.garment_order_amendment_pack_type_lines
   where amendment_id = probe_amend and pack_type = '0472 PROBE';

  delete from public.garment_order_amendment_pack_type_lines
   where amendment_id = probe_amend and pack_type = '0472 PROBE';

  if kept <> 2 then
    raise exception '0472: two colourways of one style should both be kept, found %', kept;
  end if;
  if not refused then
    raise exception '0472: the same colourway twice was accepted - the unique key is wrong';
  end if;

  raise notice '0472: ok - 9 columns, RLS on, 4 policies, key keeps 2 colourways and refuses a repeat';
end $verify$;
