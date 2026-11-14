-- ════════════════════════════════════════════════════════════════════════════
-- Raagam ERP — 0847 Time Off's HR and ED approvers are STAFF named in a list
--
-- User 2026-11-14: "like HOD I want HR and ED as separate things" — chose
-- separate HR Approvers and ED Approvers sections under the HOD table on
-- Time Off Setup ▸ Approval Flow, each a list of staff picked by name, one or
-- more, the same for every department.
--
--   * hr_approval_settings gains hr_staff_ids / ed_staff_ids.
--   * Seeded with whoever 0846's designations resolved to (HR MANAGER →
--     SRIDHARAN.N.K.R, EXECUTIVE DIRECTOR → SUDHAN on 2026-11-14), only while
--     the lists are still empty, so the approvers do not change today.
--   * hr_approval_role_users(stage) — the one function the resolver calls for
--     both stages (0842) — returns the LOGINS of those staff, active only. A
--     staff record reaches its login by email (timeoff_my_staff_id, 0770).
--
-- The earlier role / people / designation columns stay (nothing is dropped)
-- but nothing reads them any more. The resolver itself is untouched.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.hr_approval_settings
  add column if not exists hr_staff_ids uuid[] not null default '{}',
  add column if not exists ed_staff_ids uuid[] not null default '{}';

comment on column public.hr_approval_settings.hr_staff_ids is
  'Staff who answer the HR Manager stage, any number (0847).';
comment on column public.hr_approval_settings.ed_staff_ids is
  'Staff who answer the ED stage, any number (0847).';

update public.hr_approval_settings s
   set hr_staff_ids = coalesce((select array_agg(st.id order by st.name) from public.staff st
                                 where st.is_active and st.designation_id = any (s.hr_designation_ids)), '{}')
 where s.hr_staff_ids = '{}';
update public.hr_approval_settings s
   set ed_staff_ids = coalesce((select array_agg(st.id order by st.name) from public.staff st
                                 where st.is_active and st.designation_id = any (s.ed_designation_ids)), '{}')
 where s.ed_staff_ids = '{}';

create or replace function public.hr_approval_role_users(p_stage text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct u.id
    from public.hr_approval_settings s
    join public.staff st
      on st.id = any (case p_stage when 'hr' then s.hr_staff_ids
                                   when 'ed' then s.ed_staff_ids end)
    join auth.users u
      on st.email is not null
     and lower(btrim(st.email)) = lower(u.email)
    join public.profiles p on p.id = u.id
   where st.is_active
     and coalesce(p.is_active, true);
$$;
revoke all on function public.hr_approval_role_users(text) from public, anon, authenticated;
