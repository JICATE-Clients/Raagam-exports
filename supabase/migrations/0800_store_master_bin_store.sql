-- 0800 — Store master + every bin belongs to a store (user 2026-11-03).
--
-- Stores existed (18 seeded: Material, Purchase, Processing, Rejection, Surplus, In
-- Transit in each of HO / U2 / U3) with no screen to manage them; bins had a unit but no
-- store, so the Bin box on GRN / Pending QC / every DC offered every bin in the unit and
-- stock could be put in a rack of a different store room. Now:
--
--   * stores.store_type gains 'storage' (decided 2026-11-03): Yarn Store, Fabric Store …
--     appear in every store / bin picker, but the system never routes stock into one by
--     itself. The six SYSTEM types are looked up as "the unit's <type> store" by 0780 /
--     0781 / 0782 (material, rejection), 0784 (transit), 0786 / 0787 (processing) with
--     `order by code limit 1`, so a second one of a system type in one unit would make
--     that routing pick whichever sorts first. They are now one-per-unit by index.
--   * stores.bin_prefix (decided 2026-11-03: the prefix lives on the STORE): a new bin
--     in that store left without a code is numbered PREFIX + 001, 002 … by the app.
--   * bins.store_id, mandatory. The bin's unit FOLLOWS its store (trigger), so the two can
--     never disagree. The two existing bins are in use (TESTBIN 8 records, "34" 5), so —
--     per the user's "delete if unused, else Material Store" — both go to Raagam HO's
--     Material Store.

-- 1. Store type: + storage, and one store per SYSTEM type per unit.
alter table public.stores drop constraint if exists stores_store_type_check;
alter table public.stores add constraint stores_store_type_check
  check (store_type in ('purchase', 'processing', 'material', 'rejection', 'surplus', 'transit', 'storage'));
create unique index if not exists stores_one_system_type_per_unit
  on public.stores (location_id, store_type) where store_type <> 'storage';

-- 2. The store's bin prefix.
alter table public.stores add column if not exists bin_prefix text;

-- 3. Every bin belongs to a store.
alter table public.bins add column if not exists store_id uuid references public.stores(id);
create index if not exists idx_bins_store on public.bins(store_id);

update public.bins b
   set store_id = s.id
  from public.stores s
  join public.locations l on l.id = s.location_id
 where b.store_id is null
   and s.store_type = 'material'
   and l.code = 'HO';

alter table public.bins alter column store_id set not null;

-- The bin's unit is its store's unit — set on every insert / store change, never typed.
create or replace function public.bins_unit_from_store()
returns trigger
language plpgsql
-- DEFINER: a Masters user making a bin may hold no Stores grant, and stores' read
-- policy would then hide the row and leave the unit blank. It reads one column.
security definer
set search_path = public
as $$
begin
  select s.location_id into new.location_id from public.stores s where s.id = new.store_id;
  return new;
end
$$;
revoke all on function public.bins_unit_from_store() from public, anon;

drop trigger if exists trg_bins_unit_from_store on public.bins;
create trigger trg_bins_unit_from_store
  before insert or update of store_id on public.bins
  for each row execute function public.bins_unit_from_store();

-- Bring the two existing bins' unit in line with their store.
update public.bins b set location_id = s.location_id from public.stores s where s.id = b.store_id and b.location_id is distinct from s.location_id;
