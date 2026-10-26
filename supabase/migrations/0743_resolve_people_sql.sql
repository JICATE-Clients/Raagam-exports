-- ============================================================================
-- 0743 — Resolve Hub: rh_people() as the lead's contract states it.
--
-- 0742 shipped it as plpgsql that RAISED for a caller without staff rights.
-- The contract is a plain stable SQL function that returns NO ROWS instead
-- (a reporter simply has no picker), and analytics (`export`) counts as staff.
-- Same signature, same grants: id + name only, active logins that may reach
-- the caller's current unit; no unit → no rows.
-- ============================================================================

create or replace function public.rh_people()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.full_name, p.email)
    from public.profiles p
   where p.is_active
     and public.current_location() is not null
     and public.has_location_access(public.current_location(), p.id)
     and (   public.has_permission('resolve', 'edit')
          or public.has_permission('resolve', 'approve')
          or public.has_permission('resolve', 'create')
          or public.has_permission('resolve', 'export'))
   order by 2
$$;

revoke all on function public.rh_people() from public, anon;
grant execute on function public.rh_people() to authenticated;
