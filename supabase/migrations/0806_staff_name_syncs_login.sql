-- 0806 — a Staff rename reaches the person's login (user 2026-11-03).
--
-- The login's name (profiles.full_name, which the topbar, Created User,
-- approvals and every "who" in the app read) is COPIED from the Staff record
-- once, when Users & Access creates the login (lib/users/actions.ts), and
-- nothing ever copied it again. So renaming SIVABALA HARI SUDHAN to SUDHAN in
-- HR & Payroll ▸ People ▸ Staff changed the staff row and left every screen
-- showing the old name.
--
-- A trigger, not a line in the Staff save action: staff is written from more
-- than one place (the HR screen, the self-service profile, lib/data-io
-- imports), and a rule in one action leaks through every other door.
--
-- Matched the same way the login was found at creation: by email, or by
-- employee code. auth.users' metadata is kept in step too, so the two copies
-- of the name cannot disagree.

create or replace function public.sync_login_name_from_staff()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.name is null or btrim(new.name) = '' then
    return new;
  end if;
  if new.name is not distinct from old.name
     and new.email is not distinct from old.email
     and new.code is not distinct from old.code then
    return new;
  end if;

  with hit as (
    update public.profiles p
       set full_name = new.name
     where (   (new.email is not null and lower(p.email) = lower(btrim(new.email)))
            or (new.code is not null and p.employee_code = new.code))
       and p.full_name is distinct from new.name
    returning p.id
  )
  update auth.users u
     set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('full_name', new.name)
    from hit
   where u.id = hit.id;

  return new;
end;
$$;

revoke all on function public.sync_login_name_from_staff() from public, anon;

drop trigger if exists staff_sync_login_name on public.staff;
create trigger staff_sync_login_name
  after update of name, email, code on public.staff
  for each row execute function public.sync_login_name_from_staff();

-- Backfill: logins whose Staff record was renamed before this trigger existed
-- (one on 2026-11-03: sudhan@raagamexports.com).
with src as (
  select distinct on (p.id) p.id, s.name
    from public.profiles p
    join public.staff s
      on (s.email is not null and lower(s.email) = lower(p.email))
      or (p.employee_code is not null and s.code = p.employee_code)
   where s.name is not null and btrim(s.name) <> ''
     and p.full_name is distinct from s.name
   order by p.id, s.updated_at desc nulls last
), upd as (
  update public.profiles p set full_name = src.name from src where p.id = src.id returning p.id, p.full_name
)
update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', upd.full_name)
  from upd
 where u.id = upd.id;
