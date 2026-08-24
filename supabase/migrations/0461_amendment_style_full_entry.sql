-- ============================================================================
-- Raagam ERP — 0461 Garment Order ▸ Order Info ▸ Styles Details ▸ the WHOLE
--                    Style entry
--
-- 0457 brought the Style master's Components onto the order and the sizes were
-- already there. The client then asked for the rest of the master screen the
-- same way (2026-08-23, screenshots 2471 · 2472: "i need this all with that
-- section same ui like this"): Approved Sample No, Season, Year, Article No.,
-- Style Category, Style Description, and the COORDINATES grid a component is
-- filed under.
--
-- Three of those already have columns here — `article_no`, `style_category`
-- (text) and `style_description` were seeded by `pickStyle` and stored without
-- ever having a cell. They need no migration, only a control. This adds the
-- four that had nowhere to go, plus the coordinates child table.
--
--
-- WHY THE ORDER STORES ITS OWN COPY OF ANY OF THIS
--
-- The same reason 0457 gives, and it is worth restating because these fields
-- read more like description than like data: a PO can legitimately differ from
-- the style it names. A buyer re-runs last season's style for a new season, or
-- against a different approved sample; recording that by editing the master
-- would rewrite history for every other order pointing at the same style.
-- `pickStyle` still copies the master's answers in, so nothing is retyped.
--
--
-- `style_category_id` ARRIVES BESIDE THE EXISTING `style_category` TEXT
--
-- The text column has been here since the tab was built and holds the category
-- NAME, resolved by the order seed and by `pickStyle` off
-- `categories.name`. It is a DISPLAY value with no way back to a row, which is
-- fine while nothing but the seed writes it and wrong the moment an operator
-- picks one: a name a picker cannot resolve is a value that renders as empty on
-- the next open and blanks itself on the save after that.
--
-- So the id is the truth and the text is a cache, WRITTEN FROM THE SAME EVENT —
-- the picker's `onChange` sets both, so they cannot disagree. The text column is
-- not dropped: `writeChildren` rewrites this table wholesale, so removing it
-- from the payload would NULL it on every existing order rather than freeze it,
-- and it is what the seed has always populated.
--
-- NO `item_class_id` HERE, unlike the master. That column exists there so a
-- DRAFT saved before a category is picked reopens on the right class (0394).
-- An order has no such state — the picker offers garment categories outright —
-- and a column nothing reads is a column that will be wrong later.
--
--
-- `season` IS PLAIN TEXT, MATCHING THE MASTER
--
-- `SEASON_OPTIONS` is four words in a TypeScript const, not a table, and the
-- master's column is `text` (0124) precisely because imported free text like
-- "SS26" has always been legal. A CHECK here would refuse rows the master
-- accepts, which is the trap 0457's unique index records one level up: a
-- constraint stricter than the source you seed from turns a legitimate style
-- into an unsaveable order. `capsTextNullable()` covers the write side.
--
--
-- THE COORDINATES CHILD
--
-- A component is a part of a COORDINATE — the master's own hint says so, and
-- its Component grid narrows on it. Until now the order's Coordinate cell
-- offered the whole `items` GAR master because there was nothing on the order to
-- scope by. This is that list.
--
-- Keyed by `style_ref_no` TEXT like the sizes (0407), the processes (0411) and
-- the components (0457), for the reason all three record: `writeChildren`
-- deletes and reinserts `..._styles` wholesale, so a row pointing at
-- `garment_order_amendment_styles.id` is orphaned or cascaded away mid-write.
-- This makes a seventh table on that key.
--
-- UNIQUE PER (amendment, style, coordinate) and this one really is the whole
-- row: a coordinate names itself and carries nothing else, so listing PIECES
-- twice under one style says nothing the first row did not. Same shape the
-- sizes index has, and the same reasoning.
--
-- NOT CAPPED IN THE DATABASE. `coordinateLimit` (Piece = 1, Set = 2..4) is a
-- property of the style's `unit_kind`, which lives on `garment_styles` and not
-- here — and the cap is enforced where it can be explained, on the grid's
-- "+ Add". A CHECK could only fail the save with nothing on screen to say why.
--
-- SEASON AND YEAR ARE ADDED HERE AND DROPPED AGAIN BY 0462, UNUSED. This
-- migration did not read the screen first, and the screen carries two explicit
-- client instructions against putting either on a style row. 0462 quotes both.
-- Nothing ever wrote to them. Read 0462 before adding them a second time.
-- ============================================================================


-- ---------------------------------------------------------------- header half
alter table public.garment_order_amendment_styles
  -- "Approved Sample No". Optional on both screens — `samples` has ZERO rows in
  -- this database, and 2026-08-13 made the master's copy optional for exactly
  -- that reason: a required field with an empty picker is a record that cannot
  -- be saved and no way to fix it from the screen.
  add column if not exists approved_sample_id uuid references public.samples(id),
  -- SUMMER / WINTER / SPRING / AUTUMN, or imported free text. See the header.
  add column if not exists season             text,
  add column if not exists style_year         integer,
  -- The Garment master row behind the `style_category` text beside it.
  add column if not exists style_category_id  uuid references public.categories(id);

comment on column public.garment_order_amendment_styles.style_category_id is
  'The categories row behind style_category (text). The id is the truth; the '
  'text is a display cache written from the same picker event. 0458.';


-- ------------------------------------------------------------ coordinates child
create table if not exists public.garment_order_amendment_style_coordinates (
  id            uuid primary key default gen_random_uuid(),
  amendment_id  uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The style line this coordinate belongs to. TEXT, not an FK — see the header.
  style_ref_no  text,
  sno           int not null default 0,

  -- "Coordinate" — `items` of item class GAR (0396). PIECES, TOP, BOTTOM.
  coordinate_id uuid references public.items(id),

  created_at    timestamptz not null default now()
);

create index if not exists idx_goa_style_coords_amend
  on public.garment_order_amendment_style_coordinates(amendment_id);

-- The lookup the screen does: "the coordinates of THIS style on THIS order".
create index if not exists idx_goa_style_coords_style
  on public.garment_order_amendment_style_coordinates(amendment_id, style_ref_no);

create unique index if not exists uq_goa_style_coords_coordinate
  on public.garment_order_amendment_style_coordinates(amendment_id, style_ref_no, coordinate_id);

alter table public.garment_order_amendment_style_coordinates enable row level security;

-- Shape, cascade, `sno` and permission module mirror the other six children on
-- this key, so the amendment's child tables stay one family rather than a dozen
-- dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_style_coordinates');
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. The FK
-- targets are the point of the first block: `coordinate_id` must reach `items`
-- (0396 moved it there from `config_lookups`) and `style_category_id` must reach
-- `categories` (0394), and naming a constraint proves only that a name exists.
-- The index is asserted BY VIOLATING IT.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  probe_coord uuid;
  want_cols   int;
begin
  select count(*) into want_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_styles'
     and column_name in ('approved_sample_id', 'season', 'style_year', 'style_category_id');
  if want_cols <> 4 then
    raise exception '0461: expected 4 new columns on garment_order_amendment_styles, found %', want_cols;
  end if;

  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_styles'::regclass
         and contype = 'f' and conname like '%style_category_id%') is distinct from 'categories' then
    raise exception '0461: style_category_id does not reference categories';
  end if;
  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_styles'::regclass
         and contype = 'f' and conname like '%approved_sample_id%') is distinct from 'samples' then
    raise exception '0461: approved_sample_id does not reference samples';
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'garment_order_amendment_style_coordinates'
  ) then
    raise exception '0461: garment_order_amendment_style_coordinates was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename = 'garment_order_amendment_style_coordinates') <> 4 then
    raise exception '0461: expected 4 policies on garment_order_amendment_style_coordinates';
  end if;

  if (select confrelid::regclass::text
        from pg_constraint
       where conrelid = 'public.garment_order_amendment_style_coordinates'::regclass
         and contype = 'f' and conname like '%coordinate_id%') is distinct from 'items' then
    raise exception '0461: coordinate_id does not reference items';
  end if;

  select id into probe_amend from public.garment_order_amendments limit 1;
  select id into probe_coord from public.items limit 1;

  if probe_amend is not null and probe_coord is not null then
    -- The same coordinate twice under one style must be refused.
    begin
      insert into public.garment_order_amendment_style_coordinates
        (amendment_id, style_ref_no, sno, coordinate_id)
      values (probe_amend, '__0458_probe', 9001, probe_coord),
             (probe_amend, '__0458_probe', 9002, probe_coord);
      raise exception '0461: the unique index admitted a duplicate coordinate';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_style_coordinates
     where style_ref_no = '__0458_probe';
  end if;
end $verify$;
