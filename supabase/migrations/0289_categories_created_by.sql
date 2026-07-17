-- ============================================================================
-- Raagam ERP — 0289 Categories: Created User + missing item class
-- Same "Created User" gap as Levies (0286) — legacy Categories list also
-- shows Created Dt/User per row, but categories never got created_by.
-- Also adds "EMBROIDERY ITEMS" as an item_class, confirmed present in the
-- full legacy Category export but missing from the 0223 seed list — and
-- re-adds "BUTTON" (code 1000), which 0223 originally seeded but had since
-- drifted out of the live config_lookups table (confirmed absent, blocking
-- one real category row from importing).
-- ============================================================================

alter table public.categories
  add column if not exists created_by uuid references public.profiles(id) default auth.uid();

insert into public.config_lookups (kind, code, name)
select 'item_class', 'EMB', 'EMBROIDERY ITEMS'
where not exists (
  select 1 from public.config_lookups where kind = 'item_class' and code = 'EMB'
);

insert into public.config_lookups (kind, code, name)
select 'item_class', '1000', 'BUTTON'
where not exists (
  select 1 from public.config_lookups where kind = 'item_class' and code = '1000'
);
