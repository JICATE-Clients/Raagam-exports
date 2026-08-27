-- =============================================================================
-- 0467 — Retail SET packs: the composition, the pack count, and a flag of its own
--
-- Client, recording of 2026-08-25: an order may be sold as consumer-facing
-- RETAIL SETS — a kid's pyjama set (1 Top + 1 Bottom), a 3-pack of bodysuits in
-- different colours. The commercial order is booked in PACKS ("1,000 Packs"),
-- the factory makes PIECES ("3,000 garments"), and the buyer's price is per
-- BOX ("$12 per Baby Box"), not per garment.
--
--
-- ## WHY A NEW FLAG AND NOT `pack`
--
-- `garment_order_amendments.pack` (0126) ALREADY MEANS SOMETHING ELSE, and it
-- means it on the client's own instruction twice over. It means "this order is
-- packed to a CARTON scheme" (client 2026-08-10); it gates the Pack type(s)
-- section, whose four methods are Solid/Assort x Colour/Size — how finished
-- garments are sorted into shipping cartons. On 2026-08-18 the client went
-- further and CUT its reach into the Quantities tab outright ("no more
-- connection with pack and quantity tab").
--
-- The two facts are INDEPENDENT, which is the whole argument: a 3-pack of
-- bodysuits is still shipped in cartons, and those cartons are still either
-- solid-size or assorted. An order can be both, one, or neither. One boolean
-- carrying both questions has no answer for three of the four states, and the
-- one it silently gets wrong is "retail set, shipped solid" — the ordinary case.
--
-- So `is_set_pack` is its own column. `pack` is untouched, still gates Pack
-- type(s), and nothing that reads it changes.
--
--
-- ## PIECES ARE EXPLODED AT ENTRY. `po_qty` STAYS PIECES.
--
-- This is the load-bearing decision and it is about a switch statement.
-- `targetsOf` in `lib/orders/material-bom/requirement.ts` folds an approval row
-- into a production target through an exhaustive THREE-BRANCH switch on
-- `BaseQuantityRule`, and NOT ONE BRANCH CARRIES A MULTIPLIER. Neither does
-- `fullTarget`, `materialTarget`, `totalProductionQty`, `bom-ceiling.ts`, or
-- `order-value.ts`'s `po_qty x rate`.
--
-- So if `po_qty` began holding PACKS, every one of those would under-count by
-- the set size, silently, and each individual figure would still look
-- plausible. Worse than a flat factor: the rejection tiers are non-linear, so
-- the buffer would be drawn from the wrong bracket as well.
--
-- Therefore `packs_ordered` is a SEPARATE column and `po_qty` continues to hold
-- the piece count the whole application already reads it as. The screen derives
-- one from the other; nothing downstream learns a new word. This is the same
-- shape the carton explosion already uses — `lineQtyOf` multiplies cartons x
-- inners x ratio in the BROWSER and stores pieces.
--
--
-- ## THERE IS NO `pieces_per_pack` COLUMN, AND THAT IS A RULE THIS FILE INHERITS
--
-- Pieces per pack is the SUM of the composition rows' `qty_per_pack`. Storing it
-- would be a second source of truth for an addition. The assortment side has
-- refused exactly this column twice — 0414 stored `no_of_cartons` and refused
-- `pcs_per_pack`, and 0432 restated the test when it admitted
-- `inners_per_carton` ("the inner count is typed and derivable from nothing, so
-- it earns a column"). `packs_ordered` passes that test; a pack's size does not.
--
--
-- ## `combo` IS TEXT, BY VALUE
--
-- The convention 0413 and 0433 both set: a combo row's id is REWRITTEN on every
-- save (`writeChildren` deletes and reinserts), so an FK to it is a link to a
-- row that will not exist after the next Save. The colourway is carried by its
-- NAME, and that is why `style_ref_no` is text here too.
--
--
-- ## NULL IS NOT 0 ON `packs_ordered`
--
-- Nullable with no default. NULL is "this is not a set pack / not asked"; 0 is
-- "zero packs ordered", which is a real and different claim an operator can
-- make. Defaulting it to 0 would say every existing order ordered no packs.
-- Same rule 0465 asserts for `loss_pct` and 0419 for `per_pieces`.
-- =============================================================================

-- ---------- 1. The flag, on the amendment header ----------

alter table public.garment_order_amendments
  add column if not exists is_set_pack boolean not null default false;

comment on column public.garment_order_amendments.is_set_pack is
  'Retail SET packaging: this order is SOLD in packs (a pyjama set, a 3-pack) '
  'and booked in pack counts, while the factory makes pieces. NOT the same as '
  '`pack`, which is carton sortation and is deliberately left alone — an order '
  'can be both, one or neither (0467).';

-- ---------- 2. The pack count, on the style line beside its piece count ----------

alter table public.garment_order_amendment_styles
  add column if not exists packs_ordered numeric(16,3);

comment on column public.garment_order_amendment_styles.packs_ordered is
  'Packs the buyer ordered, when `is_set_pack`. `po_qty` beside it stays the '
  'PIECE count and is derived as packs x sum(pack component qty) — every BOM '
  'engine reads po_qty as pieces and none of them carries a multiplier (0467). '
  'NULL means not a set pack; 0 means zero packs, which is a different claim.';

-- ---------- 3. The composition ----------

create table if not exists public.garment_order_amendment_pack_components (
  id            uuid primary key default gen_random_uuid(),
  amendment_id  uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The style line this pack belongs to. TEXT, not an FK — see the header.
  style_ref_no  text,
  sno           int not null default 0,

  -- Which garment of the set. `items` of item class GAR (0396) — TOP, BOTTOM,
  -- the same master the Coordinates grid (0461) picks from.
  coordinate_id uuid references public.items(id),

  -- The colourway this member is made in, BY VALUE. A 3-pack of bodysuits is
  -- three DIFFERENT colours of one coordinate, so colour is what distinguishes
  -- two rows naming the same garment — which is why it is in the unique key.
  combo         text,

  -- How many of this coordinate are in ONE pack. Usually 1; a 3-pack of one
  -- colour is 3. The pack's SIZE is the sum of these and has no column.
  qty_per_pack  numeric(12,3) not null default 1,

  created_at    timestamptz not null default now()
);

create index if not exists idx_goa_pack_components_amend
  on public.garment_order_amendment_pack_components(amendment_id);

-- The lookup the screen actually does: "what is in THIS style's pack".
create index if not exists idx_goa_pack_components_style
  on public.garment_order_amendment_pack_components(amendment_id, style_ref_no);

-- One row per (garment, colour) within a style's pack. A set legitimately holds
-- the same coordinate twice in two colours, so the key must carry `combo` —
-- keyed on coordinate alone it would refuse the 3-pack of bodysuits that is the
-- client's own worked example.
create unique index if not exists uq_goa_pack_components_member
  on public.garment_order_amendment_pack_components(
    amendment_id, style_ref_no, coordinate_id, combo
  );

alter table public.garment_order_amendment_pack_components enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_style_components` (0457) and
-- `garment_order_amendment_style_sizes` (0407), so the amendment child tables
-- stay one family rather than a dozen dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_pack_components');
end $rls$;

comment on table public.garment_order_amendment_pack_components is
  'One member of a retail SET pack — which garment, in which colourway, how '
  'many per pack. Pieces = packs_ordered x sum(qty_per_pack) and is exploded '
  'in the browser into po_qty, never stored twice (0467).';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and
-- 0436 was committed and never applied at all while its column silently broke
-- every save on the screen above it.
--
-- The unique key is asserted BY EXERCISING IT, not by looking its name up. What
-- is worth knowing is not that `uq_goa_pack_components_member` exists, but that
-- the SAME coordinate in a SECOND COLOUR is actually ACCEPTED — the half a
-- coordinate-only key would have broken, and the client's own example.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  probe_coord uuid;
  refused     boolean := false;
  kept        int;
  col_ok      boolean;
begin
  -- 3a. The two added columns exist, named one by one. A count of 2 is
  -- satisfied by two columns of the wrong names, and `add column if not exists`
  -- is silent when it does nothing.
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_order_amendments'
       and column_name = 'is_set_pack'
  ) into col_ok;
  if not col_ok then
    raise exception '0467: garment_order_amendments.is_set_pack missing';
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_order_amendment_styles'
       and column_name = 'packs_ordered'
  ) into col_ok;
  if not col_ok then
    raise exception '0467: garment_order_amendment_styles.packs_ordered missing';
  end if;

  -- 3b. `packs_ordered` must stay NULLABLE. NULL is "not a set pack"; 0 is
  -- "zero packs ordered". A NOT NULL DEFAULT 0 would make every order in the
  -- table claim the second.
  select is_nullable = 'YES' into col_ok
    from information_schema.columns
   where table_schema = 'public' and table_name = 'garment_order_amendment_styles'
     and column_name = 'packs_ordered';
  if not col_ok then
    raise exception '0467: packs_ordered must be nullable — NULL is not the same claim as 0';
  end if;

  -- 3c. Exercise the unique key, both halves.
  select id into probe_amend from public.garment_order_amendments limit 1;
  select id into probe_coord from public.items limit 1;

  if probe_amend is null or probe_coord is null then
    raise notice '0467: no amendment or item row to probe with — key asserted structurally only';
  else
    insert into public.garment_order_amendment_pack_components
      (amendment_id, style_ref_no, coordinate_id, combo, qty_per_pack)
    values (probe_amend, 'ZZ-0467-PROBE', probe_coord, 'NAVY', 1);

    -- The same garment in a SECOND colour must be ACCEPTED. This is the
    -- client's 3-pack-of-bodysuits case and the reason `combo` is in the key.
    insert into public.garment_order_amendment_pack_components
      (amendment_id, style_ref_no, coordinate_id, combo, qty_per_pack)
    values (probe_amend, 'ZZ-0467-PROBE', probe_coord, 'WHITE', 1);

    -- The same garment in the SAME colour must be REFUSED.
    begin
      insert into public.garment_order_amendment_pack_components
        (amendment_id, style_ref_no, coordinate_id, combo, qty_per_pack)
      values (probe_amend, 'ZZ-0467-PROBE', probe_coord, 'NAVY', 1);
    exception when unique_violation then
      refused := true;
    end;

    select count(*) into kept
      from public.garment_order_amendment_pack_components
     where style_ref_no = 'ZZ-0467-PROBE';

    delete from public.garment_order_amendment_pack_components
     where style_ref_no = 'ZZ-0467-PROBE';

    if kept <> 2 then
      raise exception '0467: expected 2 probe rows (one per colour), got %', kept;
    end if;
    if not refused then
      raise exception '0467: a repeated (coordinate, combo) was NOT refused';
    end if;
  end if;

  raise notice '0467 verified: is_set_pack + packs_ordered + pack_components, key exercised';
end $verify$;
