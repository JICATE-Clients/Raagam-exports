-- ════════════════════════════════════════════════════════════════════════════
-- Raagam ERP — 0846 Time Off's HR and ED stages follow the staff DESIGNATION
--
-- User 2026-11-14: "while adding a new staff itself we add a role, so we
-- don't need to add it here in a dropdown". The role a staff member is given
-- on People ▸ Staff is their Designation, so a stage now names one or more
-- DESIGNATIONS, and everyone holding one is an approver — a new HR Manager is
-- an approver the moment their staff record says so, with nothing else to set.
--
--   * hr_approval_settings gains hr_designation_ids / ed_designation_ids.
--   * Seeded with the designations named HR MANAGER and EXECUTIVE DIRECTOR
--     (only while the lists are still empty); Approval Flow changes them.
--   * hr_approval_role_users(stage) — the one function the resolver calls for
--     both stages (0842) — returns the LOGINS of active staff holding one of
--     those designations. A staff record reaches its login by email, the link
--     timeoff_my_staff_id() (0770) already uses; staff with no login cannot
--     approve and the screen says so.
--
-- 0845's picked-people lists stay in the table (nothing is dropped) but are
-- no longer read. The resolver itself is untouched.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.hr_approval_settings
  add column if not exists hr_designation_ids uuid[] not null default '{}',
  add column if not exists ed_designation_ids uuid[] not null default '{}';

comment on column public.hr_approval_settings.hr_designation_ids is
  'Designations whose active staff answer the HR Manager stage (0846).';
comment on column public.hr_approval_settings.ed_designation_ids is
  'Designations whose active staff answer the ED stage (0846).';

update public.hr_approval_settings s
   set hr_designation_ids = coalesce((select array_agg(d.id) from public.designations d
                                       where upper(btrim(d.name)) = 'HR MANAGER'), '{}')
 where s.hr_designation_ids = '{}';
update public.hr_approval_settings s
   set ed_designation_ids = coalesce((select array_agg(d.id) from public.designations d
                                       where upper(btrim(d.name)) = 'EXECUTIVE DIRECTOR'), '{}')
 where s.ed_designation_ids = '{}';

create or replace function public.hr_approval_role_users(p_stage text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct u.id
    from public.hr_approval_settings s
    join public.staff st
      on st.designation_id = any (case p_stage when 'hr' then s.hr_designation_ids
                                               when 'ed' then s.ed_designation_ids end)
    join auth.users u
      on st.email is not null
     and lower(btrim(st.email)) = lower(u.email)
    join public.profiles p on p.id = u.id
   where st.is_active
     and coalesce(p.is_active, true);
$$;
revoke all on function public.hr_approval_role_users(text) from public, anon, authenticated;
