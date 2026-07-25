-- =============================================================================
-- 0347 — One Material Attribute set per (Item Class + Category)
-- -----------------------------------------------------------------------------
-- The Material Attribute config must be unique per Item Class + Category — a
-- second set for the same pair is a duplicate (the user edits the existing one
-- instead). Enforced in createMaterialAttribute; this partial unique index is
-- the DB backstop. Partial (both non-null) so it never trips on legacy nulls,
-- and NULLs are distinct in Postgres anyway. Existing duplicates were removed
-- before this ran (kept the config with the most lines per pair).
-- =============================================================================
create unique index if not exists uq_material_attributes_class_category
  on public.material_attributes (item_class_id, category_id)
  where item_class_id is not null and category_id is not null;
