-- ============================================================================
-- Raagam ERP — 0750 Communication Hub: the workspace and its members
--
-- doc/slack.md/slack, Development Task 01 (Workspace & Organization
-- Management). The identity and the people of the hub 0737 built.
--
--
-- ## ONE WORKSPACE, BECAUSE THERE IS ONE COMPANY
--
-- This ERP is single-tenant: one company per database (`company_profile` is a
-- singleton, 0318) with three units under it (Head Office, Unit 1, Unit 2).
-- There is no tenant or institution column anywhere to isolate by, so the
-- workspace is a SINGLETON row tied to that company — the `singleton` column
-- and its unique index make a second one impossible rather than unlikely.
-- "Cross-tenant leakage" is closed by the database boundary itself; inside it
-- the hub is cross-unit on purpose (0737's header), and so is this.
--
--
-- ## MEMBERSHIP IS THE ERP'S, THIS TABLE ONLY OVERRIDES IT
--
-- Who may use the hub was already decided before this migration: an ACTIVE
-- `profiles` login (Users & Access bans the auth user AND clears is_active)
-- holding `communication:view` (0737, granted to every role). A second list of
-- members beside that would be a duplicate user system that drifts the first
-- day someone is hired. So `comm_workspace_members` holds a row ONLY for a
-- person the workspace treats differently:
--
--   * a ROLE other than member (owner / admin), or
--   * a DEACTIVATION — the hub's own off switch, separate from the ERP login.
--
-- No row = an ordinary active member. Nobody is backfilled, a new hire is a
-- member the moment HR gives them a login, and "duplicate membership" cannot
-- exist: user_id is the primary key and every write is an upsert.
--
-- AN ERP SUPER ADMIN IS ALWAYS AN OWNER, and cannot be demoted or deactivated
-- here. The super admin is the root of trust for the whole ERP ("Super Admin =
-- every unit"); a workspace switch that could lock them out of a module would
-- be the one place in the app where they are not super.
--
-- No guest role: every person here is an employee login. A guest would need
-- an account outside HR, which this ERP does not have.
--
--
-- ## DEACTIVATION KEEPS HISTORY, ATTRIBUTION AND MEMBERSHIP ROWS
--
-- A deactivated person:
--   * cannot write (comm_actor refuses),
--   * cannot read any conversation, file or Realtime event (comm_can_read_at,
--     which every SELECT policy, the storage policy and Realtime go through),
--     and gets an empty conversation list and directory,
--   * is not offered to others: not in the directory, not DM-able, not
--     addable to a group or channel, and a <@mention> of them mentions nobody.
-- What is NOT touched: their messages keep `author_id` (and `creator_names()`
-- reads profiles regardless of status, so their name still prints), and their
-- `comm_members` rows stay — reactivating someone returns them to exactly the
-- conversations they were in. Nothing is deleted.
--
-- THE ERP ACCOUNT STATUS WINS. A login switched off in Users & Access cannot be
-- reactivated here (it would be a switch that does nothing — the auth user is
-- banned), and its role cannot be changed; the screen says where to go.
--
--
-- ## SETTINGS: ONLY ONES SOMETHING READS
--
-- AGENTS.md: "a column no code reads is worse than a missing one". Each
-- setting below is enforced in this migration:
--   * name, description           — the hub frame prints them.
--   * status 'active'|'suspended' — suspended pauses every hub WRITE for
--                                   everyone but owners / admins (comm_actor).
--                                   Reading stays open. Owners only.
--   * members_can_create_groups   — comm_create_group refuses an ordinary
--                                   member when it is off.
-- Channel creation is NOT a workspace setting: `communication:create` (0737)
-- already decides it, on Users & Access, and a second switch for the same act
-- would make the two disagree.
--
--
-- ## EVERY WRITE IS AN RPC (0737's rule, kept)
--
-- No INSERT / UPDATE / DELETE policy on either new table. The actor comes from
-- auth.uid(), never from an argument. The audit row is written by the server
-- action with writeAudit() (0737's choice), and the row itself carries who
-- deactivated whom and when.
--
-- REPLACES (same signatures, same grants), each to add the deactivation /
-- workspace rule and nothing else: comm_actor, comm_can_read_at,
-- comm_active_profiles, comm_open_direct, comm_create_group,
-- comm_parse_mentions, comm_my_conversations, comm_directory. No later
-- migration redefines any of them (0749 replaced comm_create_channel only).
-- ============================================================================


-- ---------- 1. the workspace ---------------------------------------------------

create table if not exists public.comm_workspace (
  id                        uuid primary key default gen_random_uuid(),
  -- Always true; the unique constraint on it is what makes this a singleton.
  singleton                 boolean not null default true,
  company_profile_id        uuid references public.company_profile(id) on delete set null,
  name                      text not null,
  description               text,
  status                    text not null default 'active' check (status in ('active', 'suspended')),
  members_can_create_groups boolean not null default true,
  created_by                uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  constraint uq_comm_workspace_singleton unique (singleton),
  constraint chk_comm_workspace_singleton check (singleton),
  constraint chk_comm_workspace_name check (char_length(btrim(name)) between 1 and 80),
  constraint chk_comm_workspace_desc check (description is null or char_length(description) <= 250)
);

drop trigger if exists trg_comm_workspace_updated on public.comm_workspace;
create trigger trg_comm_workspace_updated before update on public.comm_workspace
  for each row execute function public.set_updated_at();

comment on table public.comm_workspace is
  'location-scope: exempt -- the Communication Hub workspace (0750): one per company, across every unit.';

-- The one row, named after the company. Fallback only when no company profile
-- has been entered yet; an owner renames it on the Workspace screen.
insert into public.comm_workspace (company_profile_id, name, created_by)
select cp.id,
       left(coalesce(nullif(btrim(cp.company_short_name), ''), nullif(btrim(cp.company_name), ''), 'Workspace'), 80),
       null
  from (select 1) one
  left join lateral (select * from public.company_profile order by created_at limit 1) cp on true
on conflict (singleton) do nothing;


-- ---------- 2. member overrides -------------------------------------------------

create table if not exists public.comm_workspace_members (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  role               text not null default 'member' check (role in ('owner', 'admin', 'member')),
  deactivated_at     timestamptz,
  deactivated_by     uuid references public.profiles(id) on delete set null,
  deactivated_reason text,
  updated_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp(),
  constraint chk_comm_wsm_reason check (deactivated_reason is null or char_length(deactivated_reason) <= 250),
  constraint chk_comm_wsm_deactivated check (deactivated_at is not null or deactivated_reason is null)
);

create index if not exists idx_comm_wsm_deactivated
  on public.comm_workspace_members (user_id) where deactivated_at is not null;

drop trigger if exists trg_comm_workspace_members_updated on public.comm_workspace_members;
create trigger trg_comm_workspace_members_updated before update on public.comm_workspace_members
  for each row execute function public.set_updated_at();

comment on table public.comm_workspace_members is
  'location-scope: exempt -- Communication Hub workspace role / deactivation overrides (0750). No row = an ordinary active member.';


-- ---------- 3. helpers ------------------------------------------------------------
--
-- INTERNAL: granted to nobody but the owner. They answer about ANY login
-- (its role, whether it was deactivated), so a browser calling them directly
-- would read another person's standing; every caller below is itself a
-- SECURITY DEFINER function, which runs them as the owner.

-- Is this login switched off in the hub? The one test every gate below shares.
create or replace function public.comm_workspace_blocked(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comm_workspace_members w
     where w.user_id = p_user and w.deactivated_at is not null
  );
$$;
revoke all on function public.comm_workspace_blocked(uuid) from public, anon, authenticated;

-- owner | admin | member. A super admin is an owner whatever the row says.
create or replace function public.comm_workspace_role(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.is_super_admin, false)) then 'owner'
    else coalesce((select w.role from public.comm_workspace_members w where w.user_id = p_user), 'member')
  end;
$$;
revoke all on function public.comm_workspace_role(uuid) from public, anon, authenticated;

-- active | deactivated | no_access | account_inactive | NULL (no such login).
-- The ERP account comes first: a switched-off login is that, whatever else.
create or replace function public.comm_workspace_status(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then null
    when not coalesce(p.is_active, true) then 'account_inactive'
    when public.comm_workspace_blocked(p.id) then 'deactivated'
    when not public.has_permission('communication', 'view', p.id) then 'no_access'
    else 'active'
  end
  from (select 1) one
  left join public.profiles p on p.id = p_user;
$$;
revoke all on function public.comm_workspace_status(uuid) from public, anon, authenticated;

-- The caller as a workspace ADMINISTRATOR, or a refusal. Not comm_actor: a
-- suspended workspace must still let its admins switch it back on.
create or replace function public.comm_workspace_admin_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if public.comm_workspace_status(v) is distinct from 'active' then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  if public.comm_workspace_role(v) not in ('owner', 'admin') then
    raise exception 'Only workspace owners and admins can do that.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public.comm_workspace_admin_actor() from public, anon, authenticated;


-- ---------- 4. RLS — reads only ----------------------------------------------------

alter table public.comm_workspace         enable row level security;
alter table public.comm_workspace_members enable row level security;

-- The workspace's name is no secret to anyone signed in.
drop policy if exists comm_workspace_read on public.comm_workspace;
create policy comm_workspace_read on public.comm_workspace
  for select to authenticated using ((select auth.uid()) is not null);

-- Your own override row only. Everyone else's goes through comm_workspace_people,
-- which decides per caller what may be listed.
drop policy if exists comm_workspace_members_read on public.comm_workspace_members;
create policy comm_workspace_members_read on public.comm_workspace_members
  for select to authenticated using (user_id = (select auth.uid()));


-- ---------- 5. the existing gates, with the workspace in them ----------------------

-- 0737's comm_actor + (a) not deactivated, (b) a suspended workspace takes
-- writes from its owners / admins only.
create or replace function public.comm_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v and coalesce(p.is_active, true)) then
    raise exception 'This login is not active.' using errcode = '42501';
  end if;
  if public.comm_workspace_blocked(v) then
    raise exception 'Your access to messages has been deactivated by a workspace admin.' using errcode = '42501';
  end if;
  if not public.has_permission('communication', 'view') then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_workspace w where w.status = 'suspended')
     and public.comm_workspace_role(v) not in ('owner', 'admin') then
    raise exception 'Messages are paused by the workspace admins. You can still read your conversations.' using errcode = '55000';
  end if;
  return v;
end $$;
revoke all on function public.comm_actor() from public, anon;
grant execute on function public.comm_actor() to authenticated;

-- 0737's comm_can_read_at + a deactivated caller reads nothing. This is the
-- function every comm SELECT policy, the comm-files storage policy and so
-- Realtime go through, so one clause closes all of them.
create or replace function public.comm_can_read_at(p_conv uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conv is not null
    and not exists (
      select 1 from public.comm_workspace_members w
       where w.user_id = (select auth.uid()) and w.deactivated_at is not null
    )
    and (
      exists (
        select 1 from public.comm_members m
         where m.conversation_id = p_conv
           and m.user_id = (select auth.uid())
           and (m.removed_at is null or p_at is null or p_at < m.removed_at)
      )
      or (
        (select auth.uid()) is not null
        and exists (
          select 1 from public.comm_conversations c
           where c.id = p_conv and c.kind = 'channel' and c.visibility = 'public'
        )
      )
    );
$$;
revoke all on function public.comm_can_read_at(uuid, timestamptz) from public, anon;
grant execute on function public.comm_can_read_at(uuid, timestamptz) to authenticated;

-- 0737's comm_active_profiles + not deactivated. Every "add people" path
-- (groups, channels) filters through this.
create or replace function public.comm_active_profiles(p_ids uuid[], p_except uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.id), '{}')
    from public.profiles p
   where p.id = any (coalesce(p_ids, '{}'))
     and p.id is distinct from p_except
     and coalesce(p.is_active, true)
     and not public.comm_workspace_blocked(p.id);
$$;
revoke all on function public.comm_active_profiles(uuid[], uuid) from public, anon;
grant execute on function public.comm_active_profiles(uuid[], uuid) to authenticated;

-- 0737's comm_open_direct + a deactivated person cannot be messaged.
create or replace function public.comm_open_direct(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_key text;
  v_id  uuid;
begin
  if p_other is null or p_other = v_me then
    raise exception 'Pick someone else to message.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_other and coalesce(p.is_active, true))
     or public.comm_workspace_blocked(p_other) then
    raise exception 'That person cannot receive messages.' using errcode = '22023';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  insert into public.comm_conversations (kind, direct_key, visibility, created_by)
  values ('direct', v_key, 'private', v_me)
  on conflict (direct_key) where direct_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.comm_conversations c where c.direct_key = v_key;
  end if;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'member', v_me), (v_id, p_other, 'member', v_me)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end $$;
revoke all on function public.comm_open_direct(uuid) from public, anon;
grant execute on function public.comm_open_direct(uuid) to authenticated;

-- 0737's comm_create_group + the members_can_create_groups setting. With it
-- off, a workspace admin or a holder of communication:create may still start one.
create or replace function public.comm_create_group(p_name text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_others uuid[];
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_id     uuid;
begin
  if exists (select 1 from public.comm_workspace w where not w.members_can_create_groups)
     and public.comm_workspace_role(v_me) not in ('owner', 'admin')
     and not public.has_permission('communication', 'create') then
    raise exception 'Only workspace admins can start group conversations here.' using errcode = '42501';
  end if;
  v_others := public.comm_active_profiles(p_member_ids, v_me);
  if coalesce(array_length(v_others, 1), 0) = 0 then
    raise exception 'Add at least one other person to the group.' using errcode = '22023';
  end if;
  if array_length(v_others, 1) > 99 then
    raise exception 'A group can have at most 100 people. Use a channel instead.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Keep the group name to 80 characters.' using errcode = '22023';
  end if;

  insert into public.comm_conversations (kind, name, visibility, created_by)
  values ('group', v_name, 'private', v_me)
  returning id into v_id;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'owner', v_me);
  insert into public.comm_members (conversation_id, user_id, role, added_by)
  select v_id, u, 'member', v_me from unnest(v_others) u;

  return v_id;
end $$;
revoke all on function public.comm_create_group(text, uuid[]) from public, anon;
grant execute on function public.comm_create_group(text, uuid[]) to authenticated;

-- 0737's comm_parse_mentions + a deactivated member is mentioned by nobody, so
-- no alert goes to a person who cannot open it.
create or replace function public.comm_parse_mentions(p_conv uuid, p_body text, p_author uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
    from regexp_matches(coalesce(p_body, ''),
           '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'g') r
    join public.comm_members m
      on m.conversation_id = p_conv
     and m.user_id = (r[1])::uuid
     and m.removed_at is null
     and m.user_id is distinct from p_author
   where not public.comm_workspace_blocked(m.user_id);
$$;
revoke all on function public.comm_parse_mentions(uuid, text, uuid) from public, anon;
grant execute on function public.comm_parse_mentions(uuid, text, uuid) to authenticated;

-- 0737's comm_my_conversations + a deactivated caller has none.
create or replace function public.comm_my_conversations(p_kind text default null)
returns table (
  id uuid, kind text, name text, topic text, visibility text, department_id uuid,
  is_archived boolean, last_message_at timestamptz, created_at timestamptz,
  my_role text, muted boolean, last_read_at timestamptz,
  unread_count integer, mention_count integer,
  other_user_id uuid, member_count integer
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.name, c.topic, c.visibility, c.department_id,
         c.is_archived, c.last_message_at, c.created_at,
         m.role, m.muted, m.last_read_at,
         (select count(*)::int from public.comm_messages g
           where g.conversation_id = c.id and g.parent_id is null and g.deleted_at is null
             and g.author_id is distinct from m.user_id
             and g.created_at > coalesce(m.last_read_at, m.joined_at)),
         (select count(*)::int from public.comm_mentions x
            join public.comm_messages g on g.id = x.message_id
           where x.user_id = m.user_id and g.conversation_id = c.id and g.deleted_at is null
             and g.created_at > coalesce(m.last_read_at, m.joined_at)),
         case when c.kind = 'direct' then
           (select o.user_id from public.comm_members o
             where o.conversation_id = c.id and o.user_id <> m.user_id limit 1)
         end,
         (select count(*)::int from public.comm_members o
           where o.conversation_id = c.id and o.removed_at is null)
    from public.comm_members m
    join public.comm_conversations c on c.id = m.conversation_id
   where m.user_id = (select auth.uid())
     and m.removed_at is null
     and not public.comm_workspace_blocked((select auth.uid()))
     and (p_kind is null or c.kind = p_kind)
   order by coalesce(c.last_message_at, c.created_at) desc;
$$;
revoke all on function public.comm_my_conversations(text) from public, anon;
grant execute on function public.comm_my_conversations(text) to authenticated;

-- 0737's comm_directory + deactivated people are not offered, and a
-- deactivated caller is offered nobody.
create or replace function public.comm_directory(p_q text default null, p_limit integer default 20)
returns table (id uuid, full_name text, employee_code text, designation text, department text)
language sql stable security definer set search_path = '' as $$
  with q as (
    select nullif(btrim(coalesce(p_q, '')), '') as raw
  ), pat as (
    select '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pat
      from q
  )
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)) as full_name,
         p.employee_code,
         d.name,
         dep.name
    from public.profiles p
    left join lateral (
      select s.designation_id, s.department_id
        from public.staff s
       where coalesce(s.is_active, true) and not coalesce(s.blocked, false)
         and (
              (nullif(btrim(p.employee_code), '') is not null
               and lower(btrim(p.employee_code)) = lower(btrim(s.code)))
           or (nullif(btrim(p.email), '') is not null
               and lower(btrim(p.email)) = lower(btrim(s.email)))
         )
       order by (lower(btrim(coalesce(p.employee_code, ''))) = lower(btrim(coalesce(s.code, '')))) desc
       limit 1
    ) s on true
    left join public.designations d on d.id = s.designation_id
    left join public.departments dep on dep.id = s.department_id
    cross join pat
   where (select auth.uid()) is not null
     and not public.comm_workspace_blocked((select auth.uid()))
     and coalesce(p.is_active, true)
     and not public.comm_workspace_blocked(p.id)
     and (
          pat.like_pat is null
       or p.full_name     ilike pat.like_pat
       or p.employee_code ilike pat.like_pat
       or dep.name        ilike pat.like_pat
     )
   order by 2
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.comm_directory(text, integer) from public, anon;
grant execute on function public.comm_directory(text, integer) to authenticated;


-- ---------- 6. workspace RPCs ---------------------------------------------------------

-- 6a. The workspace as the caller sees it, plus who the caller is in it.
-- Answers a deactivated caller too (that is how the hub tells them so), but
-- refuses an anonymous one. jsonb: one round trip for the hub frame.
create or replace function public.comm_workspace_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v  uuid := auth.uid();
  w  public.comm_workspace%rowtype;
  cn text;
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  select * into w from public.comm_workspace limit 1;
  if w.id is null then
    raise exception 'The messages workspace has not been set up.' using errcode = '55000';
  end if;
  select cp.company_name into cn from public.company_profile cp where cp.id = w.company_profile_id;
  return jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'description', w.description,
    'status', w.status,
    'members_can_create_groups', w.members_can_create_groups,
    'company_name', cn,
    'created_at', w.created_at,
    'updated_at', w.updated_at,
    'my_role', public.comm_workspace_role(v),
    'my_status', public.comm_workspace_status(v)
  );
end $$;
revoke all on function public.comm_workspace_me() from public, anon;
grant execute on function public.comm_workspace_me() to authenticated;


-- 6b. Settings. Admins edit name / description / the groups switch; only an
-- OWNER may suspend or resume the workspace — it stops everyone else's work.
create or replace function public.comm_workspace_update(
  p_name text, p_description text, p_status text, p_members_can_create_groups boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_workspace_admin_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  w      public.comm_workspace%rowtype;
begin
  select * into w from public.comm_workspace limit 1 for update;
  if w.id is null then
    raise exception 'The messages workspace has not been set up.' using errcode = '55000';
  end if;
  if v_name is null then
    raise exception 'The workspace needs a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the workspace name to 80 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 250 then
    raise exception 'Keep the description to 250 characters.' using errcode = '22023';
  end if;
  if coalesce(p_status, '') not in ('active', 'suspended') then
    raise exception 'Choose whether messages are open or paused.' using errcode = '22023';
  end if;
  if p_members_can_create_groups is null then
    raise exception 'Choose who can start group conversations.' using errcode = '22023';
  end if;
  if p_status <> w.status and public.comm_workspace_role(v_me) <> 'owner' then
    raise exception 'Only a workspace owner can pause or resume messages.' using errcode = '42501';
  end if;

  update public.comm_workspace
     set name = v_name,
         description = v_desc,
         status = p_status,
         members_can_create_groups = p_members_can_create_groups,
         updated_by = v_me
   where id = w.id;
end $$;
revoke all on function public.comm_workspace_update(text, text, text, boolean) from public, anon;
grant execute on function public.comm_workspace_update(text, text, text, boolean) to authenticated;


-- 6c. The rows behind the directory and the profile — ONE definition, so the
-- list and a single profile can never disagree. Same narrow columns as
-- comm_directory (no e-mail, phone, salary or unit). The deactivation details
-- are an administrator's business and come back NULL when p_admin is false.
--
-- INTERNAL: granted to nobody. Only the two SECURITY DEFINER readers below
-- call it, after deciding who the caller is — p_admin is THEIR answer, never
-- a browser's.
create or replace function public.comm_workspace_people_rows(p_q text, p_user uuid, p_admin boolean)
returns table (
  id uuid, full_name text, employee_code text, designation text, department text,
  role text, status text, member_since timestamptz,
  deactivated_at timestamptz, deactivated_by_name text, deactivated_reason text,
  erp_owner boolean
)
language sql stable security definer set search_path = '' as $$
  with pat as (
    select case when nullif(btrim(coalesce(p_q, '')), '') is null then null
           else '%' || replace(replace(replace(btrim(p_q), '\', '\'), '%', '\%'), '_', '\_') || '%' end as like_pat
  )
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)),
         p.employee_code,
         d.name,
         dep.name,
         public.comm_workspace_role(p.id),
         public.comm_workspace_status(p.id),
         p.created_at,
         case when p_admin then w.deactivated_at end,
         case when p_admin and w.deactivated_by is not null then
           (select coalesce(nullif(btrim(b.full_name), ''), split_part(coalesce(b.email, ''), '@', 1))
              from public.profiles b where b.id = w.deactivated_by)
         end,
         case when p_admin then w.deactivated_reason end,
         -- An ERP super admin: an owner nobody here can demote or deactivate.
         case when p_admin then coalesce(p.is_super_admin, false) end
    from public.profiles p
    left join public.comm_workspace_members w on w.user_id = p.id
    left join lateral (
      select s.designation_id, s.department_id
        from public.staff s
       where coalesce(s.is_active, true) and not coalesce(s.blocked, false)
         and (
              (nullif(btrim(p.employee_code), '') is not null
               and lower(btrim(p.employee_code)) = lower(btrim(s.code)))
           or (nullif(btrim(p.email), '') is not null
               and lower(btrim(p.email)) = lower(btrim(s.email)))
         )
       order by (lower(btrim(coalesce(p.employee_code, ''))) = lower(btrim(coalesce(s.code, '')))) desc
       limit 1
    ) s on true
    left join public.designations d on d.id = s.designation_id
    left join public.departments dep on dep.id = s.department_id
    cross join pat
   where (p_user is null or p.id = p_user)
     and (
          pat.like_pat is null
       or p.full_name     ilike pat.like_pat
       or p.employee_code ilike pat.like_pat
       or dep.name        ilike pat.like_pat
       or d.name          ilike pat.like_pat
     );
$$;
revoke all on function public.comm_workspace_people_rows(text, uuid, boolean) from public, anon, authenticated;


-- 6d. The member directory. Every ACTIVE member may list the active members
-- (the directory a chat app needs); only owners / admins may list the
-- deactivated, the switched-off and the no-access — that is administration.
-- p_status: 'active' | 'deactivated' | 'no_access' | 'account_inactive' | 'all'.
create or replace function public.comm_workspace_people(
  p_q text default null, p_status text default 'active',
  p_limit integer default 200, p_offset integer default 0
)
returns table (
  id uuid, full_name text, employee_code text, designation text, department text,
  role text, status text, member_since timestamptz,
  deactivated_at timestamptz, deactivated_by_name text, deactivated_reason text,
  erp_owner boolean, total_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v       uuid := auth.uid();
  v_admin boolean;
  v_want  text := coalesce(nullif(btrim(p_status), ''), 'active');
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if public.comm_workspace_status(v) is distinct from 'active' then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  if v_want not in ('active', 'deactivated', 'no_access', 'account_inactive', 'all') then
    raise exception 'Unknown member filter.' using errcode = '22023';
  end if;
  v_admin := public.comm_workspace_role(v) in ('owner', 'admin');
  if v_want <> 'active' and not v_admin then
    raise exception 'Only workspace owners and admins can see deactivated members.' using errcode = '42501';
  end if;

  return query
  select r.id, r.full_name, r.employee_code, r.designation, r.department,
         r.role, r.status, r.member_since,
         r.deactivated_at, r.deactivated_by_name, r.deactivated_reason, r.erp_owner,
         (count(*) over ())::int
    from public.comm_workspace_people_rows(p_q, null, v_admin) r
   where v_want = 'all' or r.status = v_want
   order by case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, r.full_name, r.id
   limit least(greatest(coalesce(p_limit, 200), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.comm_workspace_people(text, text, integer, integer) from public, anon;
grant execute on function public.comm_workspace_people(text, text, integer, integer) to authenticated;


-- 6e. One member's profile. An ordinary member may open an ACTIVE member's
-- profile only; an admin may open anyone's. An unknown id and a hidden one get
-- the SAME 22023 sentence, so a guessed id learns nothing.
create or replace function public.comm_workspace_person(p_user uuid)
returns table (
  id uuid, full_name text, employee_code text, designation text, department text,
  role text, status text, member_since timestamptz,
  deactivated_at timestamptz, deactivated_by_name text, deactivated_reason text,
  erp_owner boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v       uuid := auth.uid();
  v_admin boolean;
  v_st    text;
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if public.comm_workspace_status(v) is distinct from 'active' then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  v_admin := public.comm_workspace_role(v) in ('owner', 'admin');
  v_st := public.comm_workspace_status(p_user);
  if v_st is null or (v_st <> 'active' and not v_admin) then
    raise exception 'That person was not found in this workspace.' using errcode = '22023';
  end if;
  return query select r.* from public.comm_workspace_people_rows(null, p_user, v_admin) r;
end $$;
revoke all on function public.comm_workspace_person(uuid) from public, anon;
grant execute on function public.comm_workspace_person(uuid) to authenticated;


-- Shared refusals for the two member-administration RPCs below.
--   * nobody changes themselves (no self-escalation, no self-lock-out);
--   * a super admin is an owner by the ERP and is untouchable here;
--   * an admin manages MEMBERS only — an admin or an owner needs an owner.
-- Returns the target's current effective role.
create or replace function public.comm_workspace_check_target(p_actor uuid, p_user uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'That person was not found in this workspace.' using errcode = '22023';
  end if;
  if p_user = p_actor then
    raise exception 'You cannot change your own workspace role or access.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.is_super_admin, false)) then
    raise exception 'An ERP super admin is always a workspace owner. Change that in Users & Access.' using errcode = '42501';
  end if;
  v_role := public.comm_workspace_role(p_user);
  if v_role in ('owner', 'admin') and public.comm_workspace_role(p_actor) <> 'owner' then
    raise exception 'Only a workspace owner can change an owner or admin.' using errcode = '42501';
  end if;
  return v_role;
end $$;
revoke all on function public.comm_workspace_check_target(uuid, uuid) from public, anon, authenticated;


-- 6f. Set a role. Upsert, so setting the same role twice is a no-op, never a
-- second row. Returns whether anything changed.
create or replace function public.comm_workspace_set_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_workspace_admin_actor();
  v_old text;
begin
  if coalesce(p_role, '') not in ('owner', 'admin', 'member') then
    raise exception 'Choose owner, admin or member.' using errcode = '22023';
  end if;
  v_old := public.comm_workspace_check_target(v_me, p_user);
  if p_role = 'owner' and public.comm_workspace_role(v_me) <> 'owner' then
    raise exception 'Only a workspace owner can make someone an owner.' using errcode = '42501';
  end if;
  if public.comm_workspace_status(p_user) = 'account_inactive' then
    raise exception 'That login is switched off in Users & Access. Switch it on there first.' using errcode = '55000';
  end if;
  if v_old = p_role then
    return false;
  end if;

  insert into public.comm_workspace_members (user_id, role, updated_by)
  values (p_user, p_role, v_me)
  on conflict (user_id) do update set role = excluded.role, updated_by = excluded.updated_by;
  return true;
end $$;
revoke all on function public.comm_workspace_set_role(uuid, text) from public, anon;
grant execute on function public.comm_workspace_set_role(uuid, text) to authenticated;


-- 6g. Deactivate / reactivate. Idempotent: returns false when already so.
-- Conversation memberships are left exactly as they are (header).
create or replace function public.comm_workspace_set_active(p_user uuid, p_active boolean, p_reason text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_workspace_admin_actor();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_blocked boolean;
begin
  if p_active is null then
    raise exception 'Choose activate or deactivate.' using errcode = '22023';
  end if;
  perform public.comm_workspace_check_target(v_me, p_user);
  if v_reason is not null and char_length(v_reason) > 250 then
    raise exception 'Keep the reason to 250 characters.' using errcode = '22023';
  end if;
  v_blocked := public.comm_workspace_blocked(p_user);

  if p_active then
    if not v_blocked then
      return false;
    end if;
    if public.comm_workspace_status(p_user) = 'account_inactive' then
      raise exception 'That login is switched off in Users & Access. Switch it on there first.' using errcode = '55000';
    end if;
    update public.comm_workspace_members
       set deactivated_at = null, deactivated_by = null, deactivated_reason = null, updated_by = v_me
     where user_id = p_user;
    return true;
  end if;

  if v_blocked then
    return false;
  end if;
  insert into public.comm_workspace_members (user_id, role, deactivated_at, deactivated_by, deactivated_reason, updated_by)
  values (p_user, 'member', clock_timestamp(), v_me, v_reason, v_me)
  on conflict (user_id) do update
     set deactivated_at = excluded.deactivated_at,
         deactivated_by = excluded.deactivated_by,
         deactivated_reason = excluded.deactivated_reason,
         updated_by = excluded.updated_by;
  return true;
end $$;
revoke all on function public.comm_workspace_set_active(uuid, boolean, text) from public, anon;
grant execute on function public.comm_workspace_set_active(uuid, boolean, text) to authenticated;


-- ============================================================================
-- 7. ASSERTIONS — from the catalog and by attempting the violation (0737 §11).
-- The impersonated access matrix is scripts/comms-workspace-smoke-test.sql.
-- ============================================================================

do $assert$
declare
  n integer;
begin
  -- (a) RLS is on for both new tables.
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname in ('comm_workspace', 'comm_workspace_members')
         and c.relrowsecurity) <> 2 then
    raise exception '0750: row level security is NOT enabled on the workspace tables';
  end if;

  -- (b) no write policy on either — every write is an RPC.
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('comm_workspace', 'comm_workspace_members') and cmd <> 'SELECT') then
    raise exception '0750: a workspace table has a write policy';
  end if;

  -- (c) 0737's isolation claim still holds for the new SELECT policies.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'comm\_%' and cmd = 'SELECT'
              and coalesce(qual, '') !~ '(comm_can_read_at|comm_message_visible|auth\.uid)') then
    raise exception '0750: a comm SELECT policy does not gate on membership or the caller';
  end if;

  -- (d) no comm_ function executable by anon / PUBLIC (0737 (b), re-run).
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where p.proname like 'comm\_%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or p.proacl is null or p.proacl::text ~ '(\{|,)=X');
  if n > 0 then
    raise exception '0750: % comm function(s) are executable by anon/public', n;
  end if;

  -- (e) exactly one workspace, and a second is refused.
  if (select count(*) from public.comm_workspace) <> 1 then
    raise exception '0750: expected exactly one workspace row';
  end if;
  begin
    insert into public.comm_workspace (name) values ('0750 probe');
    raise exception '0750: a SECOND workspace was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.comm_workspace (singleton, name) values (false, '0750 probe');
    raise exception '0750: a non-singleton workspace row was accepted';
  exception when check_violation then null;
  end;

  -- (f) the replaced gates carry the workspace rule (a later re-create that
  --     starts from 0737's body would silently drop it).
  if pg_get_functiondef('public.comm_actor()'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_can_read_at(uuid,timestamptz)'::regprocedure) not like '%comm_workspace_members%'
     or pg_get_functiondef('public.comm_active_profiles(uuid[],uuid)'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_open_direct(uuid)'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_parse_mentions(uuid,text,uuid)'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_my_conversations(text)'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_directory(text,integer)'::regprocedure) not like '%comm_workspace_blocked%'
     or pg_get_functiondef('public.comm_create_group(text,uuid[])'::regprocedure) not like '%members_can_create_groups%' then
    raise exception '0750: a replaced comm gate is missing its workspace clause';
  end if;

  -- (g) the columns the staff join reads exist on the LIVE schema (0749's lesson).
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'staff'
         and column_name in ('is_active', 'blocked', 'code', 'email', 'designation_id', 'department_id')) <> 6 then
    raise exception '0750: staff is missing a column comm_workspace_people reads';
  end if;
end $assert$;
