-- ============================================================================
-- Raagam ERP — 0438  Size Groups ▸ bind a group's sizes to the Sizes master
--
-- `size_group_sizes` names its sizes as FREE TEXT (`size_name`), while every
-- document that uses a size points at `config_lookups` kind='size' by uuid
-- (`garment_style_sizes.size_id`, `order_amendment_style_sizes.size_id`, the
-- approval-qty tree, the assortment cells). Two stores for one fact, joined by
-- nothing.
--
-- THEY HAVE ALREADY DIVERGED, and this is not hypothetical: on the live database
-- today `size_group_sizes` holds **XXXL**, and there is no `config_lookups` row
-- of kind='size' with that name. A group naming a size the master has never
-- heard of is a group that cannot be used to fill anything.
--
-- ## WHY NOW, AND NOT AFTER THE SIZE GROUPS ARE ENTERED
--
-- There is ONE size group in this database (`Test Size Group`, 6 sizes). The
-- Sizes picker rework (screenshot 2392, 2026-08-19) is about to make Size Groups
-- load-bearing, at which point real groups get entered in bulk. Every group
-- entered against the text binding is more to backfill later, and the backfill
-- is the risky half — it is the step that has to GUESS which master row a name
-- meant. Six rows is the cheapest this migration will ever be.
--
-- ## WHAT THIS DOES NOT DO
--
-- `size_name` is KEPT, and keeps its 0425 unique index. It is the column the
-- Size Group master's grid writes today and the column `lib/masters/
-- size-group-actions.ts` normalises through `normName`; dropping it is a screen
-- change, not a schema change, and belongs with the work that turns that grid
-- into a picker. After this migration `size_id` is the AUTHORITY and `size_name`
-- is the echo — stated in the column comments below so the next reader does not
-- have to infer it.
--
-- `size_id` stays NULLABLE for the same reason. Making it NOT NULL would reject
-- every insert from the existing grid, which does not know about the column yet.
-- The partial unique index and the resolving trigger below are what keep it
-- honest in the meantime; tightening to NOT NULL is a follow-up migration once
-- the grid picks from the master.
--
-- THE NORMALISER IS `normName` (lib/masters/name-dictionary.ts), mirrored the
-- same way 0425 mirrors it:
--     upper(regexp_replace(btrim(col), '\s+', ' ', 'g'))
-- Trim, COLLAPSE INTERNAL WHITESPACE, uppercase. Matching on anything looser
-- would pair a group's size with the wrong master row, which is worse than not
-- matching at all — a wrong FK is invisible, a null one is not.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- NO ACTION on delete (the default), deliberately — NOT `on delete set null`
-- and NOT `cascade`. `first_referencing_table` (0344) is how the masters delete
-- guard decides "this row is in use, deactivate it instead", and it finds a
-- referencing table by the FK. A cascade would make a size vanish from every
-- group the moment someone deleted it from the master; `set null` would leave
-- the group holding a name with no referent, which is the exact state this
-- migration exists to end.
-- ---------------------------------------------------------------------------
alter table public.size_group_sizes
  add column if not exists size_id uuid references public.config_lookups(id);

create index if not exists idx_size_group_sizes_size
  on public.size_group_sizes (size_id);


-- ---------------------------------------------------------------------------
-- 2. Backfill what already matches.
-- ---------------------------------------------------------------------------
do $$
declare
  matched int;
begin
  update public.size_group_sizes s
     set size_id = l.id
    from public.config_lookups l
   where l.kind = 'size'
     and s.size_id is null
     and upper(regexp_replace(btrim(l.name),      '\s+', ' ', 'g'))
       = upper(regexp_replace(btrim(s.size_name), '\s+', ' ', 'g'));

  get diagnostics matched = row_count;
  raise notice '0438: matched % existing size row(s) to the Sizes master', matched;
end $$;


-- ---------------------------------------------------------------------------
-- 3. CREATE the master rows the backfill could not match — never drop the row.
--
-- A size named in a group and missing from the master is the divergence being
-- fixed, so the fix is to make the master complete, not to quietly forget that
-- the group said it. `XXXL` is the row this exists for today.
--
-- `code` is set to the same normalised name because that is how every existing
-- size row in this database looks (`L`/`L`, `XXL`/`XXL`), and because
-- `uq_config_lookups_kind_code` is a real unique index — leaving code null would
-- be legal but would make these rows the only sizes without one.
--
-- `created_by` is TEXT on this table and holds verbatim legacy usernames
-- ("SELVARAJ", "admin") as well as uuids (0290). Naming the migration is the
-- honest answer for a row no person created: the default is `auth.uid()`, which
-- is NULL inside a migration, and inventing a person would be a lie in an audit
-- column.
--
-- `on conflict do nothing` guards the case where two group rows normalise to the
-- same name — the insert is per DISTINCT normalised name, but the conflict
-- target also has to survive a concurrent writer.
-- ---------------------------------------------------------------------------
do $$
declare
  created int;
begin
  insert into public.config_lookups (kind, code, name, is_active, created_by)
  select distinct
         'size',
         upper(regexp_replace(btrim(s.size_name), '\s+', ' ', 'g')),
         upper(regexp_replace(btrim(s.size_name), '\s+', ' ', 'g')),
         true,
         '0438 backfill'
    from public.size_group_sizes s
   where s.size_id is null
     and btrim(coalesce(s.size_name, '')) <> ''
  on conflict do nothing;

  get diagnostics created = row_count;
  if created > 0 then
    raise notice '0438: created % missing size(s) in the Sizes master', created;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 4. Backfill again, now that the master is complete.
-- ---------------------------------------------------------------------------
do $$
declare
  remaining int;
begin
  update public.size_group_sizes s
     set size_id = l.id
    from public.config_lookups l
   where l.kind = 'size'
     and s.size_id is null
     and upper(regexp_replace(btrim(l.name),      '\s+', ' ', 'g'))
       = upper(regexp_replace(btrim(s.size_name), '\s+', ' ', 'g'));

  select count(*) into remaining
    from public.size_group_sizes
   where size_id is null
     and btrim(coalesce(size_name, '')) <> '';

  if remaining > 0 then
    raise exception '0438: % size row(s) still unresolved after backfill', remaining;
  end if;
  raise notice '0438: every named size row now points at the Sizes master';
end $$;


-- ---------------------------------------------------------------------------
-- 5. Keep the two in step for every writer, not just the screen.
--
-- The Size Group grid still posts a NAME, and `lib/data-io` and any hand-written
-- SQL bypass the action entirely — the standing lesson that an action-level
-- guard protects only the door it is nailed to. A trigger is the one layer they
-- all pass through.
--
-- IT RESOLVES; IT DOES NOT CREATE. That asymmetry with step 3 is deliberate and
-- is a PERMISSIONS boundary, not an oversight. Creating a master row from a
-- trigger would need `security definer` to get past RLS, and that would hand
-- anyone who can edit a size group the ability to write the Sizes master —
-- which the app gates on `masters:create` (see `createLookupValue`, and the
-- `onCreate` gate on the Sizes picker). A name with no master row therefore
-- lands as NULL, which is visible and reportable, rather than as a silent
-- privilege escalation.
--
-- Only touches rows where the caller did not set `size_id` itself, so a future
-- picker-based grid that posts the id directly is passed straight through.
-- ---------------------------------------------------------------------------
create or replace function public.size_group_sizes_resolve_size_id()
returns trigger
language plpgsql
as $$
begin
  if new.size_id is null and btrim(coalesce(new.size_name, '')) <> '' then
    select l.id
      into new.size_id
      from public.config_lookups l
     where l.kind = 'size'
       and upper(regexp_replace(btrim(l.name),        '\s+', ' ', 'g'))
         = upper(regexp_replace(btrim(new.size_name), '\s+', ' ', 'g'))
     order by l.created_at, l.id
     limit 1;
  end if;
  return new;
end $$;

-- Not callable directly by anyone — a trigger function needs no grant, and the
-- standing rule is that `public` and `anon` are revoked in ONE statement because
-- Postgres's built-in EXECUTE TO PUBLIC and Supabase's default privilege are two
-- independent grants (AGENTS.md "Function grants", 0385 · 0386).
revoke all on function public.size_group_sizes_resolve_size_id() from public, anon;

drop trigger if exists trg_size_group_sizes_resolve_size_id on public.size_group_sizes;
create trigger trg_size_group_sizes_resolve_size_id
  before insert or update of size_name, size_id on public.size_group_sizes
  for each row
  execute function public.size_group_sizes_resolve_size_id();


-- ---------------------------------------------------------------------------
-- 6. One size per group, by IDENTITY as well as by name.
--
-- 0425 already forbids the same NAME twice in a group. That index cannot see two
-- rows naming the SAME master row by different spellings, which is a live risk
-- precisely because the master holds aliases — `XXXL` and `3XL` are one size and
-- both are in this database.
--
-- PARTIAL, because `size_id` is nullable by design (see the header): a bare
-- unique index would let exactly one unresolved row exist per group.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_size_group_sizes_group_size
  on public.size_group_sizes (size_group_id, size_id)
  where size_id is not null;


-- ---------------------------------------------------------------------------
-- 7. Say which column is the authority, in the schema itself.
-- ---------------------------------------------------------------------------
comment on column public.size_group_sizes.size_id is
  'THE size — config_lookups kind=''size''. Authority as of 0438; size_name is '
  'the echo kept for the grid that still types names. Nullable only until that '
  'grid picks from the master; a null means the name resolved to nothing.';

comment on column public.size_group_sizes.size_name is
  'Legacy free-text name. Kept in step with size_id by '
  'trg_size_group_sizes_resolve_size_id. Read size_id, not this, for anything '
  'that has to join to a document.';
