-- ============================================================================
-- Raagam ERP — 0399 Garment Order Amendment ▸ Pack type(s) tab
--
-- The last of the two placeholder tabs. Its legacy screen arrived on
-- 2026-08-11 and it is the smallest grid in the document:
--
--   S No · Pack Type
--
-- One column. (The legacy grid's caption reads "Price Details" — a copy-paste
-- in RP Software, not a hint that prices belong here. The app labels it
-- "Pack Type(s)".)
--
--
-- WHY A CHILD TABLE AND NOT A HEADER COLUMN
--
-- types.ts has carried this open question since the tab was named: is a pack
-- type ONE choice for the order, or one per destination? The screenshot
-- answers it — a grid takes rows, so an order declares the pack methods it
-- uses and may use more than one. It is not a header column, and it is not
-- (yet) an attribute of a Quantities row.
--
--
-- TEXT, NOT A LOOKUP FK, AND NOT A CHECK
--
-- `pack_type` holds the method's own words, exactly like
-- `garment_order_amendment_price_details.price_type` (0128) holds
-- "Style-wise". Three deliberate choices behind that:
--
--   * TEXT rather than a `config_lookups` FK, because the vocabulary is fixed
--     and client-dictated (`PACK_TYPE_OPTIONS`, four methods, 2026-08-10) —
--     the business does not add to it the way it adds a Ship Type.
--   * NO CHECK CONSTRAINT, for the reason RECEIPT_MODES records in types.ts:
--     a stored value that stops matching the tuple must render as a stale
--     value the operator can see and re-pick, not as a `23514` on save. The
--     screen keeps an off-tuple value on its option list for exactly that.
--   * UNIQUE PER AMENDMENT. A list that names "Solid Colour / Solid Size"
--     twice says nothing the single row did not. The constraint can never
--     actually fire — `normalizePackTypes` de-duplicates before insert and the
--     grid hides a method another row already took — which is the point: it is
--     the backstop for `lib/data-io`, which writes past the screen.
--
--
-- THE OVERLAP WITH `assortment_type` IS REAL AND IS NOT RESOLVED HERE
--
-- 0398 gave the Quantities grid an `assortment_type_id` over a new
-- `config_lookups` kind, seeded EMPTY, and its own header notes the legacy
-- screen shows "Solid Color - Solid…" there. That is this concept, asked a
-- second time from a different list — the drift AGENTS.md keeps warning about.
--
-- Resolving it means either seeding the four methods into that kind, or
-- pointing the Quantities cell at the pack types the order declared here. Both
-- change a tab that shipped hours ago and neither is what the client asked
-- for, so this migration deliberately changes NOTHING about 0398 and records
-- the question instead. Whichever way it is settled, this table is the side
-- that holds the order's declaration.
-- ============================================================================


create table if not exists public.garment_order_amendment_pack_types (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,

  pack_type    text,

  created_at   timestamptz not null default now()
);

create index if not exists idx_goa_pack_types_amend
  on public.garment_order_amendment_pack_types(amendment_id);

-- Nulls compare as distinct in Postgres, so a half-filled row is not caught by
-- this — which is correct: the normalizer drops a row with no method at all
-- before it can reach here, and a unique index is not the place to say
-- "answer the question".
create unique index if not exists uq_goa_pack_types_method
  on public.garment_order_amendment_pack_types(amendment_id, pack_type);

alter table public.garment_order_amendment_pack_types enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_quantities` (0398) and
-- `garment_order_amendment_approval_qtys` (0128), so the amendment's child
-- tables stay one family rather than nine dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_pack_types');
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The unique index is asserted BY VIOLATING IT, not by looking it up in
-- `pg_indexes`: a name being present proves a name is present, and the thing
-- worth knowing is that a second identical method is actually refused.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_pack_types'
  ) then
    raise exception '0399: garment_order_amendment_pack_types was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'garment_order_amendment_pack_types') <> 4 then
    raise exception '0399: expected 4 policies on garment_order_amendment_pack_types';
  end if;

  -- Any existing amendment will do; with none, there is nothing to hang a
  -- probe row off and the index assertion is skipped rather than faked.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is not null then
    begin
      insert into public.garment_order_amendment_pack_types (amendment_id, sno, pack_type)
      values (probe_amend, 9001, '__0399_probe'), (probe_amend, 9002, '__0399_probe');
      raise exception '0399: (amendment_id, pack_type) admitted a duplicate method';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_pack_types where pack_type = '__0399_probe';
  end if;
end $verify$;
