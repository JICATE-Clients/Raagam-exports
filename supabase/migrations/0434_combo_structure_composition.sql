-- 0434 — Garment Order ▸ Combos ▸ Structure Details: the Composition cell reads
-- the COMPOSITION MASTER again.
--
-- PARTIALLY REVERSES 0430, and only one half of it. 0430 replaced
-- `composition_id -> compositions(id)` with `fabric_item_id -> items(id)` on two
-- charges, both true at the time:
--
--   1. "a category has no composition; a FABRIC does" — so an FK to the master
--      could never be FETCHED from the previous tab, only typed, and the client
--      had just asked for it to arrive by itself (screenshot 2324).
--   2. the master's picker was empty anyway — its feeder selected `blocked` on a
--      table whose column has been `inactive` since 0299.
--
-- Charge 2 was a bug and is fixed in this change (composition-actions.ts and
-- composition-service.ts). Charge 1 is answered by a DERIVATION rather than by
-- ignoring it: a fabric's `material_mixings` reduces to a multiset of
-- (yarn category, pct), and `composition_lines` stores exactly that multiset —
-- so Structure -> its sole fabric -> that blend -> the composition stating it IS
-- a fetch. `compositionForStructure()` in lib/orders/amendments/combo-rules.ts
-- is that hop, and the screen and the seeder both call it, so the two halves
-- cannot drift.
--
-- WHAT MADE IT WORTH REVISITING AT ALL: the master's `name` is now composed from
-- its own Mixing grid, so a row reads `COTTON MODAL 20%, GREY MELANGE MIXED 80%`
-- instead of the opaque `Test Composition` that made 0408's picker look unwired.
-- A composition row is now a self-describing value; in August it was a handle.
--
-- PRE-FLIGHT, the same catalog check 0408 and 0430 each ran before dropping:
--   select count(*), count(fabric_item_id)
--     from public.garment_order_amendment_combo_structures;  -- => 0, 0
-- Zero rows, so this is a drop-and-add rather than the usual freeze. The freeze
-- convention protects STORED VALUES and there are none.
--
-- `fabric_item_id` IS DROPPED, and that was a decision, not an oversight. It was
-- only ever the vehicle for this value: the Structure still records the fabric
-- CATEGORY, and the fabric is re-derivable from it at any moment by the same
-- `soleFabricIn` rule that seeded it. Keeping it as provenance was considered and
-- rejected — a column no control renders is a column nothing writes (
-- `writeComboTree` deletes and re-inserts wholesale, so it would be NULL on every
-- save), and it would need a second invariant tying it to `composition_id`.
-- Before 0430 the order never recorded a fabric material and nothing missed it.
-- IF THE FABRIC BOM EVER WANTS TO SEED `fabric_bom_lines.item_id` FROM THE ORDER,
-- putting the column back is one `add column` here plus its row-state / payload /
-- Zod / writeComboTree / diff lines — say so rather than re-deriving the debate.
--
-- No function is created or altered, so the Function Grants rule (AGENTS.md) has
-- nothing to do here.

alter table public.garment_order_amendment_combo_structures
  drop column if exists fabric_item_id;

alter table public.garment_order_amendment_combo_structures
  add column if not exists composition_id uuid references public.compositions(id);

comment on column public.garment_order_amendment_combo_structures.composition_id is
  'The fibre blend this structure is made of — a row of the Composition master '
  '(0225). Seeded from the structure''s sole fabric where that is unambiguous '
  '(compositionForStructure), hand-picked otherwise. Never narrowed by structure '
  'in the picker: a composition is a property of the fabric, not of the category.';

create index if not exists idx_gaacs_composition
  on public.garment_order_amendment_combo_structures(composition_id);

do $$
begin
  -- 1. The column exists and its FK resolves to the MASTER. This is 0408 §5c
  --    restored verbatim, and it is asserted rather than trusted for the reason
  --    it states: pointing it at the wrong table compiles, lists nothing and
  --    saves fine. That is the whole failure mode this file exists to undo.
  if not exists (
    select 1
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.conrelid  = 'public.garment_order_amendment_combo_structures'::regclass
       and c.contype   = 'f'
       and a.attname   = 'composition_id'
       and c.confrelid = 'public.compositions'::regclass
  ) then
    raise exception '0434: composition_id does not point at public.compositions (0225)';
  end if;

  -- 2. The column it replaces is really gone. A migration that "applied
  --    successfully" while leaving both columns standing would leave two answers
  --    to one question and no error anywhere — 0386 shipped exactly that shape.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'garment_order_amendment_combo_structures'
       and column_name  = 'fabric_item_id'
  ) then
    raise exception '0434: fabric_item_id is still present';
  end if;

  -- 3. RLS is untouched by a column swap, so this is a regression guard, not a
  --    grant: 0408 declared four policies and four is what must still be there.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename  = 'garment_order_amendment_combo_structures') <> 4 then
    raise exception '0434: expected 4 policies on garment_order_amendment_combo_structures';
  end if;
end $$;
