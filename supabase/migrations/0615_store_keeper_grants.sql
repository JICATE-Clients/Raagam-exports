-- ============================================================================
-- Raagam ERP — 0615 Store Keeper can name a vendor and an order
--
-- The Store Keeper role (0010) holds stores:view/create/edit and nothing else.
-- That reads as "store-limited", and it was never exercised: until 2026-09-22
-- every login in this database was a super admin, so no Stores screen had ever
-- been rendered under the role's own grants. The first real Store Keeper login
-- (the RBAC audit's `store.audit@raagam.test`) found two pickers empty by RLS,
-- not by data:
--
--   • Process Orders ▸ New picks a live RE No from `sales_orders`, whose read
--     policy is `has_permission('orders','view') and is_current_location(...)`.
--     With no orders:view the list is empty and a process order cannot name
--     the order it serves.
--   • Vendor Returns and Process Orders list `vendors`, whose read policy is
--     `has_permission('materials_purchase','view')`. GRN itself lives under
--     /purchase/grn behind the same key. A return cannot name its vendor.
--
-- Both are VIEW grants: the keeper still cannot create or edit an order or a
-- purchase document, and the unit scope on `sales_orders` still narrows the
-- list to the unit they are standing in.
--
-- NOT granted here, deliberately: `materials_purchase:create`. Raising a GRN
-- needs it (`grn-actions.ts`), and a keeper receiving goods is that GRN's
-- natural author — but the same key also raises a purchase order and an
-- indent, because permissions are module-grained (`module:action`, 0001).
-- Whether the keeper receives, or Purchase receives for them, is the client's
-- call, and the honest way to give a keeper GRN-only write is finer keys, not
-- this grant. Recorded in the audit memo; decide there.
--
-- Store access itself (`store_access`, 0010) is per-person data, granted on the
-- store's own page (Stores ▸ <store> ▸ Access). It is not seeded here: a
-- migration cannot know which keeper owns which store.
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on (p.module = 'orders'             and p.action = 'view')
  or (p.module = 'materials_purchase' and p.action = 'view')
where r.name = 'Store Keeper'
on conflict do nothing;
