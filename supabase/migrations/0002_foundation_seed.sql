-- ============================================================================
-- Raagam ERP — 0002 Foundation seed
-- Locations, full permission catalog, system roles + grants.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------- locations (two GST entities) ----------
insert into public.locations (code, name) values
  ('HO', 'Head Office'),
  ('U2', 'Unit 2')
on conflict (code) do nothing;

-- ---------- permission catalog (module x action) ----------
-- All modules are listed (incl. future ones) so the admin RBAC matrix is
-- complete; only sales/orders/masters/system_admin/dashboard are wired this pass.
insert into public.permissions (module, action, description)
select m.module, a.action,
       initcap(a.action) || ' ' || replace(m.module, '_', ' ')
from unnest(array[
  'dashboard','system_admin','masters','sales','orders',
  'planning','materials_purchase','stores','production','process_planning',
  'hr_payroll','logistics','finance','integration'
]) as m(module)
cross join unnest(array[
  'view','create','edit','delete','approve','export'
]) as a(action)
on conflict (module, action) do nothing;

-- ---------- system roles ----------
insert into public.roles (name, description, is_system) values
  ('Administrator',     'Full system access',                              true),
  ('Managing Director', 'Approves amendments, POs, budgets, payroll',      true),
  ('Manager',           'Creates and approves sales & orders',             false),
  ('Merchandiser',      'Owns opportunities and orders end to end',        false)
on conflict (name) do nothing;

-- ---------- grants ----------
-- Administrator: everything
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.name = 'Administrator'
on conflict do nothing;

-- Managing Director: view + approve + export across all modules
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p
  on p.action in ('view', 'approve', 'export')
where r.name = 'Managing Director'
on conflict do nothing;

-- Manager: full sales/orders + approve, plus view dashboard/masters
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on (
     (p.module in ('sales', 'orders') and p.action in ('view','create','edit','approve','export'))
  or (p.module in ('dashboard', 'masters') and p.action = 'view')
)
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: create/edit sales & orders, view dashboard/masters
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on (
     (p.module in ('sales', 'orders') and p.action in ('view','create','edit'))
  or (p.module in ('dashboard', 'masters') and p.action = 'view')
)
where r.name = 'Merchandiser'
on conflict do nothing;
