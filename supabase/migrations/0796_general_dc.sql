-- 0796 · GENERAL DC — material sent OUT to someone outside that is neither job work nor a
-- vendor return (user 2026-11-02, Purchase ▸ Purchase Store ▸ General Delivery): a machine
-- to a repairer, a sample to a buyer, a loan, a gift. Marked RETURNABLE or NON-RETURNABLE.
--
-- One more kind on the ONE DC document (doc/stores/dc-plan.md §1, "one DC hub"):
-- `delivery_challans.dc_kind = 'general'`, same `assign_code('DC', seq_dc)` numbering, same
-- register, same print kit.
--
--   * The party is a master vendor OR a typed name + address (a buyer's office, a
--     technician) — `party_name` / `party_address`. One of the two is required.
--   * A line is a stock item (`item_id`, from a store / bin / lot) or FREE TEXT (description
--     only — a sewing machine with its serial number), which moves no stock.
--   * `approx_value` per line — the value the challan declares (not a sale).
--   * A non-returnable DC has no expected return date.
--
-- `general_dc_dispatch(dc_id)` — SECURITY DEFINER, all or nothing:
--   returnable     → each stock line TRANSFERS from its store into the unit's Processing
--                    store ("at party"), as 0786 does for job work: still ours, still on the
--                    books. The DC reads `issued`; it comes back on a Delivery Return (0797).
--   non-returnable → each stock line is ISSUED out of its store (gone for good). The DC
--                    reads `closed`.
--   `apply_stock_movement` refuses a negative balance, so nothing can leave that is not held.
--
-- RLS: a General DC is Stores' OR Purchase's work (either permission), current unit only,
-- written by hand only while a draft. Policies and `dc_line_writable` are re-created from
-- their LATEST bodies (0786) with the general branch added beside the other two.

-- ---------- the DC ----------
alter table public.delivery_challans drop constraint if exists delivery_challans_dc_kind_check;
alter table public.delivery_challans add constraint delivery_challans_dc_kind_check
  check (dc_kind in ('process', 'production', 'general'));

alter table public.delivery_challans
  add column if not exists is_returnable boolean not null default true,
  add column if not exists party_name text,
  add column if not exists party_address text;

alter table public.delivery_challans drop constraint if exists delivery_challans_general_party;
alter table public.delivery_challans add constraint delivery_challans_general_party
  check (dc_kind <> 'general' or vendor_id is not null or nullif(btrim(coalesce(party_name, '')), '') is not null);

alter table public.delivery_challans drop constraint if exists delivery_challans_nonreturnable_no_return_date;
alter table public.delivery_challans add constraint delivery_challans_nonreturnable_no_return_date
  check (is_returnable or expected_return_date is null);

comment on column public.delivery_challans.is_returnable is 'General DC (0796): true = the goods come back (Delivery Return, 0797); false = they leave for good.';
comment on column public.delivery_challans.party_name is 'General DC (0796): the party when it is not a master vendor (a buyer office, a technician).';

alter table public.dc_line_items
  add column if not exists approx_value numeric check (approx_value is null or approx_value >= 0);

-- ---------- RLS (latest bodies: 0786) ----------
drop policy if exists delivery_challans_read on public.delivery_challans;
create policy delivery_challans_read on public.delivery_challans for select to authenticated
  using (
    (dc_kind in ('process', 'general') and (public.has_permission('materials_purchase', 'view') or public.has_permission('stores', 'view'))
     and public.is_current_location(location_id))
    or (dc_kind = 'production' and public.has_permission('stores', 'view')
        and (public.is_current_location(location_id) or public.is_current_location(to_location_id)))
  );
drop policy if exists delivery_challans_insert on public.delivery_challans;
create policy delivery_challans_insert on public.delivery_challans for insert to authenticated
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'create') or public.has_permission('stores', 'create')))
         or (dc_kind = 'production' and public.has_permission('stores', 'create'))
         or (dc_kind = 'general' and status = 'draft'
             and (public.has_permission('materials_purchase', 'create') or public.has_permission('stores', 'create'))))
  );
drop policy if exists delivery_challans_update on public.delivery_challans;
create policy delivery_challans_update on public.delivery_challans for update to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit')))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft')
         or (dc_kind = 'general' and status = 'draft'
             and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit'))))
  )
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit')))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft')
         or (dc_kind = 'general' and status = 'draft'
             and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit'))))
  );
drop policy if exists delivery_challans_delete on public.delivery_challans;
create policy delivery_challans_delete on public.delivery_challans for delete to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'delete')
                                   or (status = 'draft' and public.has_permission('stores', 'edit'))))
         or (dc_kind = 'production' and status = 'draft'
             and (public.has_permission('stores', 'delete') or public.has_permission('stores', 'edit')))
         or (dc_kind = 'general' and status = 'draft'
             and (public.has_permission('materials_purchase', 'delete') or public.has_permission('stores', 'delete')
                  or public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit'))))
  );

create or replace function public.dc_line_writable(p_dc_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.delivery_challans x
     where x.id = p_dc_id
       and public.is_current_location(x.location_id)
       and ((x.dc_kind = 'process'
             and (public.has_permission('materials_purchase', p_action)
                  or (x.status = 'draft' and (public.has_permission('stores', p_action)
                                              or (p_action = 'delete' and public.has_permission('stores', 'edit'))))))
            or (x.dc_kind = 'production' and x.status = 'draft'
                and (public.has_permission('stores', p_action)
                     or (p_action = 'delete' and public.has_permission('stores', 'edit'))))
            or (x.dc_kind = 'general' and x.status = 'draft'
                and (public.has_permission('stores', p_action) or public.has_permission('materials_purchase', p_action)
                     or (p_action = 'delete' and (public.has_permission('stores', 'edit')
                                                  or public.has_permission('materials_purchase', 'edit')))))))
$$;
revoke all on function public.dc_line_writable(uuid, text) from public, anon;
grant execute on function public.dc_line_writable(uuid, text) to authenticated;

-- ---------- dispatch ----------
create or replace function public.general_dc_dispatch(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  l record;
  v_proc uuid;
  v_n integer := 0;
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'general' then
    raise exception 'General DC not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to dispatch a General DC' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'A General DC is dispatched by the unit it was raised in — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'This DC has already been dispatched' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(d.purpose, '')), '') is null then
    raise exception 'Say why the goods are going out (Purpose)' using errcode = 'P0001';
  end if;
  if d.is_returnable and d.expected_return_date is null then
    raise exception 'A returnable DC needs the expected return date' using errcode = 'P0001';
  end if;

  if d.is_returnable then
    select id into v_proc from public.stores
     where location_id = d.location_id and store_type = 'processing' and is_active order by code limit 1;
    if v_proc is null then
      raise exception 'This unit has no Processing store to hold goods out on a returnable DC — set one up under Stores first'
        using errcode = 'P0001';
    end if;
  end if;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    if coalesce(l.sent_qty, 0) <= 0 or nullif(btrim(coalesce(l.description, '')), '') is null then
      raise exception 'Every line needs a description and a qty' using errcode = 'P0001';
    end if;
    v_n := v_n + 1;
    -- A free-text line (a machine, a sample with no item code) moves no stock.
    continue when l.item_id is null;
    if l.from_store_id is null or not exists (
      select 1 from public.stores s where s.id = l.from_store_id and s.location_id = d.location_id
         and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick a store of this unit to send from', l.description using errcode = 'P0001';
    end if;
    if d.is_returnable then
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
         reference_type, reference_id, lot_no, note)
      values
        (l.from_store_id, l.bin_id, l.item_id, 'transfer_out', l.sent_qty, v_proc, d.dc_date, d.location_id,
         'delivery_challan', p_dc_id, nullif(upper(btrim(coalesce(l.lot_no, ''))), ''),
         'Sent out (returnable) on ' || coalesce(d.code, '')),
        (v_proc, null, l.item_id, 'transfer_in', l.sent_qty, l.from_store_id, d.dc_date, d.location_id,
         'delivery_challan', p_dc_id, nullif(upper(btrim(coalesce(l.lot_no, ''))), ''),
         'At party on ' || coalesce(d.code, ''));
    else
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id, lot_no, note)
      values
        (l.from_store_id, l.bin_id, l.item_id, 'issue', l.sent_qty, d.dc_date, d.location_id,
         'delivery_challan', p_dc_id, nullif(upper(btrim(coalesce(l.lot_no, ''))), ''),
         'Sent out (non-returnable) on ' || coalesce(d.code, '') || ' — ' || d.purpose);
    end if;
  end loop;
  if v_n = 0 then
    raise exception 'A General DC needs at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans
     set status = case when d.is_returnable then 'issued' else 'closed' end,
         dispatched_at = now(), dispatched_by = auth.uid(), stock_posted_at = now()
   where id = p_dc_id;
end;
$$;

revoke all on function public.general_dc_dispatch(uuid) from public, anon;
grant execute on function public.general_dc_dispatch(uuid) to authenticated;
