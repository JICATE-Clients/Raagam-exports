-- ============================================================================
-- Raagam ERP — 0842 Time Off's HR and ED stages follow a CHOSEN role, not a role NAME
-- ============================================================================
--
-- WHY. 0817's resolvers found the HR Manager and the ED by the role NAMES
-- 'HR Manager' and 'Managing Director'. On 2026-11-13 the roles were
-- reorganised in Admin ▸ Users & Access — only "ALL", "HR" and "Super Admin"
-- remain — and both stages silently resolved to nobody. A request from any
-- department without an HOD then failed at submit, and an EDP request could not
-- be sent past its HOD (checked 2026-11-14 with approval_rbac_resolve_dynamic).
--
-- WHAT. One settings row, `hr_approval_settings`, holds the ROLE ID for each
-- stage, picked on Time Off Setup ▸ Approval Flow. An id survives a rename; a
-- deleted role sets the stage to "not set" (ON DELETE SET NULL), which the
-- screen shows rather than hides.
--   * HR stage  — seeded with the role named "HR" (user 2026-11-14: "if that
--     name has hr role they are hr"), else "HR Manager" if it ever returns.
--   * ED stage  — seeded EMPTY (user 2026-11-14: "rn nobody is assigned as
--     ED"). With no ED, HR's decision is the last one: forwarding already
--     offers only a stage that has somebody in it (0821), so "Send to ED"
--     simply does not appear.
--
-- The resolver is patched IN PLACE (pg_get_functiondef + replace), and only in
-- its HR branches — `md_or_hr_manager` (fines, 0629) above them keeps its names.
--
-- Additive: one new table, one new function, three call sites rewritten.
-- Nothing is deleted. Re-running is safe (the patch skips once applied).
-- ============================================================================

-- ─── 1. The setting ─────────────────────────────────────────────────────────

create table if not exists public.hr_approval_settings (
  id          boolean primary key default true check (id),  -- exactly one row
  hr_role_id  uuid references public.roles(id) on delete set null,
  ed_role_id  uuid references public.roles(id) on delete set null,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
comment on table public.hr_approval_settings is
  'Time Off approval ladder: which ROLE answers the HR Manager stage and the ED stage. One row. 0842.';

insert into public.hr_approval_settings (id, hr_role_id, ed_role_id)
select true,
       (select r.id from public.roles r
         where r.name in ('HR', 'HR Manager')
         order by (r.name = 'HR') desc limit 1),
       (select r.id from public.roles r where r.name = 'Managing Director' limit 1)
where not exists (select 1 from public.hr_approval_settings);

drop trigger if exists trg_hr_approval_settings_updated on public.hr_approval_settings;
create trigger trg_hr_approval_settings_updated before update on public.hr_approval_settings
  for each row execute function public.set_updated_at();

alter table public.hr_approval_settings enable row level security;
drop policy if exists hr_approval_settings_read  on public.hr_approval_settings;
drop policy if exists hr_approval_settings_write on public.hr_approval_settings;
create policy hr_approval_settings_read on public.hr_approval_settings for select
  using (public.has_permission('hr_payroll', 'view'));
create policy hr_approval_settings_write on public.hr_approval_settings for update
  using (public.has_permission('hr_payroll', 'edit'))
  with check (public.has_permission('hr_payroll', 'edit'));

-- ─── 2. Who holds a stage's role ────────────────────────────────────────────
-- Same filters as approval_rbac_users_with_role (0500): active logins only.
-- A Super Admin who is GIVEN the role is counted — here the role was picked
-- for this stage on purpose, unlike a generic role-routed step.

create or replace function public.hr_approval_role_users(p_stage text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
    from public.hr_approval_settings s
    join public.user_roles ur
      on ur.role_id = case p_stage when 'hr' then s.hr_role_id when 'ed' then s.ed_role_id end
    join public.profiles p on p.id = ur.user_id
   where coalesce(p.is_active, true);
$$;
revoke all on function public.hr_approval_role_users(text) from public, anon, authenticated;

-- ─── 3. Point the HR branches of the resolver at it ─────────────────────────

do $$
declare
  v_def  text := pg_get_functiondef('public.approval_rbac_resolve_dynamic(text, uuid, jsonb)'::regprocedure);
  v_mark text := 'if p_resolver_key = ''hr_manager'' then';
  v_at   int;
  v_head text;
  v_tail text;
  v_new  text;
begin
  v_at := position(v_mark in v_def);
  if v_at = 0 then
    raise exception '0842: the hr_manager branch was not found in approval_rbac_resolve_dynamic — patch it by hand.';
  end if;
  v_head := left(v_def, v_at - 1);
  v_tail := substr(v_def, v_at);

  if position('hr_approval_role_users' in v_tail) > 0 then
    raise notice '0842: resolver already patched — skipped.';
    return;
  end if;

  -- From the hr_manager branch down there are only the HR branches and the
  -- final raise (0817), so the fines resolver above is never touched.
  v_new := replace(v_tail,
    'public.approval_rbac_users_with_role(''HR Manager'', ''{}''::jsonb)',
    'public.hr_approval_role_users(''hr'')');
  v_new := replace(v_new,
    'public.approval_rbac_users_with_role(''Managing Director'', ''{}''::jsonb)',
    'public.hr_approval_role_users(''ed'')');

  if v_new = v_tail
     or position('approval_rbac_users_with_role(''HR Manager''' in v_new) > 0
     or position('approval_rbac_users_with_role(''Managing Director''' in v_new) > 0 then
    raise exception '0842: the HR / ED role calls were not all found — patch approval_rbac_resolve_dynamic by hand.';
  end if;

  execute v_head || v_new;
end $$;

-- ─── 4. Check ───────────────────────────────────────────────────────────────

do $$
declare
  v_def text := pg_get_functiondef('public.approval_rbac_resolve_dynamic(text, uuid, jsonb)'::regprocedure);
begin
  if position('hr_approval_role_users(''hr'')' in v_def) = 0
     or position('hr_approval_role_users(''ed'')' in v_def) = 0 then
    raise exception '0842: resolver check failed — the HR / ED stages are not reading hr_approval_settings.';
  end if;
  -- The fines resolver still names its two roles.
  if position('approval_rbac_users_with_role(''HR Manager''' in v_def) = 0 then
    raise exception '0842: md_or_hr_manager lost its role lookup — restore it from 0629.';
  end if;
end $$;
