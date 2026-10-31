-- 0784 · PRODUCTION DC — material moved between units (doc/stores/dc-plan.md, user 2026-10-31).
--
-- One DC document for every outward challan: `delivery_challans.dc_kind` = 'process' (job
-- work, the DCs that exist today) | 'production' (unit → unit). A Production DC is two
-- steps, each one SECURITY DEFINER function, all or nothing:
--
--   production_dc_dispatch  — the SENDING unit: each line leaves its store (and bin) and
--                             lands in the sender's IN TRANSIT store. Status dispatched.
--   production_dc_receive   — the RECEIVING unit: what arrived goes from that transit store
--                             into the receiver's store and bin; what did not is a
--                             shortage, written off transit with its reason. Status received.
--
-- Between the two the goods are IN TRANSIT — on the books, at neither unit's shelves.
-- Both units read the DC (RLS below); each writes only its own step. The three units
-- share one GSTIN, so this is a stock transfer, not a sale (the print says so).
--
-- STORES: `transit` joins the store types; every unit gets one, and Unit 2 / Unit 3 get the
-- same five functional stores as Raagam HO (they had none, so nothing could be received
-- there — a GRN or a Production DC into U2 / U3 had nowhere to land).

-- ---------- stores ----------
alter table public.stores drop constraint if exists stores_store_type_check;
alter table public.stores add constraint stores_store_type_check
  check (store_type in ('purchase', 'processing', 'material', 'rejection', 'surplus', 'transit'));

insert into public.stores (code, name, store_type, location_id, is_active)
select v.code, v.name, v.store_type, l.id, true
  from public.locations l
  join (values
    ('HO', 'ST-TRN',  'In Transit',        'transit'),
    ('U2', 'U2-PUR',  'Purchase Store',    'purchase'),
    ('U2', 'U2-PROC', 'Processing Store',  'processing'),
    ('U2', 'U2-MAT',  'Material Store',    'material'),
    ('U2', 'U2-REJ',  'Rejection Store',   'rejection'),
    ('U2', 'U2-SUR',  'Surplus Store',     'surplus'),
    ('U2', 'U2-TRN',  'In Transit',        'transit'),
    ('U3', 'U3-PUR',  'Purchase Store',    'purchase'),
    ('U3', 'U3-PROC', 'Processing Store',  'processing'),
    ('U3', 'U3-MAT',  'Material Store',    'material'),
    ('U3', 'U3-REJ',  'Rejection Store',   'rejection'),
    ('U3', 'U3-SUR',  'Surplus Store',     'surplus'),
    ('U3', 'U3-TRN',  'In Transit',        'transit')
  ) as v(loc, code, name, store_type) on v.loc = l.code
on conflict (code) do nothing;

-- ---------- the DC ----------
alter table public.delivery_challans
  add column if not exists dc_kind text not null default 'process' check (dc_kind in ('process', 'production')),
  add column if not exists to_location_id uuid references public.locations(id),
  add column if not exists vehicle_no text,
  add column if not exists transporter text,
  add column if not exists eway_bill_no text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatched_by uuid references public.profiles(id),
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles(id);

alter table public.delivery_challans drop constraint if exists delivery_challans_status_check;
alter table public.delivery_challans add constraint delivery_challans_status_check
  check (status in ('draft', 'issued', 'dispatched', 'partially_returned', 'received', 'closed', 'cancelled'));

alter table public.delivery_challans drop constraint if exists delivery_challans_production_to_unit;
alter table public.delivery_challans add constraint delivery_challans_production_to_unit
  check (dc_kind <> 'production' or (to_location_id is not null and to_location_id <> location_id));

create index if not exists idx_delivery_challans_to_location on public.delivery_challans(to_location_id);

alter table public.dc_line_items
  add column if not exists from_store_id uuid references public.stores(id),
  add column if not exists bin_id uuid references public.bins(id),
  add column if not exists lot_no text,
  add column if not exists rate numeric,
  add column if not exists received_qty numeric not null default 0,
  add column if not exists shortage_qty numeric not null default 0,
  add column if not exists shortage_reason text,
  add column if not exists to_store_id uuid references public.stores(id),
  add column if not exists to_bin_id uuid references public.bins(id);

-- ---------- RLS: both units read a Production DC; each writes only its own step ----------
-- A Production DC is Stores work (`stores` permission); a job-work DC stays Purchase's.
create or replace function public.lv_delivery_challans(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_id is null or exists (
    select 1 from public.delivery_challans x
     where x.id = p_id
       and (public.is_current_location(x.location_id)
            or (x.dc_kind = 'production' and public.is_current_location(x.to_location_id))))
$$;

drop policy if exists delivery_challans_read on public.delivery_challans;
create policy delivery_challans_read on public.delivery_challans for select to authenticated
  using (
    (dc_kind = 'process' and public.has_permission('materials_purchase', 'view') and public.is_current_location(location_id))
    or (dc_kind = 'production' and public.has_permission('stores', 'view')
        and (public.is_current_location(location_id) or public.is_current_location(to_location_id)))
  );
drop policy if exists delivery_challans_insert on public.delivery_challans;
create policy delivery_challans_insert on public.delivery_challans for insert to authenticated
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and public.has_permission('materials_purchase', 'create'))
         or (dc_kind = 'production' and public.has_permission('stores', 'create')))
  );
drop policy if exists delivery_challans_update on public.delivery_challans;
create policy delivery_challans_update on public.delivery_challans for update to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and public.has_permission('materials_purchase', 'edit'))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft'))
  )
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and public.has_permission('materials_purchase', 'edit'))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft'))
  );
drop policy if exists delivery_challans_delete on public.delivery_challans;
create policy delivery_challans_delete on public.delivery_challans for delete to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and public.has_permission('materials_purchase', 'delete'))
         or (dc_kind = 'production' and status = 'draft'
             and (public.has_permission('stores', 'delete') or public.has_permission('stores', 'edit'))))
  );

-- Lines follow their DC. A production line is written only while the DC is a draft at the
-- SENDING unit; the receiving side writes through production_dc_receive.
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
       and ((x.dc_kind = 'process' and public.has_permission('materials_purchase', p_action))
            or (x.dc_kind = 'production' and x.status = 'draft'
                and (public.has_permission('stores', p_action)
                     or (p_action = 'delete' and public.has_permission('stores', 'edit'))))))
$$;
revoke all on function public.dc_line_writable(uuid, text) from public, anon;
grant execute on function public.dc_line_writable(uuid, text) to authenticated;

drop policy if exists dc_line_items_read on public.dc_line_items;
create policy dc_line_items_read on public.dc_line_items for select to authenticated
  using (public.lv_delivery_challans(delivery_challan_id)
         and (public.has_permission('materials_purchase', 'view') or public.has_permission('stores', 'view')));
drop policy if exists dc_line_items_insert on public.dc_line_items;
create policy dc_line_items_insert on public.dc_line_items for insert to authenticated
  with check (public.dc_line_writable(delivery_challan_id, 'create'));
drop policy if exists dc_line_items_update on public.dc_line_items;
create policy dc_line_items_update on public.dc_line_items for update to authenticated
  using (public.dc_line_writable(delivery_challan_id, 'edit'))
  with check (public.dc_line_writable(delivery_challan_id, 'edit'));
drop policy if exists dc_line_items_delete on public.dc_line_items;
create policy dc_line_items_delete on public.dc_line_items for delete to authenticated
  using (public.dc_line_writable(delivery_challan_id, 'delete'));

-- ---------- dispatch (sending unit) ----------
create or replace function public.production_dc_dispatch(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  l record;
  v_transit uuid;
  v_n integer := 0;
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'production' then
    raise exception 'Production DC not found' using errcode = 'P0002';
  end if;
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to dispatch a Production DC' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'A Production DC is dispatched by the unit sending it — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'This DC has already been dispatched' using errcode = 'P0001';
  end if;

  select id into v_transit from public.stores
   where location_id = d.location_id and store_type = 'transit' and is_active order by code limit 1;
  if v_transit is null then
    raise exception 'This unit has no In Transit store — set one up under Stores first' using errcode = 'P0001';
  end if;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    if l.item_id is null or coalesce(l.sent_qty, 0) <= 0 then
      raise exception 'Every line needs an item and a qty' using errcode = 'P0001';
    end if;
    if l.from_store_id is null or not exists (
      select 1 from public.stores s where s.id = l.from_store_id and s.location_id = d.location_id) then
      raise exception '%: pick a store of the sending unit', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    -- The out-leg runs apply_stock_movement, which refuses a negative balance: a unit
    -- cannot send what it does not hold.
    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
       reference_type, reference_id, note)
    values
      (l.from_store_id, l.bin_id, l.item_id, 'transfer_out', l.sent_qty, v_transit, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'Production DC ' || coalesce(d.code, '') || ' dispatched'),
      (v_transit, null, l.item_id, 'transfer_in', l.sent_qty, l.from_store_id, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'In transit on Production DC ' || coalesce(d.code, ''));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'A Production DC needs at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans
     set status = 'dispatched', dispatched_at = now(), dispatched_by = auth.uid(), stock_posted_at = now()
   where id = p_dc_id;
end;
$$;

-- ---------- receive (receiving unit) ----------
-- p_lines: [{ "line_id", "received_qty", "shortage_reason", "store_id", "bin_id" }]. Every
-- line is settled in one go: received + shortage = sent, the shortage being the rest.
create or replace function public.production_dc_receive(p_dc_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  l record;
  j jsonb;
  v_transit uuid;
  v_recv numeric;
  v_short numeric;
  v_store uuid;
  v_bin uuid;
  v_reason text;
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'production' then
    raise exception 'Production DC not found' using errcode = 'P0002';
  end if;
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to receive a Production DC' using errcode = '42501';
  end if;
  if not public.is_current_location(d.to_location_id) then
    raise exception 'A Production DC is received by the unit it was sent to — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'dispatched' then
    raise exception 'This DC is not waiting to be received' using errcode = 'P0001';
  end if;

  select id into v_transit from public.stores
   where location_id = d.location_id and store_type = 'transit' and is_active order by code limit 1;
  if v_transit is null then
    raise exception 'The sending unit has no In Transit store' using errcode = 'P0001';
  end if;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    j := null;
    select e.value into j from jsonb_array_elements(p_lines) e where e.value->>'line_id' = l.id::text limit 1;
    if j is null then
      raise exception '%: no receipt entered', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    v_recv := coalesce((j->>'received_qty')::numeric, 0);
    v_store := nullif(j->>'store_id', '')::uuid;
    v_bin := nullif(j->>'bin_id', '')::uuid;
    v_reason := nullif(btrim(coalesce(j->>'shortage_reason', '')), '');
    if v_recv < 0 or v_recv > l.sent_qty then
      raise exception '%: received must be between 0 and the % sent', coalesce(l.description, 'A line'), l.sent_qty
        using errcode = 'P0001';
    end if;
    v_short := l.sent_qty - v_recv;
    if v_short > 0 and v_reason is null then
      raise exception '%: % short — give the reason', coalesce(l.description, 'A line'), v_short using errcode = 'P0001';
    end if;

    if v_recv > 0 then
      if v_store is null or not exists (
        select 1 from public.stores s where s.id = v_store and s.location_id = d.to_location_id and s.store_type <> 'transit') then
        raise exception '%: pick a store of the receiving unit', coalesce(l.description, 'A line') using errcode = 'P0001';
      end if;
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, location_id, reference_type, reference_id, note)
      values
        (v_transit, null, l.item_id, 'transfer_out', v_recv, v_store, d.location_id,
         'delivery_challan', p_dc_id, 'Received at the other unit on Production DC ' || coalesce(d.code, '')),
        (v_store, v_bin, l.item_id, 'transfer_in', v_recv, v_transit, d.to_location_id,
         'delivery_challan', p_dc_id, 'Received on Production DC ' || coalesce(d.code, ''));
    end if;
    if v_short > 0 then
      -- Lost in transit: off the transit store, with the reason, at the sender's books.
      insert into public.stock_ledger
        (store_id, item_id, movement_type, quantity, location_id, reference_type, reference_id, note)
      values
        (v_transit, l.item_id, 'adjust_out', v_short, d.location_id,
         'delivery_challan', p_dc_id, 'Short on Production DC ' || coalesce(d.code, '') || ': ' || v_reason);
    end if;

    update public.dc_line_items
       set received_qty = v_recv, shortage_qty = v_short, shortage_reason = v_reason,
           to_store_id = v_store, to_bin_id = v_bin
     where id = l.id;
  end loop;

  update public.delivery_challans
     set status = 'received', received_at = now(), received_by = auth.uid()
   where id = p_dc_id;
end;
$$;

revoke all on function public.production_dc_dispatch(uuid) from public, anon;
grant execute on function public.production_dc_dispatch(uuid) to authenticated;
revoke all on function public.production_dc_receive(uuid, jsonb) from public, anon;
grant execute on function public.production_dc_receive(uuid, jsonb) to authenticated;
revoke all on function public.lv_delivery_challans(uuid) from public, anon;
grant execute on function public.lv_delivery_challans(uuid) to authenticated;
