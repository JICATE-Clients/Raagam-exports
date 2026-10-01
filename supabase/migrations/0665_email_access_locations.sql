-- 0665 — LOCATIONS FOR EMAIL ACCESS, AND ONE "ANY LOCATION" GRANT PER ROLE
-- (client 2026-09-30, doc/order/budgetupdate.md §1: "assign multiple location
-- access permissions per user or role").
--
-- THE CLIENT'S DECISION (2026-09-30): people keep working in ONE unit at a time
-- (the topbar switcher). What a person may switch BETWEEN is the set this file
-- is about. Nothing here widens a list to several units at once.
--
-- ## WHAT ALREADY WORKED, AND WHAT DID NOT
--
-- A person's units have always been a SET: one `user_roles` row per (role,
-- location), NULL = every location, read by `has_location_access` (0326) and
-- through it by `my_locations()`, `current_location()`, `is_current_location()`
-- and every unit-scoped RLS policy. The Users screen simply wrote one row at a
-- time; it now writes one per ticked unit.
--
-- The GAP was email access (0658): a person given access by email — module and
-- screen grants with no role — had NO units, because `has_location_access`
-- reads `user_roles` only. Their switcher was empty and every unit-scoped list
-- refused them. This adds the units to email access:
--   * `user_access.all_locations` — the "any location" of an email grant;
--   * `user_access_locations` — the specific units, one row each.
-- Both count only while the email access itself is ACTIVE: switching it off
-- must take its units away with its permissions.
--
-- ## `has_location_access` ONLY GAINS AN OR
--
-- It sits under every unit-scoped policy, so the change is additive and the
-- existing two branches are byte-for-byte what 0326 wrote. A super admin, or a
-- role row, still answers exactly as before; the new branch can only ADD a
-- unit, never remove one. The email is matched case-folded, the same rule
-- `user_access_user_email_check` already enforces on the stored side.
--
-- ## ONE NULL GRANT PER ROLE
--
-- `unique(user_id, role_id, location_id)` (0001) does not stop two NULL rows —
-- NULLs are distinct — so "Merchandiser, any location" could be given twice.
-- A partial unique index closes it (none exist today, checked 2026-10-01).

alter table public.user_access
  add column if not exists all_locations boolean not null default false;

create table if not exists public.user_access_locations (
  user_email  text not null references public.user_access (user_email) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_email, location_id)
);

alter table public.user_access_locations enable row level security;

-- Read like `user_access` itself (ua_read): an administrator, or the person.
drop policy if exists ual_read on public.user_access_locations;
create policy ual_read on public.user_access_locations
  for select to authenticated
  using (public.has_permission('system_admin', 'view') or user_email = public.my_access_email());
-- No write policy: writes go through `save_user_access_locations` below.

create unique index if not exists user_roles_one_any_location
  on public.user_roles (user_id, role_id)
  where location_id is null;

create or replace function public.has_location_access(p_location_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.is_super_admin(uid)
    or exists (
      select 1
      from public.user_roles ur
      where ur.user_id = uid
        and (ur.location_id is null or ur.location_id = p_location_id)
    )
    -- 0665: the units of the person's ACTIVE email access.
    or exists (
      select 1
      from public.profiles p
      join public.user_access ua on ua.user_email = lower(btrim(p.email))
      where p.id = uid
        and ua.is_active
        and (
          ua.all_locations
          or exists (
            select 1
            from public.user_access_locations l
            where l.user_email = ua.user_email
              and l.location_id = p_location_id
          )
        )
    );
$function$;

-- THE ONE WRITE PATH. Replaces the person's units wholesale, so the screen's
-- ticks ARE the stored set. Needs system_admin:edit (the same check
-- `saveUserAccess` makes) and an existing `user_access` row — call it after
-- `save_user_permissions`, which creates that row.
create or replace function public.save_user_access_locations(
  p_email text,
  p_all boolean,
  p_locations uuid[]
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email text := lower(btrim(p_email));
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'You do not have permission to change access.';
  end if;
  if not exists (select 1 from public.user_access where user_email = v_email) then
    raise exception 'Give % email access first.', v_email;
  end if;

  update public.user_access
     set all_locations = coalesce(p_all, false),
         updated_by = auth.uid(),
         updated_at = now()
   where user_email = v_email;

  delete from public.user_access_locations where user_email = v_email;
  if not coalesce(p_all, false) and p_locations is not null then
    insert into public.user_access_locations (user_email, location_id)
    select v_email, l
      from (select distinct unnest(p_locations) as l) x
     where l is not null
    on conflict do nothing;
  end if;
end;
$function$;

-- AGENTS.md "Function grants": both halves of the anon default, in one statement.
revoke all on function public.save_user_access_locations(text, boolean, uuid[]) from public, anon;
grant execute on function public.save_user_access_locations(text, boolean, uuid[]) to authenticated;
