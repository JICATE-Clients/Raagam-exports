-- =============================================================================
-- 0339 — Remove BUTTON and EMBROIDERY ITEMS from the Item Class list
-- -----------------------------------------------------------------------------
-- Client: these two are not real item classes. Keep only the 7 genuine classes
-- (Capital Goods, Fabric, Garments, General, Packing Accessories, Sewing
-- Accessories, Yarn). Both are unreferenced — verified 0 FK rows across all 9
-- item_class FK tables (attribute_values, categories, commodities, compositions,
-- hsn_details, internal_work_orders, items, material_attributes,
-- out_document_terms) — so a hard delete is safe (block-vs-delete: delete when
-- never used). The old internal_work_orders link to BUTTON went away with the
-- Planning-module drop (0332).
-- =============================================================================
delete from public.config_lookups
where kind = 'item_class' and code in ('1000', 'EMB');
