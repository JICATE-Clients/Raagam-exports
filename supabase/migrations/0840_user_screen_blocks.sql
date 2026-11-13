-- ============================================================================
-- 0840 · PER-PERSON SCREEN BLOCKS — take one screen/action of a ROLE away
--        from ONE person, without taking the role away
--
-- User 2026-11-13 (screenshot 4145, Users ▸ ✏️): "after giving an access allow
-- user to edit". The person editor showed the access a role gives as locked
-- cells, because access here was strictly ADDITIVE: roles + the person's own
-- email grants (0658), and nothing that could subtract. Asked how unticking a
-- role cell should work, the user chose "block for this person": they KEEP
-- the role — so approval steps (`approver_role_key`) and alerts routed to it
-- still reach them, and later changes to the role still apply — and the one
-- cell is refused for them alone.
--
-- WHAT A BLOCK IS, AND THE GRAIN IT WORKS AT. `(user_email, screen_key,
-- action)`: "this person may not <action> on <screen>, whatever grants it".
-- It is a SCREEN-grain fact, enforced exactly where screen grants are (0658):
--   - `my_screen_permissions()` reports it as kind 'block' — the app's one
--     permission question (`hasPermission`, lib/auth/types.ts) refuses a
--     blocked screen before anything else, so menus, pages, buttons and server
--     actions (attributed to the screen they POST from) all honour it;
--   - `can_view_report_screen()` (0793, the SQL mirror reports use) refuses it.
-- `has_permission()` — the MODULE-grain ceiling every RLS policy reads — is
-- deliberately untouched, the same way a screen-mode role leaves it at module
-- grain today. Rewriting the function every policy calls, for a per-person
-- exception, is cost and risk for no gain the app layer does not already give.
--
-- Hung off `user_access` like the person's grants, so it is keyed by EMAIL
-- (works before the first sign-in, 0661) and goes when their access row goes.
-- Written only through `save_user_screen_blocks` — whole set, one transaction.
-- ============================================================================

create table if not exists public.user_screen_blocks (
  user_email text not null references public.user_access(user_email) on delete cascade,
  module     text not null,
  screen_key text not null check (screen_key like '/%'),
  action     text not null check (action in ('view', 'create', 'edit', 'delete', 'approve', 'export')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (user_email, screen_key, action)
);

alter table public.user_screen_blocks enable row level security;

-- Read: administrators, and the person their own (as for their grants, 0658).
drop policy if exists usb_read on public.user_screen_blocks;
create policy usb_read on public.user_screen_blocks for select
  using (public.has_permission('system_admin', 'view') or user_email = public.my_access_email());

-- Write: nobody directly — only the security-definer save below.
revoke insert, update, delete, truncate on public.user_screen_blocks from anon, authenticated;
revoke all on public.user_screen_blocks from anon;

-- ─── The save — the person's whole block set, replaced in one transaction ───
-- `p_blocks`: [ { "module": "orders", "screen": "/orders/budgets", "action": "edit" }, … ]
-- Same gates as `save_user_permissions` (0661): an administrator, a real email,
-- one profile at most, and never your own access.
create or replace function public.save_user_screen_blocks(p_email text, p_blocks jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_n      int;
  v_target uuid;
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'Only an administrator can change a person''s access.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then
    raise exception 'The blocks must be a list.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '% is not an email address.', coalesce(nullif(v_email, ''), 'That') using errcode = 'P0001';
  end if;
  select count(*), (array_agg(p.id))[1] into v_n, v_target
    from public.profiles p where lower(btrim(p.email)) = v_email;
  if v_n > 1 then
    raise exception 'More than one user has the email % — correct the user list first.', v_email using errcode = 'P0001';
  end if;
  if v_target is not null and v_target = auth.uid() then
    raise exception 'You cannot change your own access.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.user_access ua where ua.user_email = v_email) then
    raise exception 'Save this person''s access first — a block hangs off it.' using errcode = 'P0001';
  end if;

  delete from public.user_screen_blocks where user_email = v_email;
  insert into public.user_screen_blocks (user_email, module, screen_key, action)
  select distinct v_email, b->>'module', b->>'screen', b->>'action'
    from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) b
   where coalesce(b->>'module', '') <> '' and coalesce(b->>'screen', '') like '/%'
     and b->>'action' in ('view', 'create', 'edit', 'delete', 'approve', 'export');
end;
$$;
-- AGENTS.md "Function grants": both halves, in one statement.
revoke all on function public.save_user_screen_blocks(text, jsonb) from public, anon;
grant execute on function public.save_user_screen_blocks(text, jsonb) to authenticated;

-- ─── my_screen_permissions: 0658's body, verbatim, plus kind 'block' ────────
-- A block applies whether or not the person's own extra screens are switched
-- on: it narrows what their ROLES give, so it is read off the email directly,
-- not through the `is_active` gate the grants use.
create or replace function public.my_screen_permissions()
returns table (kind text, key text)
language sql stable security definer set search_path = '' as $$
  with my_roles as (
    select distinct ur.role_id from public.user_roles ur where ur.user_id = auth.uid()
  ),
  me as (
    select ua.user_email from public.user_access ua
     where ua.is_active and ua.user_email = public.my_access_email()
  )
  select 'module'::text, p.module || ':' || p.action
    from my_roles r
    join public.role_permissions rp on rp.role_id = r.role_id
    join public.permissions p on p.id = rp.permission_id
   where not exists (select 1 from public.role_screen_permissions s
                      where s.role_id = r.role_id and s.module = p.module)
  union
  select 'screen'::text, s.screen_key || '|' || s.action
    from my_roles r
    join public.role_screen_permissions s on s.role_id = r.role_id
  union
  select 'module'::text, up.module || ':' || up.action
    from me
    join public.user_permissions up on up.user_email = me.user_email
   where not exists (select 1 from public.user_screen_permissions s
                      where s.user_email = me.user_email and s.module = up.module)
  union
  select 'screen'::text, s.screen_key || '|' || s.action
    from me
    join public.user_screen_permissions s on s.user_email = me.user_email
  union
  select 'block'::text, b.screen_key || '|' || b.action
    from public.user_screen_blocks b
   where b.user_email = public.my_access_email();
$$;

-- ─── can_view_report_screen: 0793's body, plus "not blocked" ────────────────
create or replace function public.can_view_report_screen(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin(auth.uid()) or (
    exists (
      select 1 from public.my_screen_permissions() m
       where (m.kind = 'module' and m.key = 'reports:view')
          or (m.kind = 'screen' and m.key = p_key || '|view')
    )
    and not exists (
      select 1 from public.user_screen_blocks b
       where b.user_email = public.my_access_email() and b.screen_key = p_key and b.action = 'view'
    )
  );
$$;
revoke all on function public.can_view_report_screen(text) from public, anon;
grant execute on function public.can_view_report_screen(text) to authenticated;
