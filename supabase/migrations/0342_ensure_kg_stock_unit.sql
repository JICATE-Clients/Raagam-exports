-- ============================================================================
-- Raagam ERP — 0342 Ensure the KG stock unit exists and is active
--
-- Yarn materials always default their UOMs to KG (client 2026-07-23 #15 and
-- follow-up: "create the stock unit and show it"). The kg row was seeded in
-- 0004, but the Stock Unit master hard-deletes unused rows and can deactivate
-- it — either would make the Yarn default silently do nothing. Re-seed
-- idempotently (case-insensitive, in case it was recreated as "KG") and force
-- it active so the default always has a target.
-- ============================================================================

insert into public.uoms (code, name, is_active)
select 'kg', 'Kilograms', true
where not exists (select 1 from public.uoms where lower(code) = 'kg');

update public.uoms set is_active = true where lower(code) = 'kg';
