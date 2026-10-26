-- ============================================================================
-- 0742 — Resolve Hub: rh_people(), the one list behind the assignee,
--        caretaker, team-lead and member pickers.
--
-- profiles_read_own lets a non-admin read only their OWN profile row, so a
-- picker built under RLS would offer nobody. This returns id + name only —
-- the same narrow shape creator_names() exposes — for active logins allocated
-- to the caller's CURRENT unit (or super admins, who reach every unit).
-- No unit → no rows. Only workers, triage and admins may ask.
-- ============================================================================

create or replace function public.rh_people()
returns table (id uuid, name text)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_loc uuid := public.current_location();
begin
  if not (public.has_permission('resolve', 'edit')
          or public.has_permission('resolve', 'approve')
          or public.has_permission('resolve', 'create')) then
    raise exception 'You do not have access to the Resolve Hub people list.' using errcode = 'P0001';
  end if;
  if v_loc is null then
    return;
  end if;
  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)
    from public.profiles p
   where p.is_active
     and public.has_location_access(v_loc, p.id)
   order by 2;
end;
$$;

revoke all on function public.rh_people() from public, anon;
grant execute on function public.rh_people() to authenticated;
