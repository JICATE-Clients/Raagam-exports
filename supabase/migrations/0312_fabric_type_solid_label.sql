-- Drop the redundant "(Piece-dyed)" qualifier from the Fabric Type "Solid"
-- label — the Fabric Type picker already reads clean (Melange, Solid,
-- Yarn-dyed) since the code/name slug-duplication fix; this was the one
-- value with extra wording baked into `name` itself.
update config_lookups set name = 'Solid' where kind = 'fabric_type' and code = 'solid';
