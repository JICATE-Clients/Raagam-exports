-- 0435 — Approval Qty is broken down BY SIZE, and its quantities are DERIVED.
--
-- Legacy RP shows this tab as a three-level tree (screenshot 2372): Style ▸
-- Combo ▸ Size, with a Qty / Excess Qty / Approval Qty / Total Qty band at the
-- last two levels. Almost none of it is typed — the identity comes from Style(s)
-- and Combos, and the quantities come from the size breakup. Ours was one flat
-- level where the operator PICKED a style, PICKED a combo and TYPED the
-- quantity (client 2026-08-19: "the table are pulling data from previous
-- section not manual entry").
--
-- WHAT THIS MIGRATION DOES is small, because the data was already there. The
-- Quantities tab's assortment tree (`..._quantities` ▸ `..._assort_lines` ▸
-- `..._assort_line_sizes`, 0414 · 0432 · 0433) already states the pieces of every
-- (style, combo, size) — it is what the Prices tab averages a Colour-wise or
-- Size-wise rate by. All this adds is the size axis on the approval row, so the
-- typed number can hang off the same key.
--
--   qty          stays a column and is now WRITTEN with the derived figure. Not
--                a second source of truth: nothing types it any more, it is a
--                snapshot of what the amendment was agreed against, and it is
--                deliberately NOT in `diff.ts`'s field list — a quantity change
--                belongs to the Quantities tab's diff, and reporting it twice
--                would read as two changes.
--   approval_qty stays the ONE typed number. Client 2026-08-19: it is entered at
--                SIZE level only, and the combo line above it is the sum. Two
--                places to type one number is two sources for it.
--   size_id      NEW. Nullable, because a row seeded from a legacy order has no
--                size axis to sit on (`order_pack_ratios` is per style) and a
--                pre-0435 row has none either.
--
-- THE UNIQUE KEY GAINS THE SIZE, AND `NULLS NOT DISTINCT` IS LOAD-BEARING.
-- Postgres treats NULLs as distinct in a unique index by default, so simply
-- adding `size_id` to `uq_goa_approval_qty_combo` would have QUIETLY WEAKENED
-- it: every legacy row carries size_id NULL, so a style+combo could then be
-- entered twice as long as neither row named a size — which is precisely the
-- duplicate the old three-column index existed to stop.
--
-- 3 rows live, all with combo NULL, so the backfill is a no-op and the reindex
-- cannot collide. Catalog-verified before writing this.
--
-- No function is created or altered, so the Function Grants rule does not apply.

alter table public.garment_order_amendment_approval_qtys
  add column if not exists size_id uuid references public.config_lookups(id);

comment on column public.garment_order_amendment_approval_qtys.size_id is
  'The size this approval quantity is for — a config_lookups size, the same '
  'vocabulary garment_order_amendment_assort_line_sizes uses. NULL on a row '
  'seeded from a legacy order, which has no size axis. Approval Qty is typed at '
  'this level only; the combo line above it is the sum of its sizes.';

comment on column public.garment_order_amendment_approval_qtys.qty is
  'DERIVED from the Quantities assortment tree and stored as a snapshot (0435). '
  'Nothing types it. Deliberately absent from diff.ts''s field list: a quantity '
  'change is reported by the Quantities tab, and once here as well would read as '
  'two separate changes to the order.';

drop index if exists public.uq_goa_approval_qty_combo;

create unique index if not exists uq_goa_approval_qty_combo_size
  on public.garment_order_amendment_approval_qtys
     (amendment_id, style_ref_no, combo, size_id)
  nulls not distinct;

create index if not exists idx_goa_approval_qtys_size
  on public.garment_order_amendment_approval_qtys(size_id);

do $$
begin
  -- 1. The column landed and points at the size vocabulary the assortment tree
  --    already uses. Pointing it anywhere else compiles, lists nothing and saves
  --    fine — 0408 §5c's lesson, and the reason this is asserted not trusted.
  if not exists (
    select 1
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.conrelid  = 'public.garment_order_amendment_approval_qtys'::regclass
       and c.contype   = 'f'
       and a.attname   = 'size_id'
       and c.confrelid = 'public.config_lookups'::regclass
  ) then
    raise exception '0435: size_id does not point at public.config_lookups';
  end if;

  -- 2. THE GUARD DID NOT WEAKEN. Both halves matter and the second is the one a
  --    careless rewrite loses: four columns AND nulls-not-distinct. Without the
  --    latter this index permits exactly the duplicate the old one forbade.
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.garment_order_amendment_approval_qtys'::regclass
       and i.indisunique
       and i.indnullsnotdistinct
       and i.indnatts = 4
  ) then
    raise exception '0435: the approval-qty unique key is not a 4-column NULLS NOT DISTINCT index';
  end if;

  -- 3. The index it replaces is gone, so there is one answer to "is this row a
  --    duplicate?" rather than two that can disagree.
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_goa_approval_qty_combo'
  ) then
    raise exception '0435: the old 3-column unique index is still present';
  end if;
end $$;
