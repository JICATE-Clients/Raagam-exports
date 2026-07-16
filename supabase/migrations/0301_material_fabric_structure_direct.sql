-- Fabric: Structure becomes a direct field on the material itself, matching
-- the legacy Material screen (Item Class FABRIC has no Category field at all
-- there — just Type/Structure, Fabric Type, Direct Purchase, Using). Reverses
-- the 0279 decision to inherit Structure read-only from Category.
alter table items add column if not exists fabric_structure_id uuid references config_lookups(id);

-- Backfill from the existing category's structure for any Fabric items saved
-- under the old Category-inherits-Structure path, so no data is lost.
update items i
set fabric_structure_id = c.fabric_structure_id
from categories c
where i.category_id = c.id
  and i.fabric_structure_id is null
  and c.fabric_structure_id is not null;
