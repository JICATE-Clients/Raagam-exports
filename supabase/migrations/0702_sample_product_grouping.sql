-- 0702 · Sample ▸ Grouping — batch sample styles into one Group Work Order
-- (doc/sample/product-grouping-specification.md, 2026-10-09).
--
-- A sample is 2–5 pieces and well under 2 kg of fabric; a mill sells by the
-- 50–60 kg bag. A group is the styles of ONE season that share ONE fabric
-- structure and ONE yarn blend, bought as one purchase rounded to the market
-- MOQ, then released back to each style for cutting when the fabric arrives.
--
-- THE SPEC'S SCHEMA, ON THIS DATABASE'S KEYS (the rule every sample table
-- follows: uuid FKs onto the tables that already exist, never text keys):
--   season      the season's NAME + `season_year`, with `season_id` → seasons
--               when the entry names a master row. Matched by name because the
--               entries hold both (Q1 from the Season master, an older SUMMER
--               typed before it existed) — the Season Report reads it the same way.
--   structure   `fabric_structure_id` → categories (a FABRIC-class category, the
--               Fabric field of Costing since 0698), its name kept beside it.
--   yarn blend  the costing's Yarn Mix as one label ("95% 24'S BCI COTTON /
--               5% 40 DINER ELASTANE"); `blend_key` is its normalised form
--               (lib/sales/sample-grouping/calc.ts `blendOf`) — what two
--               styles must share to batch.
--   sample_entry_id / style_id   → opportunities / styles; a style's kilos come
--               from its costing (`cost_sheet_id`), never typed.
--
-- WHAT THE SPEC LEAVES OPEN, decided here:
--   - MOQ and batch size are per group (`moq_kg` 60, `batch_kg` 30 by default —
--     the spec's own example GRP-SS26-002 buys at a 25 kg MOQ).
--   - `cutting_waste_pct` is the group's "Sample Cutting Waste %" of §5.3.
--   - Weights are numeric(10,3): a 5-piece sample is 1.375 kg, and (10,2) would
--     round away the gram the totals are reconciled on.
--   - One candidate — a style's fabric of one structure + blend — is in at most
--     one group (unique index below).
--   - Status vocabulary is the spec's five, lower-case like every status here.
--     `po_raised` is set when the group raises its Internal Work Order.
--
-- NOT unit-scoped, like `opportunities` and `cost_sheets` (0688): a sample is
-- the company's, not a unit's. The IW a group raises IS unit-scoped — it takes
-- the session's unit, as every IW does.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.sample_product_groups (
  id                      uuid primary key default gen_random_uuid(),
  group_code              text unique,
  season_id               uuid references public.seasons(id) on delete set null,
  season                  text not null check (btrim(season) <> ''),
  season_year             int not null check (season_year between 2000 and 2100),
  fabric_structure_id     uuid references public.categories(id) on delete set null,
  fabric_structure        text,
  yarn_blend              text not null,
  blend_key               text not null,
  moq_kg                  numeric(10,2) not null default 60 check (moq_kg > 0),
  batch_kg                numeric(10,2) not null default 30 check (batch_kg > 0),
  cutting_waste_pct       numeric(6,2)  not null default 0  check (cutting_waste_pct >= 0 and cutting_waste_pct < 100),
  net_required_weight_kg  numeric(10,3) not null default 0,
  moq_purchased_weight_kg numeric(10,3) not null default 0,
  status                  text not null default 'draft'
                            check (status in ('draft', 'approved', 'po_raised', 'fabric_received', 'completed')),
  iwo_id                  uuid references public.internal_work_orders(id) on delete set null,
  remarks                 text,
  approved_at             timestamptz,
  fabric_received_at      timestamptz,
  distributed_at          timestamptz,
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.sample_product_groups is
  'Sample ▸ Grouping (0702): sample styles of one season, structure and yarn blend bought as one MOQ-rounded purchase.';

create table if not exists public.sample_group_items (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references public.sample_product_groups(id) on delete cascade,
  sample_entry_id       uuid not null references public.opportunities(id) on delete cascade,
  style_id              uuid not null references public.styles(id) on delete cascade,
  cost_sheet_id         uuid references public.cost_sheets(id) on delete set null,
  fabric_structure_id   uuid references public.categories(id) on delete set null,
  blend_key             text not null,
  component_name        text not null default '',
  sample_qty_pcs        int not null check (sample_qty_pcs >= 0),
  calculated_weight_kg  numeric(10,3) not null check (calculated_weight_kg >= 0),
  allocated_fabric_kg   numeric(10,3),
  created_at            timestamptz not null default now()
);
create index if not exists idx_sgi_group on public.sample_group_items (group_id);
create index if not exists idx_sgi_style on public.sample_group_items (style_id);
-- A style's fabric of one structure + blend is batched once.
create unique index if not exists uq_sgi_candidate on public.sample_group_items
  (style_id, coalesce(fabric_structure_id, '00000000-0000-0000-0000-000000000000'::uuid), blend_key);

-- ---------------------------------------------------------------------------
-- 2. Group code — GRP/Q1-26/001: per Season + Year (the spec's GRP-SS26-001),
--    the LOWEST free number, like every sample series (0683 / 0686).
-- ---------------------------------------------------------------------------
create or replace function public.assign_sample_group_code()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
  v_next   int;
begin
  if new.group_code is not null and new.group_code <> '' then
    return new;
  end if;
  v_prefix := 'GRP/' || upper(regexp_replace(btrim(new.season), '\s+', '', 'g'))
              || '-' || lpad((new.season_year % 100)::text, 2, '0') || '/';
  perform pg_advisory_xact_lock(hashtext('sample_group:' || v_prefix));
  with used as (
    select substring(g.group_code from length(v_prefix) + 1)::int as n
      from public.sample_product_groups g
     where g.group_code like v_prefix || '%'
       and substring(g.group_code from length(v_prefix) + 1) ~ '^[0-9]+$'
  )
  select case when not exists (select 1 from used where n = 1) then 1
              else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
         end into v_next;
  new.group_code := v_prefix || lpad(v_next::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_sample_group_code on public.sample_product_groups;
create trigger trg_sample_group_code before insert on public.sample_product_groups
  for each row execute function public.assign_sample_group_code();

create or replace function public.touch_sample_group()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_sample_group_touch on public.sample_product_groups;
create trigger trg_sample_group_touch before update on public.sample_product_groups
  for each row execute function public.touch_sample_group();

-- ---------------------------------------------------------------------------
-- 3. A batch that has left Draft is a commitment
--    - its styles cannot be added, removed or re-weighed (only the release
--      figure `allocated_fabric_kg` is written, at distribution);
--    - a style in it cannot be deleted from Sample Entry, which would
--      otherwise cascade it out of a purchase already made;
--    - the group itself cannot be deleted.
--    Said in words, because the operator who meets it is on another screen.
-- ---------------------------------------------------------------------------
create or replace function public.guard_sample_group_items()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_group  uuid := coalesce(new.group_id, old.group_id);
  v_status text;
  v_code   text;
begin
  select g.status, g.group_code into v_status, v_code
    from public.sample_product_groups g where g.id = v_group;
  -- The group itself is being deleted (cascade) — its own guard has spoken.
  if not found or v_status = 'draft' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.group_id = old.group_id
     and new.style_id = old.style_id
     and new.sample_entry_id = old.sample_entry_id
     and new.blend_key = old.blend_key
     and new.fabric_structure_id is not distinct from old.fabric_structure_id
     and new.sample_qty_pcs = old.sample_qty_pcs
     and new.calculated_weight_kg = old.calculated_weight_kg
     and new.component_name = old.component_name then
    return new;
  end if;
  raise exception 'This style is batched in sample group % (%), which is past Draft — its styles can no longer change.',
    v_code, v_status using errcode = '55000';
end;
$$;
drop trigger if exists trg_guard_sample_group_items on public.sample_group_items;
create trigger trg_guard_sample_group_items before insert or update or delete on public.sample_group_items
  for each row execute function public.guard_sample_group_items();

create or replace function public.guard_sample_group_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Sample group % is past Draft and cannot be deleted.', old.group_code using errcode = '55000';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_guard_sample_group_delete on public.sample_product_groups;
create trigger trg_guard_sample_group_delete before delete on public.sample_product_groups
  for each row execute function public.guard_sample_group_delete();

-- Function grants (AGENTS.md): trigger functions, never callable by anon.
revoke all on function public.assign_sample_group_code() from public, anon;
revoke all on function public.touch_sample_group() from public, anon;
revoke all on function public.guard_sample_group_items() from public, anon;
revoke all on function public.guard_sample_group_delete() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. RLS — the Sales grants, as 0688. A LINE is written by whoever may edit
--    the document (insert = create OR edit, delete = edit OR delete).
-- ---------------------------------------------------------------------------
alter table public.sample_product_groups enable row level security;
alter table public.sample_group_items enable row level security;

drop policy if exists sample_product_groups_read on public.sample_product_groups;
create policy sample_product_groups_read on public.sample_product_groups for select to authenticated
  using (public.has_permission('sales', 'view'));
drop policy if exists sample_product_groups_insert on public.sample_product_groups;
create policy sample_product_groups_insert on public.sample_product_groups for insert to authenticated
  with check (public.has_permission('sales', 'create'));
drop policy if exists sample_product_groups_update on public.sample_product_groups;
create policy sample_product_groups_update on public.sample_product_groups for update to authenticated
  using (public.has_permission('sales', 'edit'))
  with check (public.has_permission('sales', 'edit'));
drop policy if exists sample_product_groups_delete on public.sample_product_groups;
create policy sample_product_groups_delete on public.sample_product_groups for delete to authenticated
  using (public.has_permission('sales', 'delete'));

drop policy if exists sample_group_items_read on public.sample_group_items;
create policy sample_group_items_read on public.sample_group_items for select to authenticated
  using (public.has_permission('sales', 'view'));
drop policy if exists sample_group_items_insert on public.sample_group_items;
create policy sample_group_items_insert on public.sample_group_items for insert to authenticated
  with check (public.has_permission('sales', 'create') or public.has_permission('sales', 'edit'));
drop policy if exists sample_group_items_update on public.sample_group_items;
create policy sample_group_items_update on public.sample_group_items for update to authenticated
  using (public.has_permission('sales', 'edit'))
  with check (public.has_permission('sales', 'edit'));
drop policy if exists sample_group_items_delete on public.sample_group_items;
create policy sample_group_items_delete on public.sample_group_items for delete to authenticated
  using (public.has_permission('sales', 'edit') or public.has_permission('sales', 'delete'));
