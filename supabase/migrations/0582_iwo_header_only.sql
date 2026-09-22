-- ============================================================================
-- Raagam ERP — 0582 The Internal Work Order becomes a header; its yarn and
-- fabric plan lives on the IWO Fabric BOM.
--
-- Client, 2026-09-18/19: the IWO header (screenshot 2936) and its BOM
-- (2937 / 2938) are separate screens, and the order Fabric BOM was duplicated
-- for the IWO (0581). A work order For Yarn or For Fabric is now planned
-- there, so the simple yarn / fabric grids 0578 put on the IWO screen are
-- superseded. Accessories keep theirs until the Material BOM copy lands.
--
-- ## 1. THE FOUR SUPERSEDED TABLES GO
--
-- iwo_yarn_items, iwo_yarn_process_details, iwo_fabric_items and
-- iwo_fabric_process_details held NO ROWS when this was written (checked live,
-- 2026-09-19), and nothing reads them any more. Dropped rather than left beside
-- their replacements, where a second place to plan one yarn would be a second
-- answer to "how much do we buy". Their triggers go with them;
-- `iwo_line_guard` stays — iwo_accessory_items still uses it.
--
-- ## 2. FOR IS LOCKED ONCE SOMETHING HANGS OFF IT
--
-- 0581's guard checks For when a BOM is WRITTEN, but nothing stopped the IWO's
-- For changing afterwards: a Fabric work order switched to Accessories would
-- leave its Fabric BOM planning cloth for a document that no longer buys any.
-- So For cannot change while the IWO has a Fabric BOM or accessory lines. The
-- IWO screen clears its accessory lines BEFORE writing the header (see
-- `saveInternalWorkOrder`), so a deliberate Accessories → Fabric switch with
-- the lines cleared still passes; a BOM has to be deleted on its own screen.
-- ============================================================================

drop table if exists public.iwo_yarn_process_details;
drop table if exists public.iwo_yarn_items;
drop table if exists public.iwo_fabric_process_details;
drop table if exists public.iwo_fabric_items;

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
    if exists (select 1 from public.iwo_accessory_items a where a.iwo_id = old.id) then
      raise exception
        'This work order still has accessory lines, so its For cannot change. Clear them first.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.iwo_for_lock() is
  'Refuses a change of internal_work_orders.iwo_for while the IWO has a Fabric '
  'BOM or accessory lines (0582) — its plan would be left describing another kind.';

revoke all on function public.iwo_for_lock() from public, anon;
grant execute on function public.iwo_for_lock() to authenticated;

drop trigger if exists trg_iwo_for_lock on public.internal_work_orders;
create trigger trg_iwo_for_lock
  before update of iwo_for on public.internal_work_orders
  for each row execute function public.iwo_for_lock();

-- Assertions, from the catalog.
do $$
begin
  if to_regclass('public.iwo_yarn_items') is not null
     or to_regclass('public.iwo_yarn_process_details') is not null
     or to_regclass('public.iwo_fabric_items') is not null
     or to_regclass('public.iwo_fabric_process_details') is not null then
    raise exception '0582: a superseded IWO line table still exists';
  end if;
  if to_regclass('public.iwo_accessory_items') is null then
    raise exception '0582: iwo_accessory_items must survive';
  end if;
  if has_function_privilege('anon', 'public.iwo_for_lock()', 'EXECUTE') then
    raise exception '0582: iwo_for_lock is executable by anon';
  end if;
  if (select count(*) from pg_trigger
       where tgfoid = 'public.iwo_line_guard()'::regprocedure and not tgisinternal) <> 1 then
    raise exception '0582: iwo_line_guard should now sit on iwo_accessory_items alone';
  end if;
end $$;
