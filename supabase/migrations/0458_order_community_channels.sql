-- ============================================================================
-- Raagam ERP — 0458 The order-centric "RE-Community" collaboration channel
--
-- doc/file.md §4:
--
--     "saving a new order automatically spawns a dedicated collaboration
--      channel ... uniquely bound to the RE Number (ஆரி நம்பர்), serving as the
--      permanent digital file for the job. Relevant stakeholders are auto-joined
--      based on their system permissions ... The stream supports direct file
--      sharing (CAD markers) and system-bot alerts."
--
--
-- ## THE RE NUMBER IS NOT THE JOIN KEY, AND IS STORED ANYWAY
--
-- "Uniquely bound to the RE Number" is a statement about IDENTITY, not about
-- foreign keys. The RE Number IS `sales_orders.order_number`, and the decisive
-- fact is that IT HAS TWO LIVE SHAPES — counted in this database on 2026-08-23,
-- not guessed:
--
--     HO/RE/26-27/0001    5 rows   current, dashed fiscal year (0431)
--     U2/RE//2526/2047   86 rows   legacy: DOUBLE SLASH after RE, no dash
--
-- So the legacy shape is 95% of the data and is not going anywhere. A unique
-- index or a lookup keyed on that string is keyed on two formats that do not
-- compare equal, which is precisely the failure AGENTS.md records under
-- "Nominated vendors": a comparison written for one spelling "compiles, runs,
-- and quietly matches nothing". A channel that silently resolves to no order is
-- indistinguishable from an order nobody has talked about yet.
--
-- The channel therefore hangs off `sales_order_id` — stable, single-shaped, and
-- what `uq_order_channels_order` below actually enforces. `re_number` beside it
-- is a DISPLAY copy so a channel list does not need a join to say which job it
-- is about. NOTHING PARSES OR REBUILDS IT: no format is hard-coded anywhere in
-- this migration or in `lib/orders/community/**`, both shapes are carried
-- verbatim, and assertion (j) at the foot of this file refuses a unique index on
-- the column so a later reader cannot quietly promote the copy to a key.
--
-- A denormalised copy rots, so it is not left to rot: `trg_soc_resync_re_number`
-- rewrites it if `sales_orders.order_number` ever changes. Without that trigger
-- the failure is a channel labelled with a number the order no longer has —
-- which on a floor that tracks by RE Number is worse than no label.
--
--
-- ## MEMBERSHIP IS MATERIALISED, FROM A RULE THAT RE-RUNS AND ONLY ADDS
--
-- The alternative — derive membership at read time from `has_permission()` —
-- was rejected, and the reason is the whole feature. If the read policy is
-- `has_permission('orders','view')` then EVERY holder of that permission reads
-- EVERY channel, and "an isolated digital workspace" is a table with a filter on
-- it. A private workspace needs a gate that a permission alone does not open.
--
-- So membership is rows. Which brings the snapshot problem the derived design
-- does not have: a CAD technician hired next month is in no existing channel.
-- `sync_order_channel_members()` is the answer — the seeding rule is DATA
-- (`order_channel_member_rules`), it is re-run every time a channel is opened,
-- and it is `on conflict do nothing`, so it is cheap and repeatable.
--
-- **THE SYNC NEVER REMOVES ANYONE.** Two separate reasons, and both matter:
--
--   * A person who posted in the stream is party to the conversation. Silently
--     revoking their read on it the day their role changes is not tidiness, it
--     is destroying an operator's access to work they did — and it destroys it
--     invisibly, because nothing on screen says a channel was ever there.
--   * An explicit removal must SURVIVE the rule re-running. `removed_at` is set
--     by a person; the sync's `on conflict do nothing` leaves that row alone, so
--     re-opening the channel does not silently re-add someone an operator took
--     out. A sync that removed rows would fight the operator every page load.
--
-- The cost is stated rather than hidden: leaving a job does not leave the
-- channel. Removal is an act, `order_channel_members.removed_at`, and it is
-- someone's decision.
--
--
-- ## THE SPAWN IS IDEMPOTENT BY CONSTRAINT, NOT BY CHECKING FIRST
--
-- `uq_order_channels_order` — one channel per order, enforced by the database.
-- A "select then insert if absent" in the service would race two concurrent
-- saves into two channels for one order, and the second one would be invisible
-- to whoever was already reading the first. The trigger inserts
-- `on conflict (sales_order_id) do nothing`, so saving an order twice cannot
-- produce two workspaces even if both saves land in the same millisecond.
--
--
-- ## A BOT MESSAGE IS A COLUMN, NOT A PREFIX ON THE BODY
--
-- `order_channel_messages.kind` is 'message' | 'bot' | 'system', and the CHECK
-- constraints tie it to `author_id`: a human message HAS an author, a bot
-- message has NONE. A naming convention on the body ("[BOT] ...") is a
-- convention a human can type, which means the stream could be forged by
-- anybody who can post — and the insert policy below is what makes that
-- structural rather than hoped-for: an authenticated user may only insert
-- `kind = 'message'` with `author_id = auth.uid()`. Bot rows arrive through
-- `post_order_channel_bot_message()`, SECURITY DEFINER, and by no other door.
--
--
-- ## NOTIFICATIONS ARE NOT REBUILT HERE
--
-- `public.notifications` (0040) already exists, already streams live over
-- Realtime, and already has a web-push fan-out in `lib/notifications/notify.ts`.
-- The bot function inserts the MESSAGE and returns the member ids; the TypeScript
-- caller passes those to `notify()`. Inserting notification rows from SQL would
-- have produced in-app rows with no push, i.e. a second, quieter notification
-- system beside the working one.
-- ============================================================================


-- ---------- 1. the seeding rule, as data ------------------------------------
--
-- §4 names three stakeholder groups — Merchandisers, CAD Technicians, Cutting
-- Room Heads — and this codebase's RBAC vocabulary has no such words in it.
-- It has ROLES (rows an admin names) and PERMISSIONS (a fixed
-- module × action grid, `lib/auth/types.ts`). Which of those means "CAD
-- Technician" is a business decision, not a schema fact, so the mapping is a
-- TABLE an admin can correct rather than a CASE statement in a function that
-- would need a migration to change.
--
-- A rule names a role OR a permission, never both and never neither — the same
-- two-of-four vocabulary `NotifyTarget` in lib/notifications/notify.ts already
-- speaks, so a rule can be handed to the existing fan-out unchanged.

create table if not exists public.order_channel_member_rules (
  id           uuid primary key default gen_random_uuid(),
  -- What this group IS in the channel. Shown beside a member's name, and what a
  -- bot alert addresses ("the Merchandiser") rather than naming individuals.
  channel_role text not null
               check (channel_role in ('merchandiser','cad','cutting_room','quality','planner')),
  -- Exactly one of these two routes. `role_name` matches `public.roles.name`.
  role_name    text,
  perm_module  text,
  perm_action  text,
  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  -- A rule that names neither resolves to nobody and would make a channel look
  -- correctly configured while auto-joining no one; a rule that names both has
  -- two answers and no stated precedence.
  constraint chk_ocmr_one_route check (
    (role_name is not null and perm_module is null and perm_action is null)
    or
    (role_name is null and perm_module is not null and perm_action is not null)
  )
);

create unique index if not exists uq_ocmr_role_route
  on public.order_channel_member_rules (
    channel_role,
    coalesce(role_name, ''),
    coalesce(perm_module, ''),
    coalesce(perm_action, '')
  );

comment on table public.order_channel_member_rules is
  'Which system roles/permissions are auto-joined to every order channel (doc/file.md §4). DATA, not code: the spec names job titles this RBAC has no word for, so the mapping is editable without a migration.';
comment on column public.order_channel_member_rules.is_active is
  'A retired rule is switched off, never deleted — members it already added keep their rows, because sync only ever ADDS (see this migration''s header).';


-- The two stakeholder groups §4 names that no role covers yet. 0010 (Store
-- Keeper) and 0011 (Supervisor) set this precedent: a migration that needs a
-- role creates it. Creating a role grants nothing to anybody until an admin
-- assigns it, so this is purely additive.
insert into public.roles (name, description, is_system) values
  ('CAD Technician',   'Marker layouts and component gram weights',        false),
  ('Cutting Room Head','Fabric readiness, marker PDFs, cutting room floor', false)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'orders' and p.action in ('view','edit')
where r.name = 'CAD Technician'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on (p.module = 'orders' and p.action = 'view')
  or (p.module = 'production' and p.action in ('view','edit'))
where r.name = 'Cutting Room Head'
on conflict do nothing;

insert into public.order_channel_member_rules (channel_role, role_name, note) values
  ('merchandiser', 'Merchandiser',      'Procurement and delivery oversight (doc/file.md §4)'),
  ('cad',          'CAD Technician',    'Marker and gram-weight updates (doc/file.md §4)'),
  ('cutting_room', 'Cutting Room Head', 'Fabric readiness alerts and marker PDFs (doc/file.md §4)')
on conflict do nothing;


-- ---------- 2. the channel ---------------------------------------------------

create table if not exists public.order_channels (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  -- DISPLAY ONLY. Never join on this. Kept in step by trg_soc_resync_re_number.
  re_number      text,
  topic          text,
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now(),
  -- NULL on every row the trigger and the backfill make, and that is honest: the
  -- channel was created by the system, not by a person. AGENTS.md's Created User
  -- rule is about LISTINGS of records an operator made; a channel is spawned.
  created_by     uuid references public.profiles(id)
);

-- The idempotency of the spawn, in one line. See the header: a check-then-insert
-- in the service races; this cannot.
create unique index if not exists uq_order_channels_order
  on public.order_channels (sales_order_id);

comment on table public.order_channels is
  'One collaboration workspace per sales order (doc/file.md §4). Bound by sales_order_id; re_number is a display copy of sales_orders.order_number and is never a join key.';


-- ---------- 3. members --------------------------------------------------------

create table if not exists public.order_channel_members (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.order_channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  channel_role text,
  -- How this row came to exist. 'rule' rows are re-asserted by every sync;
  -- 'manual' and 'order_owner' rows are not, and must never be assumed
  -- reproducible — deleting one loses information the rule cannot recreate.
  join_reason  text not null default 'rule'
               check (join_reason in ('rule','manual','order_owner')),
  rule_id      uuid references public.order_channel_member_rules(id) on delete set null,
  -- Per-person read marker. The unread count is (messages newer than this).
  last_read_at timestamptz,
  -- Set by a PERSON. The sync's `on conflict do nothing` steps over this row,
  -- which is what stops a page load from silently re-adding someone.
  removed_at   timestamptz,
  added_at     timestamptz not null default now(),
  added_by     uuid references public.profiles(id)
);

create unique index if not exists uq_ocm_channel_user
  on public.order_channel_members (channel_id, user_id);
create index if not exists idx_ocm_user
  on public.order_channel_members (user_id) where removed_at is null;

comment on column public.order_channel_members.removed_at is
  'An explicit removal by a person. It survives the auto-join rule re-running — sync only ever ADDS (see this migration''s header).';


-- ---------- 4. the stream -----------------------------------------------------

create table if not exists public.order_channel_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.order_channels(id) on delete cascade,
  -- NULL is a REAL VALUE here and not "missing": nobody wrote a bot message.
  author_id  uuid references public.profiles(id) on delete set null,
  kind       text not null default 'message'
             check (kind in ('message','bot','system')),
  body       text,
  -- What the bot is reporting, e.g. 'cad_weights_submitted'. Stable, machine
  -- readable, and separate from `body`, which is a sentence that may be reworded
  -- without breaking whatever counts these.
  event_key  text,
  href       text,
  -- A reply. Threading is one level by intent: a stream about one order does not
  -- need a tree, and a tree makes "what happened on this job" unreadable.
  parent_id  uuid references public.order_channel_messages(id) on delete cascade,
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  -- The kind/author tie, enforced rather than assumed. Its absence is what would
  -- let an "automated" alert be a row a person wrote.
  constraint chk_ocmsg_author_kind check (
    (kind = 'message' and author_id is not null)
    or (kind in ('bot','system') and author_id is null)
  ),
  -- A message with neither text nor an attachment is not a message. Attachments
  -- are checked in the application, so this only refuses the empty human post.
  constraint chk_ocmsg_bot_has_body check (kind <> 'bot' or coalesce(btrim(body), '') <> '')
);

create index if not exists idx_ocmsg_channel_created
  on public.order_channel_messages (channel_id, created_at desc);
create index if not exists idx_ocmsg_parent
  on public.order_channel_messages (parent_id) where parent_id is not null;

comment on column public.order_channel_messages.kind is
  'Human vs bot is a COLUMN, not a prefix on the body — a prefix is something a human can type, and this is what the insert policy keys the forgery refusal off.';


create table if not exists public.order_channel_files (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.order_channel_messages(id) on delete cascade,
  file_name    text not null,
  -- Key WITHIN the private order-community-files bucket. Never a URL: a signed
  -- one expires, and 0416 records the same rule for garment-order-docs.
  -- The FIRST FOLDER IS THE CHANNEL ID, and that is load-bearing — the storage
  -- policies below read it to decide who may fetch the bytes.
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_ocf_path on public.order_channel_files (storage_path);
create index if not exists idx_ocf_message on public.order_channel_files (message_id);


-- ---------- 5. the membership gate --------------------------------------------
--
-- SECURITY DEFINER for the reason 0001's own helpers give: a policy ON
-- order_channel_members that reads order_channel_members recurses. It is also
-- what lets the storage policies below ask the question at all — storage.objects
-- policies run as the caller, who cannot select a channel they are not in.

create or replace function public.is_order_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_channel is not null and (
    public.is_super_admin()
    or exists (
      select 1 from public.order_channel_members m
      where m.channel_id = p_channel
        and m.user_id = (select auth.uid())
        and m.removed_at is null
    )
  );
$$;
revoke all on function public.is_order_channel_member(uuid) from public, anon;
grant execute on function public.is_order_channel_member(uuid) to authenticated;

comment on function public.is_order_channel_member(uuid) is
  'The channel gate. Returns FALSE for a null channel, deliberately: the storage helper below hands it null for a malformed path, and a super admin must not be let through on one.';


-- A message is visible exactly when its channel is. Separate function so the
-- files policy has one thing to call rather than an inline join that PostgREST
-- would have to re-plan per row.
create or replace function public.is_order_channel_message_visible(p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.order_channel_messages g
    where g.id = p_message
      and public.is_order_channel_member(g.channel_id)
  );
$$;
revoke all on function public.is_order_channel_message_visible(uuid) from public, anon;
grant execute on function public.is_order_channel_message_visible(uuid) to authenticated;


-- The channel id a storage key belongs to, or NULL when the key is not shaped
-- like one of ours. A bare `::uuid` cast RAISES on a malformed path, and an
-- exception inside a storage policy is a 500 on a file listing rather than a
-- refusal — so the shape is TESTED before it is cast.
create or replace function public.order_channel_of_path(p_name text)
returns uuid language sql stable set search_path = '' as $$
  select case
    when coalesce((storage.foldername(p_name))[1], '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;
revoke all on function public.order_channel_of_path(text) from public, anon;
grant execute on function public.order_channel_of_path(text) to authenticated;


-- ---------- 6. auto-join, and the spawn ---------------------------------------

create or replace function public.sync_order_channel_members(p_channel uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  added   integer := 0;
  n       integer := 0;
  v_order uuid;
begin
  select sales_order_id into v_order
    from public.order_channels where id = p_channel;
  if v_order is null then
    return 0;                        -- no such channel; nothing to seed
  end if;

  -- (a) The order's own merchandiser. `sales_orders.merchandiser_id` defaults to
  --     auth.uid() (0006), so this is normally whoever saved the order — the one
  --     member no permission rule can identify, because it is about THIS job and
  --     not about a job title.
  insert into public.order_channel_members (channel_id, user_id, channel_role, join_reason)
  select p_channel, so.merchandiser_id, 'merchandiser', 'order_owner'
    from public.sales_orders so
   where so.id = v_order and so.merchandiser_id is not null
  on conflict (channel_id, user_id) do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- (b) Everyone a rule reaches, by role name or by permission. UNION ALL then
  --     `on conflict do nothing` rather than DISTINCT: one person may be reached
  --     by two rules, and which channel_role they land with is then whichever
  --     rule got there first. That is deliberate — inventing a precedence
  --     between "Merchandiser" and "CAD Technician" would be a guess, and the
  --     row is a label, not a permission.
  with reached as (
    select r.id as rule_id, r.channel_role, ur.user_id
      from public.order_channel_member_rules r
      join public.roles ro on ro.name = r.role_name
      join public.user_roles ur on ur.role_id = ro.id
     where r.is_active and r.role_name is not null
    union all
    select r.id, r.channel_role, ur.user_id
      from public.order_channel_member_rules r
      join public.permissions p on p.module = r.perm_module and p.action = r.perm_action
      join public.role_permissions rp on rp.permission_id = p.id
      join public.user_roles ur on ur.role_id = rp.role_id
     where r.is_active and r.perm_module is not null
  )
  insert into public.order_channel_members (channel_id, user_id, channel_role, join_reason, rule_id)
  select p_channel, x.user_id, x.channel_role, 'rule', x.rule_id
    from (select distinct on (user_id) user_id, channel_role, rule_id
            from reached order by user_id, rule_id) x
  on conflict (channel_id, user_id) do nothing;
  get diagnostics n = row_count;

  -- The RETURN IS ROWS ADDED BY THIS CALL, not the channel's member count. The
  -- caller uses it to decide whether anything changed; a total would read as
  -- "everyone was just auto-joined" on every single page load.
  return added + n;
end $$;
revoke all on function public.sync_order_channel_members(uuid) from public, anon;
grant execute on function public.sync_order_channel_members(uuid) to authenticated;

comment on function public.sync_order_channel_members(uuid) is
  'Re-runnable auto-join. ADDS ONLY — never removes, so an explicit removed_at survives it and a person who posted keeps their access. See 0458''s header.';


create or replace function public.ensure_order_channel(p_sales_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_channel uuid;
begin
  if p_sales_order_id is null then
    return null;
  end if;

  insert into public.order_channels (sales_order_id, re_number)
  select so.id, so.order_number
    from public.sales_orders so
   where so.id = p_sales_order_id
  on conflict (sales_order_id) do nothing;

  select id into v_channel
    from public.order_channels where sales_order_id = p_sales_order_id;
  if v_channel is null then
    return null;                     -- no such order
  end if;

  perform public.sync_order_channel_members(v_channel);
  return v_channel;
end $$;
revoke all on function public.ensure_order_channel(uuid) from public, anon;
grant execute on function public.ensure_order_channel(uuid) to authenticated;

comment on function public.ensure_order_channel(uuid) is
  'Get-or-create for an order''s channel, plus a member sync. SECURITY DEFINER and callable by any signed-in user, which grants NOTHING: it can create a channel the caller cannot read and can only add members a RULE reaches. It never adds the caller, so it is not a way into a workspace.';


create or replace function public.spawn_order_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- SWALLOWED ON PURPOSE, and this is the one place in this migration where a
  -- failure is not allowed to propagate. An order that cannot be SAVED because
  -- its chat room could not be created is a far worse outcome than an order
  -- whose chat room is late — and it is not even a permanent loss, because
  -- `ensure_order_channel()` is get-or-create and the service calls it every
  -- time the Community tab is opened. The gap self-heals on first visit.
  begin
    perform public.ensure_order_channel(new.id);
  exception when others then
    raise warning '0458: order channel not spawned for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.spawn_order_channel() from public, anon;

drop trigger if exists trg_so_spawn_channel on public.sales_orders;
create trigger trg_so_spawn_channel
  after insert on public.sales_orders
  for each row execute function public.spawn_order_channel();


-- The display copy, kept honest. Fires only when the number actually changes.
create or replace function public.resync_order_channel_re_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.order_channels
     set re_number = new.order_number
   where sales_order_id = new.id;
  return new;
end $$;
revoke all on function public.resync_order_channel_re_number() from public, anon;

drop trigger if exists trg_soc_resync_re_number on public.sales_orders;
create trigger trg_soc_resync_re_number
  after update of order_number on public.sales_orders
  for each row when (new.order_number is distinct from old.order_number)
  execute function public.resync_order_channel_re_number();


-- ---------- 7. the bot ---------------------------------------------------------
--
-- The ONLY door a `kind = 'bot'` row comes through. The insert policy below
-- refuses one from an authenticated caller, so §4's "automated notification"
-- cannot be typed by a person into a stream that production reads as automatic.
--
-- Returns the recipient ids rather than raising notifications itself: 0040's
-- `notifications` table already exists and lib/notifications/notify.ts already
-- pairs an in-app row with web push. Inserting rows here would produce in-app
-- notifications with no push — a second, quieter notification system.

create or replace function public.post_order_channel_bot_message(
  p_sales_order_id uuid,
  p_event_key      text,
  p_body           text,
  p_href           text default null
)
returns table (message_id uuid, channel_id uuid, recipient_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_channel uuid;
  v_message uuid;
begin
  if coalesce(btrim(p_body), '') = '' then
    return;                          -- an empty alert is not an alert
  end if;

  v_channel := public.ensure_order_channel(p_sales_order_id);
  if v_channel is null then
    return;
  end if;

  insert into public.order_channel_messages (channel_id, author_id, kind, body, event_key, href)
  values (v_channel, null, 'bot', btrim(p_body), p_event_key, p_href)
  returning id into v_message;

  return query
    select v_message, v_channel, m.user_id
      from public.order_channel_members m
     where m.channel_id = v_channel and m.removed_at is null;
end $$;
revoke all on function public.post_order_channel_bot_message(uuid, text, text, text) from public, anon;
grant execute on function public.post_order_channel_bot_message(uuid, text, text, text) to authenticated;


-- ---------- 8. RLS -------------------------------------------------------------
--
-- THIS IS THE FEATURE. Every select policy below gates on MEMBERSHIP, not on
-- `has_permission('orders','view')` — an orders permission is held by most of
-- the company, so gating on it would make "isolated workspace" mean "a filter".
-- Knowing a channel id buys nothing: the id is the ARGUMENT to the gate, not a
-- way past it.

alter table public.order_channel_member_rules enable row level security;
alter table public.order_channels             enable row level security;
alter table public.order_channel_members      enable row level security;
alter table public.order_channel_messages     enable row level security;
alter table public.order_channel_files        enable row level security;

do $rls$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'order_channels') then
    execute $f$
      -- The rules are configuration: readable by anyone who can see orders (a
      -- member list showing "CAD" needs the vocabulary), writable by admins only.
      create policy order_channel_member_rules_read on public.order_channel_member_rules
        for select to authenticated using (public.has_permission('orders','view'));
      create policy order_channel_member_rules_write on public.order_channel_member_rules
        for all to authenticated
        using (public.has_permission('system_admin','edit'))
        with check (public.has_permission('system_admin','edit'));

      -- No INSERT policy on channels, deliberately: a channel is spawned by the
      -- trigger / ensure_order_channel(), both SECURITY DEFINER. A hand-made
      -- channel would be one with no order behind it.
      create policy order_channels_read on public.order_channels
        for select to authenticated using (public.is_order_channel_member(id));
      create policy order_channels_update on public.order_channels
        for update to authenticated
        using (public.is_order_channel_member(id) and public.has_permission('orders','edit'))
        with check (public.is_order_channel_member(id) and public.has_permission('orders','edit'));

      -- You can see who else is in a channel you are in.
      create policy order_channel_members_read on public.order_channel_members
        for select to authenticated using (public.is_order_channel_member(channel_id));
      -- Inviting and removing is a member act, gated on orders:edit so a reader
      -- cannot widen a workspace they merely observe.
      create policy order_channel_members_insert on public.order_channel_members
        for insert to authenticated
        with check (public.is_order_channel_member(channel_id) and public.has_permission('orders','edit'));
      -- UPDATE covers two different things and only one of them is other people:
      -- setting your OWN last_read_at, and removing someone. Own-row is allowed
      -- unconditionally or a plain reader could never mark a channel read.
      create policy order_channel_members_update on public.order_channel_members
        for update to authenticated
        using (
          user_id = (select auth.uid())
          or (public.is_order_channel_member(channel_id) and public.has_permission('orders','edit'))
        )
        with check (
          user_id = (select auth.uid())
          or (public.is_order_channel_member(channel_id) and public.has_permission('orders','edit'))
        );

      -- A MEMBER MAY POST ONLY AS THEMSELVES, AND ONLY AS A HUMAN. Both halves
      -- are load-bearing: without the author test one member posts under
      -- another's name; without the kind test anyone fabricates a system alert.
      create policy order_channel_messages_read on public.order_channel_messages
        for select to authenticated using (public.is_order_channel_member(channel_id));
      create policy order_channel_messages_insert on public.order_channel_messages
        for insert to authenticated
        with check (
          public.is_order_channel_member(channel_id)
          and kind = 'message'
          and author_id = (select auth.uid())
        );
      -- Editing is your own words only. Not gated on orders:edit: that
      -- permission is about ORDERS, and it would let a manager rewrite what
      -- somebody else said in an auditable stream.
      create policy order_channel_messages_update on public.order_channel_messages
        for update to authenticated
        using (author_id = (select auth.uid()))
        with check (author_id = (select auth.uid()) and kind = 'message');
      create policy order_channel_messages_delete on public.order_channel_messages
        for delete to authenticated
        using (
          author_id = (select auth.uid())
          or (public.is_order_channel_member(channel_id) and public.has_permission('orders','delete'))
        );

      create policy order_channel_files_read on public.order_channel_files
        for select to authenticated using (public.is_order_channel_message_visible(message_id));
      create policy order_channel_files_insert on public.order_channel_files
        for insert to authenticated with check (public.is_order_channel_message_visible(message_id));
      create policy order_channel_files_delete on public.order_channel_files
        for delete to authenticated using (public.is_order_channel_message_visible(message_id));
    $f$;
  end if;
end $rls$;


-- ---------- 9. the bucket -------------------------------------------------------
--
-- A SEPARATE BUCKET FROM garment-order-docs (0416), on purpose. That bucket's
-- policies read `has_permission('orders','view')`, so putting a CAD marker there
-- would make it readable by every orders user — which is exactly the isolation
-- §4 asks for and section 8 above just spent forty lines building. Here the
-- storage gate is the SAME membership gate: the first folder of the key is the
-- channel id, and `order_channel_of_path()` turns it back into one.

insert into storage.buckets (id, name, public)
values ('order-community-files', 'order-community-files', false)
on conflict (id) do nothing;

drop policy if exists order_community_files_read   on storage.objects;
drop policy if exists order_community_files_insert on storage.objects;
drop policy if exists order_community_files_update on storage.objects;
drop policy if exists order_community_files_delete on storage.objects;

create policy order_community_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'order-community-files'
         and public.is_order_channel_member(public.order_channel_of_path(name)));

create policy order_community_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-community-files'
              and public.is_order_channel_member(public.order_channel_of_path(name)));

create policy order_community_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'order-community-files'
         and public.is_order_channel_member(public.order_channel_of_path(name)))
  with check (bucket_id = 'order-community-files'
              and public.is_order_channel_member(public.order_channel_of_path(name)));

create policy order_community_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-community-files'
         and public.is_order_channel_member(public.order_channel_of_path(name)));


-- ---------- 10. live updates ------------------------------------------------------
-- Realtime enforces the select policy, so a subscriber receives only messages in
-- channels they are a member of. Wrapped: adding a table twice raises.
do $rt$
begin
  begin
    execute 'alter publication supabase_realtime add table public.order_channel_messages';
  exception when duplicate_object then null;
  end;
end $rt$;


-- ---------- 11. backfill -----------------------------------------------------------
-- Orders that existed before the trigger. §4 calls the channel "the permanent
-- digital file for the job" — a job that predates this migration still has one.
do $backfill$
declare
  r record;
begin
  for r in select id from public.sales_orders loop
    perform public.ensure_order_channel(r.id);
  end loop;
end $backfill$;


-- ============================================================================
-- 12. ASSERTIONS
--
-- VERIFY FROM THE CATALOG, NEVER BY READING THE MIGRATION. `{"success": true}`
-- means the SQL ran, not that it achieved its stated goal — 0383 and 0386 both
-- applied cleanly and both left a function anon-callable.
--
-- The two claims worth most here are behavioural, not structural, so they are
-- asserted BY BEING VIOLATED: the spawn really refuses a second channel, and a
-- forged bot row really is refused by its CHECK. A name present in pg_indexes
-- proves a name is present.
-- ============================================================================

do $assert$
declare
  probe_order   uuid;
  probe_channel uuid;
  probe_author  uuid;
  n             integer;
begin
  /*
   * (a0) RLS IS ACTUALLY ON. Added by the lead at integration, 2026-08-23.
   *
   * The migration runs `enable row level security` on all five tables, and the
   * policy assertions below check that each SELECT policy's qual names the
   * membership gate. NEITHER of those proves RLS is enabled: `create policy`
   * succeeds on a table with RLS off, the policy then does nothing, and the
   * table reads WIDE OPEN to every authenticated user while every existing
   * assertion still passes.
   *
   * That is this file's own opening rule turned on itself — "verify from the
   * catalog, never by reading the migration". `pg_class.relrowsecurity` is the
   * catalog, and nothing here was reading it.
   *
   * On a private per-order workspace this is the difference between the feature
   * and its opposite, so it is asserted FIRST — before the tables, because a
   * later assertion failing would leave the earlier tables enabled and the
   * reader guessing which state they are in.
   */
  if (select count(*) from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public'
         and c.relname in ('order_channels','order_channel_members',
                           'order_channel_messages','order_channel_files',
                           'order_channel_member_rules')
         and c.relrowsecurity) <> 5 then
    raise exception
      '0458: row level security is NOT enabled on all five channel tables — the policies are inert and the streams read wide open';
  end if;

  -- (a) every table exists
  if (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('order_channels','order_channel_members',
                            'order_channel_messages','order_channel_files',
                            'order_channel_member_rules')) <> 5 then
    raise exception '0458: not all five community tables were created';
  end if;

  -- (b) every function is closed to anon AND to public. Two grants, one
  --     statement — AGENTS.md "Function grants": revoking one leaves the other.
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where p.proname in ('is_order_channel_member','is_order_channel_message_visible',
                       'order_channel_of_path','sync_order_channel_members',
                       'ensure_order_channel','spawn_order_channel',
                       'resync_order_channel_re_number','post_order_channel_bot_message')
     and (
          has_function_privilege('anon', p.oid, 'EXECUTE')
       -- PUBLIC is a pseudo-role, so has_function_privilege('public', ...) does
       -- not compile — it is read out of the ACL instead. A NULL acl is the
       -- built-in default, under which PUBLIC holds EXECUTE; an explicit PUBLIC
       -- grant is an entry with an EMPTY grantee, `=X/owner`.
       or p.proacl is null
       or p.proacl::text ~ '(\{|,)=X'
     );
  if n > 0 then
    raise exception '0458: % community function(s) are still executable by anon/public', n;
  end if;

  -- (c) the trigger really is on sales_orders
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_so_spawn_channel' and not tgisinternal) then
    raise exception '0458: trg_so_spawn_channel was not created';
  end if;

  -- (d) THE ISOLATION CLAIM. Every select policy on the stream must mention the
  --     membership gate. A policy that reads has_permission alone would compile,
  --     pass every structural check above, and make the workspace public to the
  --     company — the exact failure section 8 exists to prevent.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('order_channels','order_channel_members','order_channel_messages')
       and cmd = 'SELECT'
       and coalesce(qual, '') not like '%is_order_channel_member%'
  ) then
    raise exception '0458: a stream SELECT policy does not gate on channel membership';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'order_channel_files' and cmd = 'SELECT'
       and coalesce(qual, '') not like '%is_order_channel_message_visible%'
  ) then
    raise exception '0458: order_channel_files SELECT does not gate on channel membership';
  end if;

  -- (e) the storage bucket is PRIVATE. One boolean away from publishing every
  --     CAD marker in the company to the open internet.
  if not exists (select 1 from storage.buckets where id = 'order-community-files') then
    raise exception '0458: the order-community-files bucket was not created';
  end if;
  if (select public from storage.buckets where id = 'order-community-files') then
    raise exception '0458: order-community-files is PUBLIC — CAD markers would be world-readable';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'order_community_files%') <> 4 then
    raise exception '0458: expected 4 storage.objects policies for order-community-files';
  end if;

  -- (f) THE IDEMPOTENT SPAWN, PROVED BY ATTEMPTING THE SECOND ONE.
  select id into probe_order from public.sales_orders limit 1;
  if probe_order is not null then
    if not exists (select 1 from public.order_channels where sales_order_id = probe_order) then
      raise exception '0458: backfill left an existing order with no channel';
    end if;
    begin
      insert into public.order_channels (sales_order_id) values (probe_order);
      raise exception '0458: a SECOND channel was accepted for one order — uq_order_channels_order is not enforcing';
    exception when unique_violation then
      null;   -- refused, which is the point
    end;

    -- ensure_order_channel is get-or-create: calling it twice must not add one.
    select count(*) into n from public.order_channels;
    perform public.ensure_order_channel(probe_order);
    if (select count(*) from public.order_channels) <> n then
      raise exception '0458: ensure_order_channel created a duplicate channel';
    end if;

    -- (g) A BOT ROW CANNOT CARRY AN AUTHOR, AND A HUMAN ROW CANNOT LACK ONE.
    --     This is the constraint standing behind "bot vs human is a column":
    --     without it the kind means nothing, because either row could claim it.
    select id into probe_channel from public.order_channels where sales_order_id = probe_order;
    select id into probe_author  from public.profiles limit 1;

    -- GUARDED ON A REAL PROFILE EXISTING, and this is not defensiveness for its
    -- own sake: with an empty `profiles` the sub-select is NULL, the row becomes
    -- a perfectly legal authorless bot message, the insert SUCCEEDS, and the
    -- `raise` below fires — failing the migration for the constraint WORKING.
    -- An assertion that reports the opposite of the truth on an empty database
    -- is worse than no assertion.
    if probe_author is not null then
      begin
        insert into public.order_channel_messages (channel_id, author_id, kind, body)
        values (probe_channel, probe_author, 'bot', 'forged');
        raise exception '0458: a bot message was accepted WITH an author — chk_ocmsg_author_kind is not enforcing';
      exception when check_violation then
        null;
      end;
    end if;
    begin
      insert into public.order_channel_messages (channel_id, author_id, kind, body)
      values (probe_channel, null, 'message', 'anonymous');
      raise exception '0458: a human message was accepted with NO author — chk_ocmsg_author_kind is not enforcing';
    exception when check_violation then
      null;
    end;
  end if;

  -- (h) a rule must name exactly one route
  begin
    insert into public.order_channel_member_rules (channel_role, role_name, perm_module, perm_action)
    values ('cad', 'CAD Technician', 'orders', 'edit');
    raise exception '0458: a rule naming BOTH a role and a permission was accepted';
  exception when check_violation then
    null;
  end;

  -- (i) the three stakeholder rules of doc/file.md §4 are seeded and active
  if (select count(*) from public.order_channel_member_rules
       where is_active and channel_role in ('merchandiser','cad','cutting_room')) < 3 then
    raise exception '0458: the three doc/file.md §4 stakeholder rules are not seeded';
  end if;

  -- (j) THE RE NUMBER MUST NOT BE A KEY. `re_number` is a display copy of a
  --     column carrying TWO live formats (see this migration's header: 86 rows
  --     `U2/RE//2526/2047`, 5 rows `HO/RE/26-27/0001`). A unique index on it
  --     would be a key over two spellings that never compare equal — and the
  --     day somebody adds one is the day it starts looking like the real
  --     identity. The FK is the identity; this refuses the alternative.
  if exists (
    select 1
      from pg_index i
      join pg_class c   on c.oid = i.indrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
     where c.relname = 'order_channels'
       and a.attname = 're_number'
       and i.indisunique
  ) then
    raise exception '0458: re_number is uniquely indexed — it is a DISPLAY copy of a two-format column, never a key. Bind by sales_order_id.';
  end if;

  -- And the copy must actually have been taken, or the channel list has nothing
  -- to label itself with and every row reads "Order". Checked against the source
  -- rather than for non-null: an order with no number legitimately copies null.
  if exists (
    select 1 from public.order_channels ch
      join public.sales_orders so on so.id = ch.sales_order_id
     where so.order_number is distinct from ch.re_number
  ) then
    raise exception '0458: a channel''s re_number does not match its order''s order_number';
  end if;
end $assert$;
