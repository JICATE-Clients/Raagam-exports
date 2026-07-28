-- =============================================================================
-- 0349 — Category ▸ Sub-Category for General items
-- -----------------------------------------------------------------------------
-- General stores buy things like electrical supplies and stationery, and the
-- factory wants to answer "how much did we spend on Electrical this year?".
-- One flat Category can't answer it: today you either lose the detail (one
-- ELECTRICAL category) or lose the total (separate LIGHT / FAN / SWITCH
-- categories that never roll up). So Category gains an optional second level.
--
-- Modelled on process_sub_categories (0227): a child table hanging off the
-- parent master, revealed by a has_sub_categories flag. items.category_id keeps
-- meaning exactly what it means today — the sub-category is a NEW, additive
-- field, so nothing that reads category_id (material_attributes, fabric
-- structure inheritance, size groups, costing %) is disturbed.
--
-- General only for now (client 2026-07-28). Capital Goods was in the original
-- spec and is the obvious next one — see showsSubCategories() in
-- lib/masters/category-types.ts, which is where that decision lives.
-- =============================================================================

alter table public.categories
  add column if not exists has_sub_categories boolean not null default false;

create table if not exists public.category_sub_categories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  sno         integer not null default 0,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_category_sub_categories_updated before update on public.category_sub_categories
  for each row execute function public.set_updated_at();

create index if not exists idx_category_sub_categories_category
  on public.category_sub_categories(category_id);

-- Two "LIGHTS" under ELECTRICAL are indistinguishable in the material form's
-- dropdown. Case-insensitive because names are entered in CAPS but pasted data
-- may not be.
create unique index if not exists uq_category_sub_categories_name
  on public.category_sub_categories(category_id, upper(name));

-- The material's pick. ON DELETE RESTRICT, deliberately NOT set null: silently
-- nulling this on a material would corrupt exactly the spend report the whole
-- feature exists for. Removing an in-use sub-category raises 23503, which
-- category-actions turns into a readable "still used by N material(s)" message
-- (same spirit as deleteOrDeactivate / first_referencing_table in 0344).
alter table public.items
  add column if not exists sub_category_id uuid
    references public.category_sub_categories(id) on delete restrict;

create index if not exists idx_items_sub_category on public.items(sub_category_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
alter table public.category_sub_categories enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'category_sub_categories' and policyname = 'category_sub_categories_read') then
    create policy category_sub_categories_read on public.category_sub_categories
      for select to authenticated using (true);
    create policy category_sub_categories_insert on public.category_sub_categories
      for insert to authenticated with check (public.has_permission('masters','create'));
    create policy category_sub_categories_update on public.category_sub_categories
      for update to authenticated using (public.has_permission('masters','edit'))
      with check (public.has_permission('masters','edit'));
    create policy category_sub_categories_delete on public.category_sub_categories
      for delete to authenticated using (public.has_permission('masters','delete'));
  end if;
end $$;
