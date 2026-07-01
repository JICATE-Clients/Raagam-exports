-- ============================================================================
-- Raagam ERP — 0001 Foundation
-- Locations (GST entities), profiles, admin-configurable RBAC, audit log.
-- ============================================================================

-- ---------- shared helpers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- locations (HO + Unit 2 = separate GST entities) ----------
create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  gst_number  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_locations_updated before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  phone               text,
  full_name           text,
  employee_code       text unique,
  default_location_id uuid references public.locations(id),
  is_super_admin      boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- auto-create a profile when an auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (new.id, new.email, new.phone, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RBAC: roles, permission catalog, links ----------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_system   boolean not null default false,  -- system roles cannot be deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

-- catalog of every (module, action) the app understands
create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  module      text not null,
  action      text not null,    -- view | create | edit | delete | approve | export
  description text,
  unique (module, action)
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- a user holds a role, optionally scoped to one location (null = all locations)
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, role_id, location_id)
);
create index if not exists idx_user_roles_user on public.user_roles(user_id);

-- ---------- audit log ----------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id),
  action      text not null,           -- e.g. amendment.approved, role.updated
  entity_type text,                    -- e.g. sales_order
  entity_id   uuid,
  location_id uuid references public.locations(id),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ============================================================================
-- Permission helper functions (SECURITY DEFINER → avoid RLS recursion)
-- ============================================================================
create or replace function public.is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_super_admin from public.profiles where id = uid), false);
$$;

create or replace function public.has_permission(
  p_module text, p_action text, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin(uid) or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = uid and p.module = p_module and p.action = p_action
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.locations        enable row level security;
alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.audit_log        enable row level security;

-- locations: everyone authenticated can read; system_admin manages
create policy locations_read on public.locations
  for select to authenticated using (true);
create policy locations_write on public.locations
  for all to authenticated
  using (public.has_permission('system_admin', 'edit'))
  with check (public.has_permission('system_admin', 'edit'));

-- profiles: read own; system_admin reads/writes all
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_permission('system_admin', 'view'));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.has_permission('system_admin', 'edit'))
  with check (id = auth.uid() or public.has_permission('system_admin', 'edit'));
create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.has_permission('system_admin', 'create'));

-- roles / permissions / links / user_roles: system_admin only (lookups for
-- permission checks go through SECURITY DEFINER functions, so RLS here is safe)
create policy roles_admin_all on public.roles
  for all to authenticated
  using (public.has_permission('system_admin', 'view'))
  with check (public.has_permission('system_admin', 'edit'));
create policy permissions_admin_read on public.permissions
  for select to authenticated using (public.has_permission('system_admin', 'view'));
create policy role_permissions_admin_all on public.role_permissions
  for all to authenticated
  using (public.has_permission('system_admin', 'view'))
  with check (public.has_permission('system_admin', 'edit'));
create policy user_roles_admin_all on public.user_roles
  for all to authenticated
  using (public.has_permission('system_admin', 'view') or user_id = auth.uid())
  with check (public.has_permission('system_admin', 'edit'));

-- audit_log: any authenticated user may append; system_admin may read
create policy audit_insert on public.audit_log
  for insert to authenticated with check (true);
create policy audit_read on public.audit_log
  for select to authenticated
  using (public.has_permission('system_admin', 'view'));
