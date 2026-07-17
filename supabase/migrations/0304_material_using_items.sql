-- Material Details (General item class) — "Using (Items)" child grid: which
-- other items (any class) this material uses, plus Shade/UOM per line.
-- Mirrors material_mixings' shape/RLS/trigger.
create table if not exists material_using_items (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  sno integer not null default 0,
  used_item_id uuid references items(id),
  description text,
  shade text,
  uom_id uuid references uoms(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists material_using_items_item_id_idx on material_using_items(item_id);
alter table material_using_items enable row level security;
create policy material_using_items_read on material_using_items for select using (true);
create policy material_using_items_insert on material_using_items for insert with check (has_permission('masters','create'));
create policy material_using_items_update on material_using_items for update using (has_permission('masters','edit')) with check (has_permission('masters','edit'));
create policy material_using_items_delete on material_using_items for delete using (has_permission('masters','delete'));
create trigger trg_material_using_items_updated before update on material_using_items for each row execute function set_updated_at();
