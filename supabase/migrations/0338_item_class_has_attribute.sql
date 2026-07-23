-- =============================================================================
-- 0338 — Item Class / Attribute split groundwork + Yarn Type "Twisted"
-- -----------------------------------------------------------------------------
-- Client update (doc/update.md #1-3, #13): Item Class and Attribute become two
-- separate master screens. Item Class gains a "Has Attribute (Yes/No)" flag; the
-- Attribute screen shows the value-adding section only for classes flagged Yes.
--
-- Already handled elsewhere (verified against live DB): the "Button" (Tava)
-- item-class purge (0282) and fabric_type = Solid / Yarn-dyed / Melange
-- (0279 + 0312). This migration only adds the new flag, the Twisted yarn type,
-- and a cosmetic dye-type label.
-- =============================================================================

-- 1) Has-Attribute flag on Item Class (config_lookups kind='item_class').
--    Genuinely new — the historical attributes.has_attributes column was dropped
--    with the attributes table in 0293.
alter table public.config_lookups
  add column if not exists has_attribute boolean not null default false;

-- Backfill: any Item Class that already carries attribute values → Has Attribute = Yes.
update public.config_lookups c
   set has_attribute = true
 where c.kind = 'item_class'
   and exists (
     select 1 from public.attribute_values v where v.item_class_id = c.id
   );

-- 2) Yarn Type list = Grey / Melange / Twisted / Doubling (0279 seeded the first
--    three; add Twisted). Respects the 0335 unique (kind, lower(trim(code))) index.
insert into public.config_lookups (kind, code, name, is_active)
select 'yarn_type', 'twisted', 'Twisted', true
where not exists (
  select 1 from public.config_lookups where kind = 'yarn_type' and code = 'twisted'
);

-- 3) Cosmetic: normalize the fabric dye-type label to the client's wording.
update public.config_lookups
   set name = 'Yarn Dyed'
 where kind = 'fabric_type' and code = 'yarn_dyed' and name <> 'Yarn Dyed';
