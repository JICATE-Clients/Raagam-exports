-- 0585 — Internal Work Order: Accessories go header-only too (2026-09-19)
--
-- 0582 did this for Yarn and Fabric once the IWO Fabric BOM (0581) could plan
-- them. Accessories kept their grid on the IWO screen until the IWO Material BOM
-- (0584) existed; it does now, and the IWO screen no longer writes these tables.
--
--   1. iwo_for_lock — checks only the two BOMs. Its third clause read
--      iwo_accessory_items, which this migration drops, so it is redefined
--      FIRST (a plpgsql body naming a missing table fails at run time, not at
--      create time — the lock would have broken on the first For change).
--   2. Drop iwo_accessory_process_details, then iwo_accessory_items (0 rows
--      each, checked before writing this; nothing else references them).
--   3. Drop iwo_line_guard() — 0578's per-kind line guard. Its only remaining
--      trigger lived on iwo_accessory_items and goes with the table.

-- ---------------------------------------------------------------------------
-- 1. The For lock — a BOM is the only thing that pins For now
-- ---------------------------------------------------------------------------
create or replace function public.iwo_for_lock()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.iwo_for is distinct from old.iwo_for then
    if exists (select 1 from public.iwo_fabric_boms b where b.iwo_id = old.id) then
      raise exception
        'This work order already has a Fabric BOM, so its For cannot change. Delete the Fabric BOM first (IWO Fabric BOM).'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.iwo_material_boms b where b.iwo_id = old.id) then
      raise exception
        'This work order already has a Material BOM, so its For cannot change. Delete the Material BOM first (IWO Material BOM).'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.iwo_for_lock() from public, anon;
grant execute on function public.iwo_for_lock() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The accessory line tables
-- ---------------------------------------------------------------------------
drop table if exists public.iwo_accessory_process_details;
drop table if exists public.iwo_accessory_items;

-- ---------------------------------------------------------------------------
-- 3. The line guard — no table uses it any more
-- ---------------------------------------------------------------------------
drop function if exists public.iwo_line_guard();

-- ---------------------------------------------------------------------------
-- 4. Assert it from the catalog, never from the statements above
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.iwo_accessory_items') is not null
     or to_regclass('public.iwo_accessory_process_details') is not null then
    raise exception '0585: an accessory line table survived';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'iwo_line_guard') then
    raise exception '0585: iwo_line_guard() survived';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'iwo_for_lock'
               and p.prosrc ilike '%iwo_accessory%') then
    raise exception '0585: iwo_for_lock still reads the dropped table';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_iwo_for_lock' and not tgisinternal) then
    raise exception '0585: trg_iwo_for_lock is missing';
  end if;
  if has_function_privilege('anon', 'public.iwo_for_lock()', 'execute') then
    raise exception '0585: iwo_for_lock() is executable by anon';
  end if;
end;
$$;
