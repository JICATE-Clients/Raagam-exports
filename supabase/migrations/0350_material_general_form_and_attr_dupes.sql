-- =============================================================================
-- 0350 — General item class form, attribute duplicates, asset ↔ material link
-- -----------------------------------------------------------------------------
-- Client walkthrough 2026-07-28, follow-up to 0348/0349. Four unrelated-looking
-- changes travel together because they landed in one review pass:
--
--   1. material_attribute_lines.unit_label — the "Unit" on a Value-In-Steps line
--      was a UOM-master dropdown, but it is only ever a printed suffix on the
--      generated values ("10 MM", "15 MM"). Nothing downstream converts by it.
--      Free text now; unit_id is KEPT and back-filled from so old rows round-trip
--      (minimal-forms rule: hide the legacy column, never drop it).
--
--   2. items.item_type_name / items.item_base_name — the General item class
--      stops re-using the accessory form (User defined + Transaction Type) and
--      gets its own two fields, from which the Name is auto-composed as
--      CATEGORY / SUB CATEGORY / ITEM TYPE / ITEM NAME.
--
--   3. assets.item_id — machinery bought as a Capital Goods material IS the
--      asset register's row. The register's free-text name becomes a picker over
--      CAP materials (consumables stay in General and are deliberately NOT
--      assets — the client's own split).
--
--   4. Unique indexes on the material-attribute children. The screen let the
--      same attribute be added twice to one set, and the same value be typed
--      twice inside one attribute, with nothing rejecting either. The UI now
--      blocks it; these indexes make it unrepresentable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Attribute line unit → free-text label
-- ---------------------------------------------------------------------------
alter table public.material_attribute_lines
  add column if not exists unit_label text;

-- Back-fill from whatever UOM the line already pointed at, so a line configured
-- before this migration keeps generating the same value strings.
--
-- `name`, NOT `code`, and this is load-bearing. The old screen's Unit dropdown
-- listed `u.name` and genOptions suffixed that same `name`, so a stepped line
-- generated "10 Kilogram", never "10 KG". Those strings were written into
-- item_attribute_values.value as TEXT on every material answered against them.
-- Seeding `code` here would regenerate the list as "10 KG" the next time anyone
-- re-saves the attribute set, and every stored answer would quietly stop
-- matching its own option. The label is ugly; a silently orphaned answer is
-- worse. Retype it on the line if you want the short form — that is a decision,
-- not a side effect of a migration.
update public.material_attribute_lines l
   set unit_label = u.name
  from public.uoms u
 where l.unit_id = u.id
   and l.unit_label is null;

comment on column public.material_attribute_lines.unit_label is
  'Free-text suffix appended to each generated step value (e.g. MM, INCH). '
  'Purely a label — no conversion meaning, no FK. Superseded unit_id, which is '
  'retained for round-trip only.';

-- ---------------------------------------------------------------------------
-- 2) General item class: Item Type + Item Name
-- ---------------------------------------------------------------------------
alter table public.items
  add column if not exists item_type_name text,
  add column if not exists item_base_name text;

comment on column public.items.item_type_name is
  'General item class only — the kind of thing (BRUSH, PEN, CABLE). Free text, '
  'third segment of the auto-composed Name.';
comment on column public.items.item_base_name is
  'General item class only — the specific item (NYLON 4 INCH). Free text, last '
  'segment of the auto-composed Name.';

-- Existing General materials were named by hand. Seed item_base_name from that
-- name so opening one in the rebuilt form shows its name back rather than a
-- blank field that would re-compose to "CATEGORY / /  /" on save.
update public.items i
   set item_base_name = i.name
  from public.categories c
  join public.config_lookups ic on ic.id = c.item_class_id
 where i.category_id = c.id
   and upper(coalesce(ic.code, '')) = 'GEN'
   and i.item_base_name is null
   and i.name is not null;

-- ---------------------------------------------------------------------------
-- 3) Asset ↔ Capital Goods material
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, not RESTRICT: the asset is the record of record here. If
-- someone retires the material master row, the physical machine still exists and
-- its register entry must survive — it just loses the link and keeps the name
-- and category text that were copied onto it at pick time.
alter table public.assets
  add column if not exists item_id uuid
    references public.items(id) on delete set null;

create index if not exists idx_assets_item on public.assets(item_id);

comment on column public.assets.item_id is
  'Optional link to the Capital Goods material this asset was purchased as. '
  'Null for one-off assets entered by name only.';

-- ---------------------------------------------------------------------------
-- 4) De-duplicate, then forbid duplicates
-- ---------------------------------------------------------------------------
-- Both tables may already hold duplicates created before the UI guard, so the
-- index cannot simply be created. Keep the FIRST row of each group (lowest sno,
-- then oldest) — that is the one the user typed first and the one whose id any
-- existing material answer would have been recorded against.

-- 4a) One attribute may appear only once per attribute set.
delete from public.material_attribute_lines l
 where l.attribute_id is not null
   and exists (
     select 1
       from public.material_attribute_lines k
      where k.material_attribute_id = l.material_attribute_id
        and k.attribute_id = l.attribute_id
        and k.attribute_id is not null
        and (k.sno, k.created_at, k.id) < (l.sno, l.created_at, l.id)
   );

create unique index if not exists uq_material_attribute_lines_attr
  on public.material_attribute_lines(material_attribute_id, attribute_id)
  where attribute_id is not null;

-- 4b) One value may appear only once per attribute line. Case- and
--     whitespace-insensitive: values are typed in CAPS but pasted data is not,
--     and "MAIN " vs "MAIN" is the same pick-list entry to the user.
delete from public.material_attribute_line_options o
 where exists (
   select 1
     from public.material_attribute_line_options k
    where k.material_attribute_line_id = o.material_attribute_line_id
      and upper(btrim(k.description)) = upper(btrim(o.description))
      and (k.sno, k.created_at, k.id) < (o.sno, o.created_at, o.id)
 );

create unique index if not exists uq_mal_options_desc
  on public.material_attribute_line_options(
    material_attribute_line_id, upper(btrim(description))
  );
