-- ============================================================================
-- Raagam ERP — 0456 A requirement ROW records the grain that produced it
--
-- 0455 gave a BOM line its explosion grain as a set of axes. This is the other
-- end of the same wire: the rows that grain explodes into have to record what
-- produced them, and today they cannot.
--
--
-- ## THE BLOCKER, FOUND BY READING THE CATALOG RATHER THAN THE CODE
--
--     material_bom_amendment_requirements_basis_check
--       CHECK (basis = ANY (ARRAY['order','style','colour','size','combination','country']))
--
-- `basis` is NOT NULL and admits exactly the six legacy names. A composed grain
-- has no name among them — `{style_ref, colour, size, country}` is the client's
-- #16, and it is precisely the grain that has no basis — so a requirement row
-- built from it could not be inserted at all. The save would die on a constraint
-- whose message names a column the operator has never heard of.
--
-- The three wrong ways out, and why each is worse:
--
--   * WIDEN THE CHECK to admit a serialized grain string. That makes one column
--     hold two vocabularies, and `basis = 'colour'` and `basis = 'style_ref+colour'`
--     would mean the same thing while comparing unequal — the case-mismatch
--     failure AGENTS.md records under Nominated vendors, with extra steps.
--   * STORE THE NEAREST BASIS. A row that says `combination` when it was cut by
--     destination is a lie in a provenance column, and 0418's whole argument for
--     storing the inputs beside the answer is that a stored row must be
--     re-derivable from its own columns.
--   * DROP THE CHECK. It is what stopped `basis` ever holding "Color-wise"
--     (0418 asserts exactly that), and the six names still mean what they meant.
--
-- So: the grain joins the row as its own column, and `basis` becomes NULLABLE —
-- kept, still CHECKed when present, and written for every grain that HAS one of
-- the six names, which is eight of the nine producible grains. Nothing that
-- reads `basis` today stops working; only the composed grains leave it null.
-- ============================================================================


-- ---------- 1. the column -------------------------------------------------

alter table public.material_bom_amendment_requirements
  add column if not exists requirement_grain text[];

comment on column public.material_bom_amendment_requirements.requirement_grain is
  'The grain that produced this row, as a canonical set of axes (0456). The authoritative provenance; `basis` beside it is the legacy name and is NULL for a grain that has none. See lib/orders/bom-explosion/exploder.ts.';

alter table public.material_bom_amendment_requirements
  drop constraint if exists chk_mba_req_grain_canonical;

alter table public.material_bom_amendment_requirements
  add constraint chk_mba_req_grain_canonical
  check (
    requirement_grain is null
    or requirement_grain = public.mba_canonical_grain(requirement_grain)
  );


-- ---------- 2. `basis` becomes nullable, and KEEPS its CHECK --------------
--
-- Dropping NOT NULL is a widening: every value the column held is still legal,
-- so no stored row can be invalidated. The CHECK stays exactly as it was, which
-- is what keeps 0418's assertion true — `basis` still cannot hold "Color-wise".

alter table public.material_bom_amendment_requirements
  alter column basis drop not null;

comment on column public.material_bom_amendment_requirements.basis is
  'The LEGACY grain name, one of six. NULLABLE since 0456: a composed grain (e.g. Style Ref / Colour / Size / Country) has no name among the six, and `requirement_grain` beside it is the authoritative provenance.';


-- ---------- 3. backfill ----------------------------------------------------
--
-- Same mapping as 0455's, and it must stay the same mapping — two tables
-- disagreeing about what `colour` means is the drift both columns exist to
-- prevent. Every basis the CHECK admits is listed; the assertion below refuses
-- a migration that forgets one, which is the mistake that would silently rewrite
-- country-wise rows as whole-order.

update public.material_bom_amendment_requirements
   set requirement_grain =
     case basis
       when 'order'       then array[]::text[]
       when 'style'       then array['style_ref']::text[]
       when 'colour'      then array['style_ref', 'colour']::text[]
       when 'size'        then array['size']::text[]
       when 'combination' then array['style_ref', 'colour', 'size']::text[]
       when 'country'     then array['country']::text[]
       else null
     end
 where requirement_grain is null;


-- ---------- 4. assertions ---------------------------------------------------
--
-- VERIFY FROM THE CATALOG, NEVER BY READING THE MIGRATION (AGENTS.md).

do $assert$
declare
  v_basis text;
  v_grain text[];
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name  = 'requirement_grain'
  ) then
    raise exception '0456: requirements.requirement_grain was not added';
  end if;

  -- `basis` must now accept NULL, or a composed grain still cannot be stored.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name  = 'basis'
       and is_nullable  = 'NO'
  ) then
    raise exception '0456: requirements.basis is still NOT NULL — a composed grain cannot be stored';
  end if;

  -- AND IT MUST STILL BE CHECKED. Relaxing NOT NULL must not become relaxing the
  -- vocabulary: 0418 asserts this column can never hold "Color-wise".
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.material_bom_amendment_requirements'::regclass
       and conname  = 'material_bom_amendment_requirements_basis_check'
  ) then
    raise exception '0456: the basis CHECK was lost — it is what stops "Color-wise" being stored';
  end if;

  -- The same per-basis mapping assertion 0455 carries, for the same reason: an
  -- omitted branch silently rewrites those rows onto a different grain.
  for v_basis in
    select unnest(array['order', 'style', 'colour', 'size', 'combination', 'country'])
  loop
    v_grain :=
      case v_basis
        when 'order'       then array[]::text[]
        when 'style'       then array['style_ref']::text[]
        when 'colour'      then array['style_ref', 'colour']::text[]
        when 'size'        then array['size']::text[]
        when 'combination' then array['style_ref', 'colour', 'size']::text[]
        when 'country'     then array['country']::text[]
        else null
      end;
    if v_grain is null then
      raise exception '0456: basis "%" has no grain in the backfill', v_basis;
    end if;
  end loop;

  -- No row left non-canonical, and none with a basis left without a grain.
  if exists (
    select 1 from public.material_bom_amendment_requirements
     where requirement_grain is not null
       and requirement_grain <> public.mba_canonical_grain(requirement_grain)
  ) then
    raise exception '0456: a stored requirement grain is not canonical';
  end if;

  if exists (
    select 1 from public.material_bom_amendment_requirements
     where basis is not null and requirement_grain is null
  ) then
    raise exception '0456: a requirement row with a basis was left with no grain';
  end if;
end $assert$;
