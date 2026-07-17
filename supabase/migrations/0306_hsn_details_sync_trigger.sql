-- ============================================================================
-- Raagam ERP — 0306 Sync hsn_details → config_lookups (kind='hsn_code')
--
-- Problem: GST > HSN Detail screen writes to `hsn_details` table, but
-- Materials > HSN picker reads from `config_lookups` WHERE kind='hsn_code'.
-- New HSN codes created in GST never appear in the Materials picker.
--
-- Fix: DB trigger that mirrors inserts/updates/deletes from hsn_details
-- into config_lookups with kind='hsn_code'. Also backfills existing rows.
-- ============================================================================

-- 0. Add a unique index on (kind, code) for hsn_code entries to prevent dupes
create unique index if not exists idx_config_lookups_hsn_unique
  on public.config_lookups (kind, code) where kind = 'hsn_code';

-- 1. Create the sync function
create or replace function public.sync_hsn_detail_to_config_lookups()
returns trigger as $$
begin
  if TG_OP = 'DELETE' then
    delete from public.config_lookups
      where kind = 'hsn_code' and code = OLD.hsn_code;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.hsn_code is not null
       and not NEW.is_draft
       and not coalesce(NEW.inactive, false)
    then
      insert into public.config_lookups (kind, code, name, is_active)
        values ('hsn_code', NEW.hsn_code, NEW.description, true)
        on conflict (kind, code) where kind = 'hsn_code'
        do update set name = excluded.name, is_active = true;
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- If hsn_code changed, remove old entry
    if OLD.hsn_code is distinct from NEW.hsn_code and OLD.hsn_code is not null then
      delete from public.config_lookups
        where kind = 'hsn_code' and code = OLD.hsn_code;
    end if;

    -- If now inactive/draft or hsn_code cleared, remove
    if NEW.hsn_code is null or NEW.is_draft or coalesce(NEW.inactive, false) then
      delete from public.config_lookups
        where kind = 'hsn_code' and code = coalesce(NEW.hsn_code, OLD.hsn_code);
    else
      -- Upsert the current state
      insert into public.config_lookups (kind, code, name, is_active)
        values ('hsn_code', NEW.hsn_code, NEW.description, true)
        on conflict (kind, code) where kind = 'hsn_code'
        do update set name = excluded.name, is_active = true;
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

-- 2. Attach the trigger
drop trigger if exists trg_hsn_details_sync on public.hsn_details;
create trigger trg_hsn_details_sync
  after insert or update or delete on public.hsn_details
  for each row execute function public.sync_hsn_detail_to_config_lookups();

-- 3. Backfill: sync existing hsn_details rows into config_lookups
insert into public.config_lookups (kind, code, name, is_active)
  select 'hsn_code', h.hsn_code, h.description, true
  from public.hsn_details h
  where h.hsn_code is not null
    and not h.is_draft
    and not coalesce(h.inactive, false)
on conflict (kind, code) where kind = 'hsn_code'
do update set name = excluded.name, is_active = true;
