-- 0786 · PROCESS DC — job work sent out against a Process Order (doc/stores/dc-plan.md
-- Phase 2, user 2026-10-31: "a Process DC always needs a Process Order first").
--
-- THE PROCESS ORDER IS THE COMMERCIAL ORDER (vendor, process, rate, RE / IWO, expected
-- date); a Process DC is the goods leaving against it. `delivery_challans.process_order_id`
-- links the two and `dc_line_items.process_order_line_id` ties each line to the order line,
-- so what has gone out is always the sum of the dispatched DC lines — never a typed figure.
--
-- `process_dc_dispatch` (SECURITY DEFINER, all or nothing) checks the order is issued and
-- open, refuses a line beyond the order line's balance, and moves each line from its store
-- into the unit's PROCESSING store ("at vendor") as a transfer pair — the stock stays on
-- the books, it is not consumed (the rule 0447 set for DCs). The DC then reads `issued`,
-- the status the existing return path already understands.
--
-- ALSO:
--   * process_orders.vendor_id now points at MASTER vendors. It pointed at the legacy
--     `vendors` table, so no current vendor could be saved on a process order (the bug
--     0445 fixed for DCs and 0777 for GRNs). The table holds no rows: nothing to re-key.
--   * process_orders.allowed_loss_pct — the user's soft limit (Phase 3 warns past it).
--   * process_order_lines.output_item_id — what comes BACK (grey out, dyed back; Phase 3).
--   * A Process DC is Stores work as well as Purchase's: its policies accept either key.

-- ---------- the process order ----------
alter table public.process_orders drop constraint if exists process_orders_vendor_id_fkey;
alter table public.process_orders
  add constraint process_orders_vendor_id_fkey foreign key (vendor_id) references public.master_vendors(id);
alter table public.process_orders
  add column if not exists allowed_loss_pct numeric check (allowed_loss_pct is null or (allowed_loss_pct >= 0 and allowed_loss_pct < 100));
alter table public.process_order_lines
  add column if not exists output_item_id uuid references public.items(id);

-- ---------- the DC ----------
alter table public.delivery_challans
  add column if not exists process_order_id uuid references public.process_orders(id),
  add column if not exists process_type text,
  add column if not exists expected_return_date date;
create index if not exists idx_delivery_challans_process_order on public.delivery_challans(process_order_id);

alter table public.dc_line_items
  add column if not exists process_order_line_id uuid references public.process_order_lines(id);
create index if not exists idx_dc_line_items_po_line on public.dc_line_items(process_order_line_id);

-- ---------- RLS: a Process DC answers to Purchase OR Stores ----------
drop policy if exists delivery_challans_read on public.delivery_challans;
create policy delivery_challans_read on public.delivery_challans for select to authenticated
  using (
    (dc_kind = 'process' and (public.has_permission('materials_purchase', 'view') or public.has_permission('stores', 'view'))
     and public.is_current_location(location_id))
    or (dc_kind = 'production' and public.has_permission('stores', 'view')
        and (public.is_current_location(location_id) or public.is_current_location(to_location_id)))
  );
drop policy if exists delivery_challans_insert on public.delivery_challans;
create policy delivery_challans_insert on public.delivery_challans for insert to authenticated
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'create') or public.has_permission('stores', 'create')))
         or (dc_kind = 'production' and public.has_permission('stores', 'create')))
  );
drop policy if exists delivery_challans_update on public.delivery_challans;
create policy delivery_challans_update on public.delivery_challans for update to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit')))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft'))
  )
  with check (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'edit') or public.has_permission('stores', 'edit')))
         or (dc_kind = 'production' and public.has_permission('stores', 'edit') and status = 'draft'))
  );
drop policy if exists delivery_challans_delete on public.delivery_challans;
create policy delivery_challans_delete on public.delivery_challans for delete to authenticated
  using (
    public.is_current_location(location_id)
    and ((dc_kind = 'process' and (public.has_permission('materials_purchase', 'delete')
                                   or (status = 'draft' and public.has_permission('stores', 'edit'))))
         or (dc_kind = 'production' and status = 'draft'
             and (public.has_permission('stores', 'delete') or public.has_permission('stores', 'edit'))))
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
                     or (p_action = 'delete' and public.has_permission('stores', 'edit'))))))
$$;

-- ---------- dispatch ----------
create or replace function public.process_dc_dispatch(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  o record;
  l record;
  v_proc uuid;
  v_ordered numeric;
  v_sent numeric;
  v_n integer := 0;
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'process' then
    raise exception 'Process DC not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to dispatch a Process DC' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'A Process DC is dispatched by the unit it was raised in — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'This DC has already been dispatched' using errcode = 'P0001';
  end if;
  if d.process_order_id is null then
    raise exception 'A Process DC goes out against a Process Order — pick one' using errcode = 'P0001';
  end if;
  select * into o from public.process_orders where id = d.process_order_id for update;
  if o.status not in ('issued', 'in_process', 'partially_received') then
    raise exception 'Process Order % is %, not open for dispatch — issue it first', coalesce(o.code, ''), o.status
      using errcode = 'P0001';
  end if;
  if o.vendor_id is distinct from d.vendor_id then
    raise exception 'The DC must go to the Process Order''s vendor' using errcode = 'P0001';
  end if;

  select id into v_proc from public.stores
   where location_id = d.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store — set one up under Stores first' using errcode = 'P0001';
  end if;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    if l.item_id is null or coalesce(l.sent_qty, 0) <= 0 then
      raise exception 'Every line needs an item and a qty' using errcode = 'P0001';
    end if;
    if l.process_order_line_id is null then
      raise exception '%: not a line of the Process Order', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    select sent_qty into v_ordered from public.process_order_lines
     where id = l.process_order_line_id and process_order_id = d.process_order_id;
    if v_ordered is null then
      raise exception '%: not a line of the Process Order', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    -- What has already gone out on this order line, on other dispatched DCs.
    select coalesce(sum(x.sent_qty), 0) into v_sent
      from public.dc_line_items x
      join public.delivery_challans y on y.id = x.delivery_challan_id
     where x.process_order_line_id = l.process_order_line_id
       and y.id <> p_dc_id
       and y.status not in ('draft', 'cancelled');
    if l.sent_qty > v_ordered - v_sent + 0.0005 then
      raise exception '%: only % is left to send on the Process Order', coalesce(l.description, 'A line'), v_ordered - v_sent
        using errcode = 'P0001';
    end if;
    if l.from_store_id is null or not exists (
      select 1 from public.stores s where s.id = l.from_store_id and s.location_id = d.location_id and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick a store of this unit to send from', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
       reference_type, reference_id, note)
    values
      (l.from_store_id, l.bin_id, l.item_id, 'transfer_out', l.sent_qty, v_proc, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'Sent for ' || coalesce(o.process_type, 'processing') || ' on ' || coalesce(d.code, '')),
      (v_proc, null, l.item_id, 'transfer_in', l.sent_qty, l.from_store_id, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'At processor on ' || coalesce(d.code, ''));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'A Process DC needs at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans
     set status = 'issued', dispatched_at = now(), dispatched_by = auth.uid(), stock_posted_at = now()
   where id = p_dc_id;
  update public.process_orders set status = 'in_process' where id = o.id and status = 'issued';
end;
$$;

revoke all on function public.process_dc_dispatch(uuid) from public, anon;
grant execute on function public.process_dc_dispatch(uuid) to authenticated;
revoke all on function public.dc_line_writable(uuid, text) from public, anon;
grant execute on function public.dc_line_writable(uuid, text) to authenticated;
