-- ============================================================================
-- Raagam ERP — 0425 Size Groups ▸ make the duplicate restriction hold at rest
--
-- Two separate holes, both reported by the operator as "the size master still
-- allows duplicates even though we already did the restriction". Both halves of
-- that sentence are true, and they are different bugs:
--
--   1. THE SAME SIZE TWICE INSIDE ONE GROUP. `size_group_sizes` has never had a
--      duplicate check at ANY layer — not the screen, not the action, not here.
--      `MENS TOP -> S, M, S` saves cleanly, and the damage is then silent:
--      the Style master's "Fill sizes" builds a name->id Map, so the third row
--      simply vanishes when the group is used.
--
--   2. TWO GROUPS WITH THE SAME NAME. Here the app-layer guard the operator
--      remembers really does exist and is correct (useDuplicateName on screen,
--      checkDuplicateName in both actions). What was missing is this file.
--      0317 — the migration whose STATED purpose was "add DB-level UNIQUE
--      constraints to match every field that dup-guard already checks" — skipped
--      it on a reading of the wrong column:
--
--          -- size_groups.size_group_no already has a plain UNIQUE in 0308, skip.
--
--      `size_group_no` is AUTO-GENERATED, and `generateUniqueCode` SUFFIXES on
--      collision (MENSTOP -> MENSTOP2). So that constraint can never fire, and
--      it was never a substitute for guarding the name. This is the exact trap
--      AGENTS.md "Duplicates" names: "Auto-generated codes do not make a master
--      safe." 0317's skip is superseded here.
--
-- THE NORMALISER IS `normName` (lib/masters/name-dictionary.ts), mirrored:
--     upper(regexp_replace(btrim(col), '\s+', ' ', 'g'))
-- Trim, COLLAPSE INTERNAL WHITESPACE, uppercase. The collapse is the one variant
-- the app layer misses today — `checkDuplicateName` trims and compares with
-- `ilike`, so "MENS  TOP" beside "MENS TOP" is not a duplicate to it. Adding the
-- same transform to the write-path schema (size-group-types.ts) is what keeps
-- this index from rejecting something the app just accepted.
--
-- A unique index cannot be built over existing duplicates, so each half is
-- cleaned first — AND THE TWO HALVES ARE CLEANED DIFFERENTLY ON PURPOSE.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Sizes within a group — DELETE the later collisions.
--
-- Safe to delete because `size_group_sizes` is a LEAF: nothing in the schema
-- references it (no `references public.size_group_sizes` anywhere). A repeated
-- size carries no information the earlier row does not already carry.
--
-- Keep the earliest by created_at, tie-broken on id so the choice is
-- deterministic when two rows were inserted in the same statement — which is
-- exactly how these got in (one grid save inserts the whole child set at once,
-- so identical timestamps are the COMMON case here, not the edge case).
-- ---------------------------------------------------------------------------
do $$
declare
  removed int;
begin
  with ranked as (
    select id,
           row_number() over (
             partition by size_group_id,
                          upper(regexp_replace(btrim(size_name), '\s+', ' ', 'g'))
             order by created_at, id
           ) as rn
      from public.size_group_sizes
  )
  delete from public.size_group_sizes s
   using ranked r
   where s.id = r.id
     and r.rn > 1;

  get diagnostics removed = row_count;
  if removed > 0 then
    raise notice '0425: removed % duplicate size row(s) from size_group_sizes', removed;
  end if;
end $$;

create unique index if not exists uq_size_group_sizes_group_name
  on public.size_group_sizes (
    size_group_id,
    upper(regexp_replace(btrim(size_name), '\s+', ' ', 'g'))
  );


-- ---------------------------------------------------------------------------
-- 2. Group names — RENAME the later collisions. NEVER DELETE.
--
-- `size_groups` is NOT a leaf. Four tables reference it, and the FK that decides
-- this is `garment_styles.size_group_id` (0392:58), declared with NO on-delete
-- clause — so it defaults to NO ACTION and a delete of any referenced group
-- would ABORT THIS MIGRATION. The other two (0309:125, 0323:19) are
-- `on delete set null`, which would silently erase a style's record of which
-- size group it was made in. Deleting would also cascade the group's own child
-- sizes (0308:92).
--
-- So a collision is suffixed and left for an operator to merge deliberately.
-- The loop re-checks after each rename, so a generated "X (2)" cannot itself
-- collide with a group already called that.
-- ---------------------------------------------------------------------------
do $$
declare
  dup      record;
  n        int;
  proposed text;
begin
  for dup in
    select id, size_group_name
      from (
        select id,
               size_group_name,
               row_number() over (
                 partition by upper(regexp_replace(btrim(size_group_name), '\s+', ' ', 'g'))
                 order by created_at, id
               ) as rn
          from public.size_groups
         where size_group_name is not null
           and btrim(size_group_name) <> ''
      ) t
     where t.rn > 1
     order by t.id
  loop
    n := 1;
    loop
      n := n + 1;
      proposed := btrim(dup.size_group_name) || ' (' || n || ')';
      exit when not exists (
        select 1
          from public.size_groups g
         where upper(regexp_replace(btrim(g.size_group_name), '\s+', ' ', 'g'))
             = upper(regexp_replace(btrim(proposed),          '\s+', ' ', 'g'))
      );
    end loop;

    update public.size_groups
       set size_group_name = proposed
     where id = dup.id;

    raise notice '0425: renamed duplicate size group "%" -> "%" (id %)',
      dup.size_group_name, proposed, dup.id;
  end loop;
end $$;

-- PARTIAL, because `size_group_name` is nullable and several unnamed groups must
-- stay legal — a bare unique index would let exactly one of them exist.
create unique index if not exists uq_size_groups_name
  on public.size_groups (
    upper(regexp_replace(btrim(size_group_name), '\s+', ' ', 'g'))
  )
  where size_group_name is not null and btrim(size_group_name) <> '';

-- The index deliberately covers INACTIVE groups too. A deactivated group keeps
-- its name reserved; excluding them would let a new group take the name and then
-- make reactivating the old one impossible — a collision nothing could resolve.
