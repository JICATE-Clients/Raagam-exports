-- Fabric: "Using" (Single Yarn / Multiple Yarn) — legacy field, stored only,
-- no behavior change to the mixing/attributes grid.
alter table items add column if not exists fabric_using text;
