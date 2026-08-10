-- ============================================================================
-- Raagam ERP — 0396 Style children point at the real masters
--
-- Three fields on the Style screen referenced `config_lookups` kinds that
-- shadow a real master sitting beside them. Every one of those kinds was empty
-- or junk, so the fields rendered dropdowns over nothing — the same defect 0394
-- fixed for Style Category, found to be a PATTERN rather than a one-off
-- (client 2026-08-10):
--
--   coordinate_id  -> kind 'coordinate'       2 rows, named "1" and "2"
--                     the real list is `items` under item class GAR:
--                     TOP, BOTTOM, INNER, OUTER, PIECES
--   component_id   -> kind 'style_component'  0 rows
--                     the real list is `components` (0228), which 0228's own
--                     header calls a promotion of the "too thin" flat kind
--   structure_id   -> kind 'structure'        0 rows
--                     the real list is kind 'fabric_structure' (3 rows)
--
-- A COORDINATE IS A GARMENT. That is why `items` under GARMENTS holds
-- TOP/BOTTOM/INNER/OUTER/PIECES: a Set style is two to six garments sold
-- together, so each coordinate IS one of them. The data was right; the FK was
-- pointed at a parallel list nobody maintained.
--
-- structure_id needs NO FK CHANGE — 'fabric_structure' rows are config_lookups
-- too, so only the kind the screen filters on moves. Recorded here because the
-- next reader will otherwise look for the missing third statement.
--
-- CLEAN: garment_style_coordinates and garment_style_components are both 0
-- rows, so nothing is being remapped. The guard asserts that rather than
-- assuming it — on a database where it is false, dropping these constraints
-- would strand ids with no way back.
-- ============================================================================

do $guard$
declare
  v_bad int;
begin
  select count(*) into v_bad from public.garment_style_coordinates c
   where c.coordinate_id is not null
     and not exists (select 1 from public.items i where i.id = c.coordinate_id);
  if v_bad > 0 then
    raise exception '0396: % garment_style_coordinates rows hold a coordinate_id that is not an item. Map them first.', v_bad;
  end if;

  select count(*) into v_bad from public.garment_style_components c
   where c.coordinate_id is not null
     and not exists (select 1 from public.items i where i.id = c.coordinate_id);
  if v_bad > 0 then
    raise exception '0396: % garment_style_components rows hold a coordinate_id that is not an item. Map them first.', v_bad;
  end if;

  select count(*) into v_bad from public.garment_style_components c
   where c.component_id is not null
     and not exists (select 1 from public.components m where m.id = c.component_id);
  if v_bad > 0 then
    raise exception '0396: % garment_style_components rows hold a component_id that is not a component. Map them first.', v_bad;
  end if;
end $guard$;

alter table public.garment_style_coordinates
  drop constraint if exists garment_style_coordinates_coordinate_id_fkey;
alter table public.garment_style_coordinates
  add constraint garment_style_coordinates_coordinate_id_fkey
  foreign key (coordinate_id) references public.items(id);

alter table public.garment_style_components
  drop constraint if exists garment_style_components_coordinate_id_fkey;
alter table public.garment_style_components
  add constraint garment_style_components_coordinate_id_fkey
  foreign key (coordinate_id) references public.items(id);

alter table public.garment_style_components
  drop constraint if exists garment_style_components_component_id_fkey;
alter table public.garment_style_components
  add constraint garment_style_components_component_id_fkey
  foreign key (component_id) references public.components(id);

-- Read the result back out of the catalog: {"success": true} means the SQL ran,
-- not that it achieved its goal (0386).
do $verify$
declare
  r record;
  v_want text;
begin
  for r in
    select src.relname as tbl, a.attname as col, tgt.relname as points_at
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and src.relname in ('garment_style_coordinates', 'garment_style_components')
       and a.attname in ('coordinate_id', 'component_id')
  loop
    v_want := case when r.col = 'component_id' then 'components' else 'items' end;
    if r.points_at <> v_want then
      raise exception '0396: %.% points at %, expected %', r.tbl, r.col, r.points_at, v_want;
    end if;
  end loop;
end $verify$;
