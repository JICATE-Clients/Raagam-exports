-- 0797 · DELIVERY RETURN — a RETURNABLE General DC (0796) coming back (user 2026-11-02,
-- Purchase ▸ Purchase Store ▸ Delivery Return): the same item, no loss, no bill. That is what
-- makes it its own document and not a Process Receipt (0787), which is a different item back
-- with a loss and a draft payable.
--
-- `dc_returns` (DRN/…) + `dc_return_lines`, written ONLY by `dc_return_post` — there are no
-- insert / update / delete policies, so a half-written return cannot exist.
--
-- `dc_return_post(dc_id, lines jsonb, header jsonb)` — SECURITY DEFINER, all or nothing:
--   * the DC must be General, returnable, issued / partially_returned, of the current unit;
--   * each line is capped at sent − returned − written off;
--   * a stock line TRANSFERS out of the unit's Processing store ("at party", where 0796 put
--     it) into the store / bin the keeper picks — a store of this unit, never Transit or
--     Processing (reference_type 'dc_return'); a free-text line moves no stock;
--   * Close balance writes off what is still out on that line: `adjust_out` from the
--     Processing store with the MANDATORY reason, recorded on the DC line as
--     `shortage_qty` / `shortage_reason` (the register's "outstanding" already subtracts it);
--   * the DC reads `partially_returned`, or `closed` once nothing is out.

-- THE FLAG IS `is_returnable` (planners' final agreement, 2026-11-02). 0796 was first applied
-- live with the column named `returnable`; this renames it where that happened and is a no-op
-- on a fresh replay (0796's file now creates `is_returnable` directly). The live rename and
-- the two function bodies below were applied as `0797_dc_returns_is_returnable`.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'delivery_challans' and column_name = 'returnable') then
    alter table public.delivery_challans rename column returnable to is_returnable;
  end if;
end $$;
comment on column public.delivery_challans.is_returnable is 'General DC (0796): true = the goods come back (Delivery Return, 0797); false = they leave for good.';

create sequence if not exists public.seq_dc_return;

create table if not exists public.dc_returns (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  delivery_challan_id uuid not null references public.delivery_challans(id),
  location_id uuid not null default public.current_location() references public.locations(id),
  return_date date not null default current_date,
  party_dc_no text,
  notes text,
  status text not null default 'posted' check (status in ('draft', 'posted', 'cancelled')),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_dc_returns_dc on public.dc_returns(delivery_challan_id);
create index if not exists idx_dc_returns_location on public.dc_returns(location_id);
drop trigger if exists trg_dc_return_code on public.dc_returns;
create trigger trg_dc_return_code before insert on public.dc_returns
  for each row execute function public.assign_code('DRN', 'public.seq_dc_return');

create table if not exists public.dc_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.dc_returns(id) on delete cascade,
  dc_line_id uuid not null references public.dc_line_items(id),
  item_id uuid references public.items(id),
  returned_qty numeric not null default 0 check (returned_qty >= 0),
  close_balance boolean not null default false,
  closed_qty numeric not null default 0 check (closed_qty >= 0),
  close_reason text,
  store_id uuid references public.stores(id),
  bin_id uuid references public.bins(id),
  lot_no text,
  sort_order integer not null default 0,
  check (returned_qty > 0 or closed_qty > 0),
  check (not close_balance or closed_qty = 0 or nullif(btrim(coalesce(close_reason, '')), '') is not null)
);
create index if not exists idx_dc_return_lines_return on public.dc_return_lines(return_id);
create index if not exists idx_dc_return_lines_dc_line on public.dc_return_lines(dc_line_id);

-- Read-only to the screen (0787's shape); lines follow their return's unit.
alter table public.dc_returns enable row level security;
alter table public.dc_return_lines enable row level security;
drop policy if exists dc_returns_read on public.dc_returns;
create policy dc_returns_read on public.dc_returns for select to authenticated
  using ((public.has_permission('stores', 'view') or public.has_permission('materials_purchase', 'view'))
         and public.is_current_location(location_id));
drop policy if exists dc_return_lines_read on public.dc_return_lines;
create policy dc_return_lines_read on public.dc_return_lines for select to authenticated
  using ((public.has_permission('stores', 'view') or public.has_permission('materials_purchase', 'view'))
         and exists (select 1 from public.dc_returns r where r.id = return_id and public.is_current_location(r.location_id)));

-- p_lines:  [{ dc_line_id, returned_qty, close_balance, close_reason, store_id, bin_id, lot_no }]
-- p_header: { return_date, party_dc_no, notes }
create or replace function public.dc_return_post(p_dc_id uuid, p_lines jsonb, p_header jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  l record;
  j jsonb;
  v_proc uuid;
  v_return uuid;
  v_date date;
  v_left numeric;
  v_ret numeric;
  v_close boolean;
  v_rest numeric;
  v_reason text;
  v_store uuid;
  v_bin uuid;
  v_lot text;
  v_n integer := 0;
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'general' then
    raise exception 'General DC not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to receive a delivery back' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'Goods come back to the unit that sent them — switch unit in the top bar' using errcode = '42501';
  end if;
  if not d.is_returnable then
    raise exception 'DC % is non-returnable — nothing is due back on it', coalesce(d.code, '') using errcode = 'P0001';
  end if;
  if d.status not in ('issued', 'partially_returned') then
    raise exception 'DC % is %, not out with the party', coalesce(d.code, ''), d.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'No lines to return' using errcode = 'P0001';
  end if;

  select id into v_proc from public.stores
   where location_id = d.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store — set one up under Stores first' using errcode = 'P0001';
  end if;

  v_date := coalesce(nullif(p_header->>'return_date', '')::date, current_date);
  insert into public.dc_returns (delivery_challan_id, location_id, return_date, party_dc_no, notes, status)
  values (p_dc_id, d.location_id, v_date,
          nullif(upper(btrim(coalesce(p_header->>'party_dc_no', ''))), ''),
          nullif(upper(btrim(coalesce(p_header->>'notes', ''))), ''), 'posted')
  returning id into v_return;

  for j in select * from jsonb_array_elements(p_lines) loop
    select * into l from public.dc_line_items
     where id = nullif(j->>'dc_line_id', '')::uuid and delivery_challan_id = p_dc_id for update;
    if not found then
      raise exception 'A line does not belong to DC %', coalesce(d.code, '') using errcode = 'P0001';
    end if;
    v_ret := coalesce(nullif(j->>'returned_qty', '')::numeric, 0);
    v_close := coalesce((j->>'close_balance')::boolean, false);
    v_left := coalesce(l.sent_qty, 0) - coalesce(l.returned_qty, 0) - coalesce(l.shortage_qty, 0);
    if v_ret < 0 then
      raise exception '%: returned qty cannot be negative', l.description using errcode = 'P0001';
    end if;
    if v_ret > v_left + 0.0005 then
      raise exception '%: only % is still out with the party', l.description, v_left using errcode = 'P0001';
    end if;
    continue when v_ret = 0 and not v_close;

    v_rest := case when v_close then greatest(v_left - v_ret, 0) else 0 end;
    v_reason := nullif(upper(btrim(coalesce(j->>'close_reason', ''))), '');
    if v_rest > 0 and v_reason is null then
      raise exception '%: say why the balance of % will not come back', l.description, v_rest using errcode = 'P0001';
    end if;
    continue when v_ret = 0 and v_rest = 0;

    v_store := nullif(j->>'store_id', '')::uuid;
    v_bin := nullif(j->>'bin_id', '')::uuid;
    v_lot := coalesce(nullif(upper(btrim(coalesce(j->>'lot_no', ''))), ''), nullif(upper(btrim(coalesce(l.lot_no, ''))), ''));

    if l.item_id is not null and v_ret > 0 then
      if v_store is null or not exists (
        select 1 from public.stores s where s.id = v_store and s.location_id = d.location_id
           and s.store_type not in ('transit', 'processing')) then
        raise exception '%: pick a store of this unit to take it back into', l.description using errcode = 'P0001';
      end if;
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
         reference_type, reference_id, lot_no, note)
      values
        (v_proc, null, l.item_id, 'transfer_out', v_ret, v_store, v_date, d.location_id,
         'dc_return', v_return, v_lot, 'Back from party on ' || coalesce(d.code, '')),
        (v_store, v_bin, l.item_id, 'transfer_in', v_ret, v_proc, v_date, d.location_id,
         'dc_return', v_return, v_lot, 'Returned on ' || coalesce(d.code, ''));
    end if;
    if l.item_id is not null and v_rest > 0 then
      insert into public.stock_ledger
        (store_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id, lot_no, note)
      values
        (v_proc, l.item_id, 'adjust_out', v_rest, v_date, d.location_id, 'dc_return', v_return, v_lot,
         'Not coming back on ' || coalesce(d.code, '') || ' — ' || v_reason);
    end if;

    insert into public.dc_return_lines
      (return_id, dc_line_id, item_id, returned_qty, close_balance, closed_qty, close_reason, store_id, bin_id, lot_no, sort_order)
    values
      (v_return, l.id, l.item_id, v_ret, v_close, v_rest, case when v_rest > 0 then v_reason end,
       case when v_ret > 0 then v_store end, case when v_ret > 0 then v_bin end, v_lot, v_n);

    update public.dc_line_items
       set returned_qty = coalesce(returned_qty, 0) + v_ret,
           returned_on = case when v_ret > 0 then v_date else returned_on end,
           shortage_qty = coalesce(shortage_qty, 0) + v_rest,
           shortage_reason = case when v_rest > 0 then concat_ws('; ', shortage_reason, v_reason) else shortage_reason end
     where id = l.id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Enter what came back on at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans dc
     set status = case when not exists (
                         select 1 from public.dc_line_items x
                          where x.delivery_challan_id = dc.id
                            and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) < coalesce(x.sent_qty, 0) - 0.0005)
                       then 'closed' else 'partially_returned' end,
         received_at = now(), received_by = auth.uid()
   where dc.id = p_dc_id;

  return v_return;
end;
$$;

revoke all on function public.dc_return_post(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.dc_return_post(uuid, jsonb, jsonb) to authenticated;
