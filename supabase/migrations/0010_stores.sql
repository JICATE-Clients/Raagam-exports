-- ============================================================================
-- Raagam ERP — 0010 Store Management
-- 5 store types, per-store access control, stock ledger (append-only) with a
-- balance-maintaining trigger that HARD-BLOCKS negative stock, and store-scoped
-- RLS. Stock-in is fed by GRN posting (wired in purchase grn-actions).
-- ============================================================================

-- ---------- stores (5 types) ----------
create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  store_type  text not null check (store_type in
                ('purchase','processing','material','rejection','surplus')),
  location_id uuid references public.locations(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_stores_updated before update on public.stores
  for each row execute function public.set_updated_at();

-- ---------- store access (which keepers can access which stores) ----------
create table if not exists public.store_access (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);
create index if not exists idx_store_access_user on public.store_access(user_id);

-- ---------- stock ledger (append-only source of truth) ----------
create table if not exists public.stock_ledger (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores(id) on delete cascade,
  item_id             uuid not null references public.items(id),
  movement_type       text not null check (movement_type in
                        ('receipt','issue','return','transfer_in','transfer_out',
                         'adjust_in','adjust_out')),
  quantity            numeric(14,3) not null check (quantity >= 0),
  counterparty_store_id uuid references public.stores(id),  -- for transfers
  reference_type      text,   -- e.g. grn, sales_order, audit
  reference_id        uuid,
  note                text,
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists idx_ledger_store_item on public.stock_ledger(store_id, item_id);
create index if not exists idx_ledger_created on public.stock_ledger(created_at desc);

-- ---------- cached balances (maintained by trigger) ----------
create table if not exists public.stock_balances (
  store_id   uuid not null references public.stores(id) on delete cascade,
  item_id    uuid not null references public.items(id),
  quantity   numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, item_id)
);

-- ---------- balance trigger: maintain stock_balances + BLOCK negative stock ----
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_delta numeric;
  v_new   numeric;
begin
  v_delta := case
    when new.movement_type in ('receipt','return','transfer_in','adjust_in')
      then new.quantity
    else -new.quantity   -- issue, transfer_out, adjust_out
  end;

  insert into public.stock_balances (store_id, item_id, quantity, updated_at)
  values (new.store_id, new.item_id, v_delta, now())
  on conflict (store_id, item_id) do update
    set quantity = stock_balances.quantity + v_delta, updated_at = now()
  returning quantity into v_new;

  if v_new < 0 then
    raise exception 'Insufficient stock: movement would drive balance negative (% remaining)', v_new
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger trg_apply_stock after insert on public.stock_ledger
  for each row execute function public.apply_stock_movement();
-- trigger-only function: must not be a public RPC endpoint
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;

-- ---------- store-access RLS helper ----------
-- Super-admins and users with stores:approve (managers/MD/admin) see every
-- store; everyone else is limited to their store_access rows.
create or replace function public.can_access_store(p_store_id uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin(uid)
      or public.has_permission('stores', 'approve', uid)
      or exists (select 1 from public.store_access sa
                 where sa.user_id = uid and sa.store_id = p_store_id);
$$;
revoke execute on function public.can_access_store(uuid, uuid) from public, anon;
grant  execute on function public.can_access_store(uuid, uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.stores         enable row level security;
alter table public.store_access   enable row level security;
alter table public.stock_ledger   enable row level security;
alter table public.stock_balances enable row level security;

-- stores: visible if you can access them; master edits need stores create/edit/delete
create policy stores_read on public.stores
  for select to authenticated
  using (public.has_permission('stores','view') and public.can_access_store(id));
create policy stores_insert on public.stores
  for insert to authenticated with check (public.has_permission('stores','create'));
create policy stores_update on public.stores
  for update to authenticated
  using (public.has_permission('stores','edit'))
  with check (public.has_permission('stores','edit'));
create policy stores_delete on public.stores
  for delete to authenticated using (public.has_permission('stores','delete'));

-- store_access: managed by stores:approve (managers/admin) or super admin
create policy store_access_all on public.store_access
  for all to authenticated
  using (public.has_permission('stores','approve') or public.is_super_admin())
  with check (public.has_permission('stores','approve') or public.is_super_admin());

-- stock_ledger: append-only. read/insert scoped to accessible stores.
create policy ledger_read on public.stock_ledger
  for select to authenticated
  using (public.has_permission('stores','view') and public.can_access_store(store_id));
create policy ledger_insert on public.stock_ledger
  for insert to authenticated
  with check (public.has_permission('stores','create') and public.can_access_store(store_id));
-- (no update/delete policies → ledger is immutable; corrections are adjust_* rows)

-- stock_balances: read-only to users (maintained by SECURITY DEFINER trigger)
create policy balances_read on public.stock_balances
  for select to authenticated
  using (public.has_permission('stores','view') and public.can_access_store(store_id));

-- ============================================================================
-- Seeds
-- ============================================================================
-- Store Keeper role (store-limited; no approve)
insert into public.roles (name, description, is_system)
values ('Store Keeper', 'Manages stock for assigned store(s)', false)
on conflict (name) do nothing;

-- grants
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'stores' and p.action in ('view','create','edit')
where r.name = 'Store Keeper'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'stores' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'stores' and p.action = 'view'
where r.name = 'Merchandiser'
on conflict do nothing;

-- the 5 stores at Head Office
insert into public.stores (code, name, store_type, location_id)
select s.code, s.name, s.stype, (select id from public.locations where code = 'HO')
from (values
  ('ST-PUR','Purchase Store','purchase'),
  ('ST-PROC','Processing Store','processing'),
  ('ST-MAT','Material Store','material'),
  ('ST-REJ','Rejection Store','rejection'),
  ('ST-SUR','Surplus Store','surplus')
) as s(code, name, stype)
where not exists (select 1 from public.stores);
