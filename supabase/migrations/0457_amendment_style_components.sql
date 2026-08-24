-- ============================================================================
-- Raagam ERP — 0457 Garment Order ▸ Order Info ▸ Styles Details ▸ Components
--
-- THE STYLE MASTER MOVES INTO ORDER ENTRY (client 2026-08-23: "we can style as
-- separate child now but we need to merge it with order entry … component and
-- size also will come inside that order info").
--
-- Order Info already holds the style line and its SIZES (0407, rendered by
-- `sizeGrid` as a cell of the row). The other half of the Style master's
-- "Components & Sizes" section — the COMPONENT list — had nowhere on the order
-- to live, and this table is that place.
--
--
-- WHY THE ORDER NEEDS ITS OWN COPY AT ALL
--
-- `garment_style_components` already states the parts of a style, and the
-- amendment screen already reads it: `pickStyle` takes each component's
-- `fabric_category_id` and seeds the Color/Print structures from it, and
-- `scopedCoordinates` / `scopedComponents` narrow the Combos overlay's two
-- pickers to the pairs the style declares. Both READ the master; neither lets
-- the order say anything the master does not.
--
-- That is the gap. A PO can legitimately differ from the style it names — a
-- buyer drops the pocket, or asks for a contrast collar this season — and until
-- now the only way to record it was to edit the master, which rewrites history
-- for every other order already pointing at that style. The order gets its own
-- rows so it can differ without lying about the style.
--
-- The master stays. It is read by ten other places (Fabric BOM, MBA, TA Plan,
-- Process Amendment, Internal Work Orders, Quote Costings, `combo-rules.ts`,
-- `order-seed.ts` …), and `pickStyle` still COPIES its components in as the
-- starting point — so nothing is retyped, and what flows in is then editable.
--
--
-- WHY style_ref_no (TEXT) AND NOT AN FK TO ..._styles.id
--
-- Identical to 0407 (sizes) and 0411 (processes), and not optional here either.
-- `writeChildren` deletes and reinserts every child grid WHOLESALE, so
-- `garment_order_amendment_styles.id` is a new uuid after every save; a row
-- pointing at the old one is orphaned, or cascaded away mid-write while the
-- screen still shows the components.
--
-- Keying on the text ref is the module convention: Price Details
-- (`styleLineKeyOf`), Quantities (`refNoOptions`), Approval Qty (`poQtyOf`),
-- Style Sizes (0407) and Style Processes (0411) all resolve on this exact
-- string. This makes a sixth. Nothing parses it — `styleKey` trims and
-- upper-cases and stops, which matters since 0402 put SLASHES in the code
-- (STL/2627/0001).
--
--
-- THE FK TARGETS ARE THE MASTER'S OF TODAY, NOT 0124'S
--
-- `garment_style_components` was declared against `config_lookups` in 0124 and
-- repointed twice since — 0396 sent `coordinate_id` to `items` (a coordinate IS
-- a garment) and `component_id` to `components`, and 0405 renamed
-- `structure_id` to `fabric_category_id` and sent it to `categories` (client:
-- "structure is fabric category data"). This table is born at the far end of
-- both moves. Declaring it against `config_lookups` to match the OLDEST version
-- of the master would have compiled, run, and silently made the seed copy ids
-- that resolve to nothing — the lookup-compat FK mismatch shape.
--
--
-- comp_type AND item_id ARE STORED AND NOT SHOWN
--
-- Both are withdrawn cells on the Style master (Type 2026-08-18, Fabric
-- 2026-08-11) whose COLUMNS and values stay, precisely because a field dropped
-- from a wholesale-rewritten payload is NULLED rather than frozen. The order
-- copy carries them for the same reason: the seed copies what the master holds,
-- and a column the copy cannot express is a value the merge would destroy on
-- the first save. `comp_type` is also still derived — `componentTypeForCategory`
-- fills it off `categories.fabric_structure_id` when the Structure cell changes.
--
--
-- EVERY ANSWER COLUMN IS NULLABLE, DELIBERATELY
--
-- A row with no coordinate and no component is what the operator is standing in
-- the middle of typing. The normalizer drops it before insert; NOT NULL here
-- would turn "I have not answered yet" into a 23502 at save time. Same call
-- 0407 and 0411 both made.
--
--
-- UNIQUE PER (amendment, style, coordinate, component, fabric category)
--
-- THE KEY IS THE NORMALIZER KEY, and that is the point of it rather than a
-- coincidence — an index that disagrees with the code de-duplicating in front of
-- it either refuses correct work or admits duplicates the screen cannot show,
-- and this module has shipped both.
--
-- `fabric_category_id` IS IN THE KEY. Without it, a FRONT BODY cut in single
-- jersey and a FRONT BODY cut in 1x1 rib — a contrast yoke, an entirely normal
-- garment — is refused, and refused at SAVE time on rows the seed copied out of
-- a master that permits them (`garment_style_components` has no unique index at
-- all). A key stricter than the master it is seeded from turns a legitimate
-- style into an unsaveable order.
--
-- Nulls compare as distinct in Postgres, so a wholly blank row is not caught by
-- it. Correct: the normalizer has already dropped it, and a unique index is not
-- the place to say "answer the question".
-- ============================================================================


create table if not exists public.garment_order_amendment_style_components (
  id                 uuid primary key default gen_random_uuid(),
  amendment_id       uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The style line this part belongs to. TEXT, not an FK — see the header.
  style_ref_no       text,
  sno                int not null default 0,

  -- "Coordinate" — `items` of item class GAR (0396). PIECES, TOP, BOTTOM.
  coordinate_id      uuid references public.items(id),
  -- "Component" — the `components` master (0396). FRONT BODY, COLLAR.
  component_id       uuid references public.components(id),
  -- "Structure" on screen — a fabric CATEGORY (0405). SINGLE JERSEY, 1X1 RIB.
  fabric_category_id uuid references public.categories(id),

  -- Stored, not shown. See the header.
  comp_type          text,
  item_id            uuid references public.items(id),

  created_at         timestamptz not null default now()
);

create index if not exists idx_goa_style_components_amend
  on public.garment_order_amendment_style_components(amendment_id);

-- The lookup the screen actually does: "the parts of THIS style on THIS order".
create index if not exists idx_goa_style_components_style
  on public.garment_order_amendment_style_components(amendment_id, style_ref_no);

create unique index if not exists uq_goa_style_components_part
  on public.garment_order_amendment_style_components(
    amendment_id, style_ref_no, coordinate_id, component_id, fabric_category_id
  );

alter table public.garment_order_amendment_style_components enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_style_sizes` (0407) and
-- `garment_order_amendment_style_processes` (0411), so the amendment child
-- tables stay one family rather than a dozen dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_style_components');
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and
-- 0436 was committed and never applied at all while its column silently broke
-- every save on the screen above it.
--
-- The index and the FK targets are asserted BY EXERCISING THEM rather than by
-- looking their names up. What is worth knowing is not that a constraint called
-- `uq_goa_style_components_part` exists, but that a repeated part is actually
-- refused and that the SAME part in a SECOND FABRIC is actually accepted — the
-- half a narrower key would have broken.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  probe_coord uuid;
  probe_comp  uuid;
  probe_cat_a uuid;
  probe_cat_b uuid;
  probe_count int;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'garment_order_amendment_style_components'
  ) then
    raise exception '0457: garment_order_amendment_style_components was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename = 'garment_order_amendment_style_components') <> 4 then
    raise exception '0457: expected 4 policies on garment_order_amendment_style_components';
  end if;

  -- The FK targets are the point of this check: 0124 pointed the master three
  -- answer columns at `config_lookups` and 0396/0405 moved them. Reading the
  -- catalog is the only way to know which end this table was born at.
  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_style_components'::regclass
         and contype = 'f' and conname like '%coordinate_id%') is distinct from 'items' then
    raise exception '0457: coordinate_id does not reference items';
  end if;
  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_style_components'::regclass
         and contype = 'f' and conname like '%component_id%'
         and conname not like '%coordinate%') is distinct from 'components' then
    raise exception '0457: component_id does not reference components';
  end if;
  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_style_components'::regclass
         and contype = 'f' and conname like '%fabric_category_id%') is distinct from 'categories' then
    raise exception '0457: fabric_category_id does not reference categories';
  end if;

  -- Any existing amendment will do; with none there is nothing to hang a probe
  -- row off, and the assertions below are SKIPPED rather than faked.
  select id into probe_amend from public.garment_order_amendments limit 1;
  select id into probe_coord from public.items      limit 1;
  select id into probe_comp  from public.components limit 1;
  select id into probe_cat_a from public.categories limit 1;
  select id into probe_cat_b from public.categories where id <> probe_cat_a limit 1;

  if probe_amend is not null and probe_coord is not null
     and probe_comp is not null and probe_cat_a is not null then

    -- 1. The SAME part in the SAME fabric, twice, must be refused.
    begin
      insert into public.garment_order_amendment_style_components
        (amendment_id, style_ref_no, sno, coordinate_id, component_id, fabric_category_id)
      values (probe_amend, '__0457_probe', 9001, probe_coord, probe_comp, probe_cat_a),
             (probe_amend, '__0457_probe', 9002, probe_coord, probe_comp, probe_cat_a);
      raise exception '0457: the unique index admitted a duplicate part';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_style_components
     where style_ref_no = '__0457_probe';

    -- 2. The SAME part in a SECOND fabric must be ACCEPTED — the contrast-yoke
    --    case, and the reason `fabric_category_id` is in the key at all.
    if probe_cat_b is not null then
      insert into public.garment_order_amendment_style_components
        (amendment_id, style_ref_no, sno, coordinate_id, component_id, fabric_category_id)
      values (probe_amend, '__0457_probe', 9001, probe_coord, probe_comp, probe_cat_a),
             (probe_amend, '__0457_probe', 9002, probe_coord, probe_comp, probe_cat_b);
      select count(*) into probe_count
        from public.garment_order_amendment_style_components
       where style_ref_no = '__0457_probe';
      if probe_count <> 2 then
        raise exception '0457: the same part in two fabrics was refused (got %)', probe_count;
      end if;
      delete from public.garment_order_amendment_style_components
       where style_ref_no = '__0457_probe';
    end if;
  end if;
end $verify$;
