-- ============================================================================
-- Raagam ERP — 0345 Recreate the KG stock unit
--
-- The Stock Unit master used to hard-delete rows even when in use; a user
-- deleted "kg" while materials referenced it (items.stock_uom_id is ON DELETE
-- SET NULL, so it vanished with no error and blanked those materials' units).
-- 0344 + the delete-guard change now deactivate-instead-of-delete an in-use
-- unit, so this can't recur — but the already-deleted "kg" still needs to come
-- back so the Yarn default (which always targets kg — see 0342) has a target.
--
-- Idempotent, same shape as 0342. Note: this "kg" gets a fresh UUID; materials
-- whose stock_uom_id was nulled by the earlier delete are NOT auto-relinked
-- (that link was destroyed) — they can be re-selected as needed.
-- ADD-ONLY.
-- ============================================================================

insert into public.uoms (code, name, is_active)
select 'kg', 'Kilograms', true
where not exists (select 1 from public.uoms where lower(code) = 'kg');

update public.uoms set is_active = true where lower(code) = 'kg';
