-- ============================================================================
-- Raagam ERP — 0620 GRN receipt UX: challan no, roll/batch, over-receipt
--                  tolerance and the Store Manager override
--
-- The Store Keeper GRN Entry spec (2026-09-23): the keeper picks a vendor, then
-- a PO, and every line of that PO lands in the grid; they type only Today Recd,
-- Shortage / Rej and the Roll / Batch No. Each line reads GREEN when received so
-- far + today equals the PO qty, AMBER when it is over but inside the approved
-- over-receipt tolerance, RED beyond it — and a RED line blocks Save until a
-- Store Manager authorises it.
--
-- ## WHERE THE TOLERANCE LIVES: ON THE PURCHASE ORDER
--
-- `purchase_orders.over_receipt_tolerance_pct`, default 3. Considered and
-- refused:
--   • company_profile — has NO ROWS in this database (see the report-letterhead
--     note), so a company default read from it would be a default of nothing;
--     and a setting read at receipt time changes the rules under every PO
--     already sent to a vendor.
--   • per item class — the item class is not on `po_line_items` as an FK (it is
--     a free `item_class` text column), so the lookup would be a string match
--     on a column nobody validates.
-- The tolerance is a term agreed with the vendor when the order is placed, so
-- it belongs on the order and is frozen with it — the same reason a run
-- freezes its approval steps (0601). A PO raised before this migration takes
-- the 3% default, which is the spec's own example.
--
-- ## WHAT "RECEIVED" MEANS HERE: ACCEPTED QUANTITY
--
-- `po_line_items.received_qty` has always been the cached ACCEPTED quantity
-- (0008: "open bal = quantity - received_qty"), and postGrn increments it by
-- `accepted_qty`. So tolerance is measured the same way: received so far
-- (posted, accepted) + this GRN's accepted (Today Recd − Shortage / Rej).
-- A shortage or rejection is goods that did not enter stock against the PO;
-- counting them would turn every rejected roll into an over-receipt.
--
-- ## ENFORCED HERE, NOT ONLY ON SCREEN
--
--   1. grn_over_tolerance_lines(grn)  — the one calculation (SECURITY DEFINER,
--      so an invoker who cannot read a PO line fails CLOSED, not open).
--   2. A line trigger refuses a draft GRN line that pushes its PO line past
--      tolerance while the GRN carries no authorisation.
--   3. A GRN trigger refuses the draft → posted transition on the same test,
--      re-evaluated at post time (another GRN may have posted in between), and
--      refuses an authorisation stamped by anyone but the caller, by anyone
--      without `stores:approve`, or without a reason. `authorized_at` is set by
--      the database, never by the client.
--
-- `stores:approve` is the Store Manager key: the Manager role holds it and the
-- Store Keeper role does not (0010, 0615), and store_access is already managed
-- under it. No new permission.
-- ============================================================================

-- ---------- 1. columns ----------
alter table public.purchase_orders
  add column if not exists over_receipt_tolerance_pct numeric(5,2) not null default 3
    check (over_receipt_tolerance_pct >= 0 and over_receipt_tolerance_pct <= 100);
comment on column public.purchase_orders.over_receipt_tolerance_pct is
  'Approved over-receipt tolerance for this order, percent of each line''s ordered qty. Receipts beyond it need a Store Manager override on the GRN (0620).';

alter table public.grns
  add column if not exists challan_no text,
  add column if not exists over_receipt_authorized_by uuid references public.profiles(id),
  add column if not exists over_receipt_authorized_at timestamptz,
  add column if not exists over_receipt_reason text;
comment on column public.grns.challan_no is 'Vendor''s delivery challan / invoice number, as typed by the store keeper (0620).';
comment on column public.grns.over_receipt_authorized_by is
  'Store Manager (stores:approve) who authorised receipt beyond the PO tolerance. Stamped as the caller only; see trg_grn_over_receipt (0620).';

alter table public.grn_line_items
  add column if not exists roll_batch_no text;
comment on column public.grn_line_items.roll_batch_no is 'Roll / batch number of the goods received on this line (0620).';

-- ---------- 2. the one calculation ----------
create or replace function public.grn_over_tolerance_lines(p_grn_id uuid)
returns table (
  po_line_item_id uuid,
  ordered_qty     numeric,
  received_so_far numeric,
  this_grn_qty    numeric,
  tolerance_pct   numeric,
  allowed_qty     numeric
)
language sql
stable
security definer
set search_path to ''
as $$
  with mine as (
    select gli.po_line_item_id, sum(greatest(gli.accepted_qty, 0)) as qty
    from public.grn_line_items gli
    where gli.grn_id = p_grn_id and gli.po_line_item_id is not null
    group by gli.po_line_item_id
  )
  select pl.id,
         pl.quantity,
         coalesce(pl.received_qty, 0),
         m.qty,
         po.over_receipt_tolerance_pct,
         round(pl.quantity * (1 + po.over_receipt_tolerance_pct / 100.0), 3)
  from mine m
  join public.po_line_items pl on pl.id = m.po_line_item_id
  join public.purchase_orders po on po.id = pl.purchase_order_id
  where coalesce(pl.received_qty, 0) + m.qty
        > round(pl.quantity * (1 + po.over_receipt_tolerance_pct / 100.0), 3);
$$;
comment on function public.grn_over_tolerance_lines(uuid) is
  'PO lines this GRN would take beyond the order''s over-receipt tolerance (accepted qty, posted receipts so far + this GRN). Empty = inside tolerance. 0620.';
revoke all on function public.grn_over_tolerance_lines(uuid) from public, anon;
grant execute on function public.grn_over_tolerance_lines(uuid) to authenticated;

-- ---------- 3. line trigger: a draft line may not go over unauthorised ----------
create or replace function public.grn_line_tolerance_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_status text;
  v_auth   uuid;
begin
  select g.status, g.over_receipt_authorized_by into v_status, v_auth
  from public.grns g where g.id = new.grn_id;
  if v_status = 'draft' and v_auth is null
     and exists (select 1 from public.grn_over_tolerance_lines(new.grn_id)
                 where po_line_item_id = new.po_line_item_id) then
    raise exception 'Receipt exceeds the PO over-receipt tolerance — a Store Manager must authorise it'
      using errcode = 'P0001', hint = 'grn_over_tolerance';
  end if;
  return new;
end;
$$;
revoke all on function public.grn_line_tolerance_guard() from public, anon;

drop trigger if exists trg_grn_line_tolerance on public.grn_line_items;
create trigger trg_grn_line_tolerance
  after insert or update of accepted_qty, po_line_item_id on public.grn_line_items
  for each row execute function public.grn_line_tolerance_guard();

-- ---------- 4. GRN trigger: who may authorise, and the post-time re-check ----------
create or replace function public.grn_over_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.over_receipt_authorized_by is not null
     and (tg_op = 'INSERT'
          or new.over_receipt_authorized_by is distinct from old.over_receipt_authorized_by) then
    -- A user session may only stamp ITSELF, and only with the Store Manager key.
    -- No session (a migration, the service role) is a trusted system writer.
    if v_uid is not null then
      if new.over_receipt_authorized_by <> v_uid then
        raise exception 'An over-receipt override can only be authorised by the signed-in user'
          using errcode = '42501';
      end if;
      if not public.has_permission('stores', 'approve', v_uid) then
        raise exception 'Only a Store Manager (stores:approve) can authorise an over-receipt'
          using errcode = '42501';
      end if;
    end if;
    if coalesce(btrim(new.over_receipt_reason), '') = '' then
      raise exception 'An over-receipt override needs a reason' using errcode = 'P0001';
    end if;
    new.over_receipt_authorized_at := now();
  elsif new.over_receipt_authorized_by is null then
    new.over_receipt_authorized_at := null;
  end if;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'posted'
     and new.over_receipt_authorized_by is null
     and exists (select 1 from public.grn_over_tolerance_lines(new.id)) then
    raise exception 'Receipt exceeds the PO over-receipt tolerance — a Store Manager must authorise it before posting'
      using errcode = 'P0001', hint = 'grn_over_tolerance';
  end if;
  return new;
end;
$$;
revoke all on function public.grn_over_receipt_guard() from public, anon;

drop trigger if exists trg_grn_over_receipt on public.grns;
create trigger trg_grn_over_receipt
  before insert or update on public.grns
  for each row execute function public.grn_over_receipt_guard();

-- ---------- 5. verify: behaviour, in a rolled-back probe ----------
do $verify$
declare
  v_vendor uuid; v_po uuid; v_pl uuid; v_grn uuid; v_grn2 uuid;
  v_keeper uuid;
  v_loc uuid := (select id from public.locations where is_default limit 1);
  v_refused boolean;
begin
  begin
    insert into public.vendors (name) values ('ZZ 0620 PROBE') returning id into v_vendor;
    insert into public.purchase_orders (vendor_id, status, location_id) values (v_vendor, 'approved', v_loc) returning id into v_po;
    insert into public.po_line_items (purchase_order_id, description, quantity, received_qty)
      values (v_po, 'PROBE LINE', 100, 0) returning id into v_pl;

    -- (a) 103 of 100 at 3% is inside tolerance → saves.
    insert into public.grns (vendor_id, status, location_id) values (v_vendor, 'draft', v_loc) returning id into v_grn;
    insert into public.grn_line_items (grn_id, po_line_item_id, purchase_order_id, description, received_qty, accepted_qty)
      values (v_grn, v_pl, v_po, 'PROBE LINE', 103, 103);

    -- (b) 104 is beyond → refused while unauthorised.
    v_refused := false;
    begin
      update public.grn_line_items set accepted_qty = 104 where grn_id = v_grn;
    exception when others then
      if sqlerrm like '%tolerance%' then v_refused := true; else raise; end if;
    end;
    if not v_refused then raise exception '0620 verify: over-tolerance line was NOT refused'; end if;

    -- (c) an authorisation needs a reason.
    v_refused := false;
    begin
      update public.grns set over_receipt_authorized_by = (select id from public.profiles limit 1) where id = v_grn;
    exception when others then
      if sqlerrm like '%needs a reason%' then v_refused := true; else raise; end if;
    end;
    if not v_refused then raise exception '0620 verify: reasonless override was NOT refused'; end if;

    -- (d) a signed-in user WITHOUT stores:approve cannot stamp an override.
    select p.id into v_keeper from public.profiles p
     where not public.has_permission('stores', 'approve', p.id) limit 1;
    if v_keeper is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_keeper, 'role', 'authenticated')::text, true);
      v_refused := false;
      begin
        update public.grns set over_receipt_authorized_by = v_keeper, over_receipt_reason = 'PROBE' where id = v_grn;
      exception when others then
        if sqlerrm like '%Store Manager%' then v_refused := true; else raise; end if;
      end;
      perform set_config('request.jwt.claims', '', true);
      if not v_refused then raise exception '0620 verify: override by a non-manager was NOT refused'; end if;
    else
      raise notice '0620 verify: no profile lacks stores:approve; permission probe skipped';
    end if;

    -- (e) the post-time re-check: inside tolerance when drafted, beyond it by
    --     the time it posts (another receipt landed first) → refused.
    update public.po_line_items set received_qty = 50 where id = v_pl;
    v_refused := false;
    begin
      update public.grns set status = 'posted' where id = v_grn;
    exception when others then
      if sqlerrm like '%tolerance%' then v_refused := true; else raise; end if;
    end;
    if not v_refused then raise exception '0620 verify: over-tolerance post was NOT refused'; end if;

    -- (f) with an authorisation (system writer, reason given) it posts, and the
    --     database stamps the time.
    update public.grns set over_receipt_authorized_by = (select id from public.profiles limit 1),
                           over_receipt_reason = 'PROBE' where id = v_grn;
    update public.grns set status = 'posted' where id = v_grn;
    if (select over_receipt_authorized_at from public.grns where id = v_grn) is null then
      raise exception '0620 verify: authorized_at was not stamped';
    end if;

    -- (g) an exact receipt on a second GRN posts with no override.
    update public.po_line_items set received_qty = 0 where id = v_pl;
    insert into public.grns (vendor_id, status, location_id) values (v_vendor, 'draft', v_loc) returning id into v_grn2;
    insert into public.grn_line_items (grn_id, po_line_item_id, purchase_order_id, description, received_qty, accepted_qty)
      values (v_grn2, v_pl, v_po, 'PROBE LINE', 100, 100);
    update public.grns set status = 'posted' where id = v_grn2;

    raise exception 'probe-rollback';
  exception when others then
    if sqlerrm <> 'probe-rollback' then raise; end if;
  end;

  -- grants: nothing new is anon-callable
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('grn_over_tolerance_lines', 'grn_line_tolerance_guard', 'grn_over_receipt_guard')
      and (has_function_privilege('anon', p.oid, 'execute'))
  ) then
    raise exception '0620 verify: a new function is executable by anon';
  end if;
end;
$verify$;
