-- ============================================================================
-- Raagam ERP — 0003 Auth RPCs
-- Lets the signed-in user read their OWN effective permissions/roles even though
-- the underlying link tables are system_admin-only under RLS (SECURITY DEFINER).
-- ============================================================================

create or replace function public.my_permissions()
returns table(module text, action text)
language sql stable security definer set search_path = '' as $$
  select distinct p.module, p.action
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid();
$$;

create or replace function public.my_roles()
returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select distinct r.id, r.name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$$;
