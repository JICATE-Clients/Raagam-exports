-- ════════════════════════════════════════════════════════════════════════════
-- Raagam ERP — 0845 Time Off's HR and ED stages are PEOPLE picked by name
--
-- User 2026-11-14: "HR and ED can be anyone … there can be 1 or more HR and
-- ED, just make that working". 0842 tied each stage to a ROLE, which meant
-- making a role and handing it out in Users & Access first — and the "HR"
-- role it seeded is held by nobody, so the HR stage still found no one.
--
-- Now Time Off Setup ▸ Approval Flow names the people directly, any number:
--   * hr_approval_settings gains hr_user_ids / ed_user_ids (logins).
--   * hr_approval_role_users(stage) — the one function the resolver calls for
--     both stages since 0842 — returns those people, active logins only.
-- So the resolver itself is untouched. The two role columns stay (nothing is
-- dropped) but nothing reads them any more.
--
-- Empty HR list → the ED stage takes it; empty ED list → HR decides last and
-- "Send to ED" does not appear — the same rules 0842 had for an unset role.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.hr_approval_settings
  add column if not exists hr_user_ids uuid[] not null default '{}',
  add column if not exists ed_user_ids uuid[] not null default '{}';

comment on column public.hr_approval_settings.hr_user_ids is
  'Logins who answer the HR Manager stage, any number (0845). Replaces hr_role_id.';
comment on column public.hr_approval_settings.ed_user_ids is
  'Logins who answer the ED stage, any number (0845). Replaces ed_role_id.';

create or replace function public.hr_approval_role_users(p_stage text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct p.id
    from public.hr_approval_settings s
    cross join lateral unnest(case p_stage when 'hr' then s.hr_user_ids when 'ed' then s.ed_user_ids end) as u(id)
    join public.profiles p on p.id = u.id
   where coalesce(p.is_active, true);
$$;
revoke all on function public.hr_approval_role_users(text) from public, anon, authenticated;
