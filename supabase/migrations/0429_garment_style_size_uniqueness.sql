-- ============================================================================
-- Raagam ERP — 0429 Style master ▸ a style cannot be made in the same size twice
--
-- Client 2026-08-17: "fix the Size tab UI; currently the field size is too long
-- and not working correctly". The first half was layout and was answered in the
-- screen (`inlineCards`); THIS is the second half. Screenshot 2316 shows a
-- Sizes tab reading L, L, M, M — the picker offered every size on every row,
-- nothing rejected the repeat on save, and `garment_style_sizes` (0124) carries
-- no unique index, so it stored cleanly and read back as two identical rows.
--
-- IT IS NOT A COSMETIC DUPLICATE. `garment_style_sizes` is where the Garment
-- Order seeds its own per-style size grid from (0407), so one repeat here
-- becomes a repeated size on every order raised against the style, and every
-- size-wise quantity downstream is keyed on that set.
--
-- THREE LAYERS, AND THIS IS THE LAST ONE. Same arrangement 0407 already uses on
-- the order side, deliberately, so the two ends of the chain guard one question
-- one way:
--
--   1. the screen passes the sibling ids to the picker as `usedIds`, so a second
--      pick is never OFFERED rather than rejected after the fact;
--   2. `normalizeSizes` (lib/orders/styles/actions.ts) de-duplicates before
--      insert, first occurrence winning, so the operator's order survives;
--   3. this index, for any writer that never sees either.
--
-- Point 3 is worth stating rather than assuming. `garment_styles` is NOT a
-- `lib/data-io` entity today — nothing in `lib/data-io/entities.ts` names it, a
-- fact `lib/orders/styles/types.ts` already records — so there is no import path
-- past the action right now. The index is what keeps that true the day one is
-- added, which is exactly the shape AGENTS.md's "Duplicates" section warns
-- about: "a screen-only check protects nothing", because the guard and the door
-- it guards get built at different times by different people.
--
-- NULLS ARE NOT CAUGHT, AND THAT IS CORRECT. Nulls compare as distinct in
-- Postgres, so a row with no size at all does not collide with another. A blank
-- size row is what the operator is standing in the middle of typing;
-- `normalizeSizes` has already dropped it before insert, and a unique index is
-- not the place to say "answer the question" (0407's wording, same reason).
--
-- CLEANED FIRST, because a unique index cannot be built over existing
-- duplicates. The live database held ZERO on 2026-08-17 (13 size rows across 3
-- styles, no repeated pair), so the block below is expected to be a no-op — it
-- is here because this file must also apply cleanly to a database that has been
-- typed into since that check, and because a migration that only works against
-- one snapshot is a migration that fails on the next environment.
--
-- DELETE is safe here in a way it was NOT in 0425. `garment_style_sizes` is a
-- LEAF — nothing in the schema references it (no `references
-- public.garment_style_sizes` anywhere), and the amendment side keys on
-- `config_lookups.id` directly (0407) rather than on these rows. 0425 had to
-- RENAME its `size_groups` collisions instead, because four tables reference
-- that one and `garment_styles.size_group_id` has no on-delete clause. A
-- repeated size carries nothing the earlier row does not already carry.
--
-- Keep the earliest by `sno`, then `created_at`, then `id`. `sno` leads because
-- it is the operator's own ordering and the column `service.ts` sorts on;
-- `created_at` alone would tie constantly, since `writeChildren` inserts the
-- whole child set in one statement, so identical timestamps are the COMMON case
-- here rather than the edge case (0425 records the same trap).
-- ============================================================================

do $$
declare
  removed int;
begin
  with ranked as (
    select id,
           row_number() over (
             partition by style_id, size_id
             order by sno, created_at, id
           ) as rn
      from public.garment_style_sizes
     where size_id is not null
  )
  delete from public.garment_style_sizes s
   using ranked r
   where s.id = r.id
     and r.rn > 1;

  get diagnostics removed = row_count;
  if removed > 0 then
    raise notice '0429: removed % duplicate size row(s) from garment_style_sizes', removed;
  end if;
end $$;

create unique index if not exists uq_garment_style_sizes_size
  on public.garment_style_sizes (style_id, size_id);
