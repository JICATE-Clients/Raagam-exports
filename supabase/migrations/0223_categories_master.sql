-- ============================================================================
-- Raagam ERP — 0223 Master Data ▸ Materials ▸ Categories (rich master)
-- Legacy EDP2 "Category" form: Item Class (req, → reference list) · Short Name ·
-- Name · Short Spec · Made (Natural/Manmade/Mixed) · Levy Description (→ levies)
-- · Commodity (→ config_lookups commodity) · Blocked. Too rich for the flat
-- config_lookups engine, so it gets its own table. RLS = 0218 style.
-- ============================================================================

-- ---------- Item Class reference list (new config_lookups kind) ----------
alter table public.config_lookups
  drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups
  add constraint config_lookups_kind_check check (kind in (
    'attribute','levy','material_category','material_attribute',
    'yarn_count','yarn_purity','composition','process','component',
    'gauge','knitting_dia','out_doc_term','commodity','item_class'));

insert into public.config_lookups (kind, code, name)
select 'item_class', v.code, v.name
from (values
  ('1000','BUTTON'),
  ('CAP','CAPITAL GOODS'),
  ('FABRIC','FABRIC'),
  ('GAR','GARMENTS'),
  ('GEN','GENERAL'),
  ('PACK','PACKING ACCESSORIES'),
  ('SEW','SEWING ACCESSORIES'),
  ('YARN','YARN')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups c
  where c.kind = 'item_class' and c.code = v.code
);

-- ---------- Categories table ----------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  item_class_id uuid not null references public.config_lookups(id),
  short_name    text,
  name          text,
  short_spec    text,
  made          text check (made is null or made in ('Natural','Manmade','Mixed')),
  levy_id       uuid references public.levies(id),
  commodity_id  uuid references public.config_lookups(id),
  blocked       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();
create index if not exists idx_categories_item_class on public.categories(item_class_id);
create index if not exists idx_categories_levy on public.categories(levy_id);
create index if not exists idx_categories_commodity on public.categories(commodity_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy categories_read on public.categories for select to authenticated using (true);
    create policy categories_insert on public.categories for insert to authenticated with check (public.has_permission('masters','create'));
    create policy categories_update on public.categories for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy categories_delete on public.categories for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.categories enable row level security;
end $$;
