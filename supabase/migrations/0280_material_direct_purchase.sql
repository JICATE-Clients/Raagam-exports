-- ============================================================================
-- Raagam ERP — 0280 Material Master corrections (business logic.md /
-- functional specification.md cross-check)
-- ============================================================================

-- 1) Fix seed mislabel: config_lookups fabric_type code 'solid' was named
--    "Grey" (0279) — functional spec is explicit: Solid = piece-dyed, a
--    dyeing method, not the undyed/grey state. Correct the display name.
update public.config_lookups
set name = 'Solid (Piece-dyed)'
where kind = 'fabric_type' and code = 'solid' and name = 'Grey';

-- 2) Direct Purchase flag (Fabric): "system MUST bypass the yarn composition
--    requirement" when the fabric is bought finished rather than knitted.
alter table public.items
  add column if not exists direct_purchase boolean not null default false;
