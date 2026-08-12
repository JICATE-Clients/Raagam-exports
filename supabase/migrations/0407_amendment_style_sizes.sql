-- ============================================================================
-- Raagam ERP — 0407 Garment Order Amendment ▸ Style(s) ▸ the per-style Size list
--
-- Legacy screenshots 2255 → 2256 (client 2026-08-12): the Style(s) grid's row
-- EXPANDS, and under it sits a second grid of two columns —
--
--   S No · Size
--
-- 2255 shows that sub-grid holding nothing while the Style picker is open;
-- 2256, four seconds later, shows it holding 2 · 3 · 4 · 5 · 6 · 8 · 10 · 12 ·
-- 14. The pick is what fills it. The scalar half of that auto-fill has worked
-- since 2026-08-10 (`pickStyle` fills Article No, Category, Description); the
-- LIST half existed nowhere — not on the screen, not in the payload, not here.
--
-- The sizes come from `garment_style_sizes`, which the Style master already
-- maintains. This table is where the ORDER's copy of them lives, because the
-- operator may add or drop a size for this PO without editing the style.
--
--
-- WHY `style_ref_no` (TEXT) AND NOT AN FK TO `..._styles.id`
--
-- Because the FK would dangle on the second save. `writeChildren`
-- (lib/orders/amendments/actions.ts) deletes and reinserts every child grid
-- WHOLESALE, so `garment_order_amendment_styles.id` is a new uuid after each
-- save and any row pointing at the old one is orphaned — or, worse, cascaded
-- away mid-write while the screen still shows the sizes.
--
-- Keying on the text ref is not a workaround here, it is the module's existing
-- convention: `(sales_order_id, style_ref_no)` is the Orders key, and THREE
-- tabs already resolve on this exact string — Price Details (`styleLineKeyOf`),
-- Quantities (`refNoOptions`) and Approval Qty (`poQtyOf`). This makes a
-- fourth. It is also why the Style Ref No COLUMN could be withdrawn from the
-- grid on 2026-08-11 while the FIELD stayed and `pickStyle` kept filling it.
--
-- Nothing parses the ref. `styleKey` (order-seed.ts) and `norm` (diff.ts) trim
-- and upper-case and stop, which matters as of 0402: the code carries SLASHES
-- (`STL/2627/0001`), so a split-on-a-delimiter added later would shred the key.
--
-- No FK constraint can express this key. `..._styles` has no unique index on
-- (amendment_id, style_ref_no) and should not get one — a PO naming the same
-- style twice is a duplicate LINE, an operator error to see and fix, not a
-- violation to raise at save time. The orphan guard is `normalizeStyleSizes`,
-- which drops any size whose style is not among the styles written in the same
-- pass.
--
--
-- `size_id` -> `config_lookups` (kind = 'size')
--
-- The same target `garment_style_sizes.size_id` already points at, so a size
-- picked here and a size picked on the Style master are the same row, and the
-- one `LookupDialogPicker kind="size"` serves both.
--
-- `size` is the ONLY SURVIVOR of the six `config_lookups` kinds 0124 declared:
-- `style_category` went to `categories` (0394), `coordinate` and
-- `style_component` to `items` / `components` (0396), `structure` to
-- `fabric_structure` and then to `categories` (0405), and `trims_category`
-- lost its consumer (0392). It has no maintenance screen; rows are created
-- inline from the picker, which is exactly how the Style master fills it.
--
-- NULLABLE, AND THAT IS DELIBERATE. A blank size row is what the operator is
-- standing in the middle of typing; the normalizer drops it before insert. A
-- NOT NULL here would turn "I have not answered yet" into a 23502 on save.
--
--
-- UNIQUE PER (amendment, style, size)
--
-- A line naming size "M" twice says nothing the first row did not. Same
-- reasoning, same backstop role, as 0399's `(amendment_id, pack_type)`: the
-- screen passes the sibling ids to the picker as `usedIds` so a second pick is
-- never offered, and `normalizeStyleSizes` de-duplicates before insert — the
-- index exists for `lib/data-io`, which writes past the screen.
--
-- Nulls compare as distinct in Postgres, so a row with no size at all is not
-- caught by it. That is correct: the normalizer has already dropped it, and a
-- unique index is not the place to say "answer the question".
-- ============================================================================


create table if not exists public.garment_order_amendment_style_sizes (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The style this size belongs to. TEXT, not an FK — see the header.
  style_ref_no text,
  sno          int not null default 0,

  size_id      uuid references public.config_lookups(id),

  created_at   timestamptz not null default now()
);

create index if not exists idx_goa_style_sizes_amend
  on public.garment_order_amendment_style_sizes(amendment_id);

-- The lookup the screen actually does: "the sizes of THIS style on THIS order".
create index if not exists idx_goa_style_sizes_style
  on public.garment_order_amendment_style_sizes(amendment_id, style_ref_no);

create unique index if not exists uq_goa_style_sizes_size
  on public.garment_order_amendment_style_sizes(amendment_id, style_ref_no, size_id);

alter table public.garment_order_amendment_style_sizes enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_pack_types` (0399) and
-- `garment_order_amendment_quantities` (0398), so the amendment's child tables
-- stay one family rather than ten dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_style_sizes');
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The unique index is asserted BY VIOLATING IT rather than by looking it up in
-- `pg_indexes`: a name being present proves a name is present, and the thing
-- worth knowing is that a second identical size is actually refused.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
  probe_size  uuid;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_style_sizes'
  ) then
    raise exception '0407: garment_order_amendment_style_sizes was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'garment_order_amendment_style_sizes') <> 4 then
    raise exception '0407: expected 4 policies on garment_order_amendment_style_sizes';
  end if;

  -- Any existing amendment will do; with none there is nothing to hang a probe
  -- row off, and the index assertion is SKIPPED rather than faked.
  select id into probe_amend from public.garment_order_amendments limit 1;
  select id into probe_size  from public.config_lookups where kind = 'size' limit 1;

  if probe_amend is not null and probe_size is not null then
    begin
      insert into public.garment_order_amendment_style_sizes
        (amendment_id, style_ref_no, sno, size_id)
      values (probe_amend, '__0407_probe', 9001, probe_size),
             (probe_amend, '__0407_probe', 9002, probe_size);
      raise exception '0407: (amendment_id, style_ref_no, size_id) admitted a duplicate size';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_style_sizes where style_ref_no = '__0407_probe';
  end if;
end $verify$;
