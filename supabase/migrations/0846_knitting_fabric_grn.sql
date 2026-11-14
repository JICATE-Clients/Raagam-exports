-- 0846 · MULTI-ORDER FABRIC RECEIPT (GRN) + CLOSE & COMPLETION — Session 3 (2026-11-14).
--
-- The knitter brings rolls for SEVERAL Knitting Orders on one of their DCs. One GRN header —
-- GRN No, GRN Date, Knitter, Knitter DC No / Date, Vehicle, the Category the screen was
-- filtered by — over one `knitting_receipts` row PER ORDER.
--
-- WHY A HEADER ABOVE THE RECEIPTS, NOT A MULTI-ORDER RECEIPT. Everything a receipt does is per
-- order: the yarn drawn by blend % off THAT order's DC lines, the draft payable, the order's
-- status, the delete that reverses it (0839), the analysis. So `knitting_receipt_post` is called
-- once per order, unchanged — it is NOT re-created here (0836 / 0838 patched it in place; a
-- re-create from an old body is how a guard gets lost).
--
-- NUMBERING (D4 kept: one PRC register). The GRN takes the next PRC number; its receipts take
-- that number too — `PRC-0015` when the GRN has one order, `PRC-0015/1`, `/2` … when several.
-- `knitting_grn_post` announces the GRN through two transaction-local settings and the
-- trigger `trg_krc_a_grn` (sorts BEFORE `trg_krc_code`, so `assign_code` sees a code and stands
-- down) stamps `grn_id` and the code. Outside a GRN post the settings are empty and nothing
-- changes.
--
-- CLOSE & COMPLETION. Ticked, every order on the GRN closes after its fabric posts, through the
-- existing `knitting_order_close` (balance written off, reason required when one is left) — in
-- the SAME transaction, so a close that fails un-posts the whole GRN rather than leaving it half.
--
-- WEIGHT. The screen now asks one Weight (kg), saved as `net_kg`. `gross_kg` is NOT dropped:
-- posted receipts hold values in it, and dropping a column of history is not a screen change.
-- New rows simply leave it null.

create table if not exists public.knitting_grns (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  location_id     uuid not null references public.locations(id),
  vendor_id       uuid not null references public.master_vendors(id),
  receipt_date    date not null default current_date,
  vendor_dc_no    text,
  vendor_dc_date  date,
  vehicle_no      text,
  category_id     uuid references public.categories(id),
  force_close     boolean not null default false,
  close_reason    text,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_kgrn_vendor on public.knitting_grns(vendor_id);
drop trigger if exists trg_kgrn_code on public.knitting_grns;
create trigger trg_kgrn_code before insert on public.knitting_grns
  for each row execute function public.assign_code('PRC', 'public.seq_dc_receipt');

alter table public.knitting_receipts
  add column if not exists grn_id uuid references public.knitting_grns(id) on delete set null;
create index if not exists idx_krc_grn on public.knitting_receipts(grn_id);

-- Read-only to the client, like the receipts (written only by knitting_grn_post).
alter table public.knitting_grns enable row level security;
drop policy if exists knitting_grns_read on public.knitting_grns;
create policy knitting_grns_read on public.knitting_grns for select to authenticated
  using (public.has_permission('stores', 'view') and public.is_current_location(location_id));

-- ---------------------------------------------------------------------------
-- The receipt under a GRN takes the GRN's number.
-- ---------------------------------------------------------------------------
create or replace function public.knitting_receipt_take_grn()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_grn  uuid := nullif(current_setting('app.knit_grn_id', true), '')::uuid;
  v_code text;
  v_n    integer;
begin
  if v_grn is null or new.code is not null then
    return new;
  end if;
  select code into v_code from public.knitting_grns where id = v_grn;
  new.grn_id := v_grn;
  if coalesce(current_setting('app.knit_grn_multi', true), '') = 'on' then
    select count(*) + 1 into v_n from public.knitting_receipts where grn_id = v_grn;
    new.code := v_code || '/' || v_n;
  else
    new.code := v_code;
  end if;
  return new;
end;
$$;
revoke all on function public.knitting_receipt_take_grn() from public, anon;

drop trigger if exists trg_krc_a_grn on public.knitting_receipts;
create trigger trg_krc_a_grn before insert on public.knitting_receipts
  for each row execute function public.knitting_receipt_take_grn();

-- ---------------------------------------------------------------------------
-- knitting_grn_post(header, orders, close, reason) → the GRN id.
--   header: { receipt_date, vendor_id, vendor_dc_no, vendor_dc_date, vehicle_no, category_id }
--   orders: [{ order_id, fabrics: [ … knitting_receipt_post's fabric lines … ] }]
-- An order with no fabric line posts nothing; it is still closed when p_close is set.
-- ---------------------------------------------------------------------------
create or replace function public.knitting_grn_post(p_header jsonb, p_orders jsonb, p_close boolean, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vendor uuid := nullif(p_header->>'vendor_id', '')::uuid;
  v_loc    uuid;
  v_grn    uuid;
  v_ids    uuid[];
  v_posting integer;
  v_lines  integer := 0;
  r        jsonb;
  o        record;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to receive knitted fabric' using errcode = '42501';
  end if;
  if v_vendor is null then
    raise exception 'Pick the knitter' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_orders, '[]'::jsonb)) = 0 then
    raise exception 'Pick the knitting orders this fabric came for' using errcode = 'P0001';
  end if;

  select array_agg(distinct (e->>'order_id')::uuid) into v_ids from jsonb_array_elements(p_orders) e;
  for o in select id, code, vendor_id, location_id, process_type from public.process_orders where id = any(v_ids) loop
    if o.process_type <> 'knitting' then
      raise exception 'Knitting order not found' using errcode = 'P0002';
    end if;
    if o.vendor_id <> v_vendor then
      raise exception 'Knitting order % belongs to another knitter — one GRN is one knitter''s DC', coalesce(o.code, '') using errcode = 'P0001';
    end if;
    if v_loc is not null and o.location_id <> v_loc then
      raise exception 'The knitting orders on one GRN must be of one unit' using errcode = 'P0001';
    end if;
    v_loc := o.location_id;
  end loop;
  if v_loc is null or cardinality(v_ids) <> (select count(*) from public.process_orders where id = any(v_ids)) then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(v_loc) then
    raise exception 'A knitting order is received in the unit that raised it — switch unit in the top bar' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(jsonb_array_length(coalesce(e->'fabrics', '[]'::jsonb))), 0)
    into v_posting, v_lines
    from jsonb_array_elements(p_orders) e
   where jsonb_array_length(coalesce(e->'fabrics', '[]'::jsonb)) > 0;
  if v_lines = 0 then
    raise exception 'Enter the weight received for at least one fabric' using errcode = 'P0001';
  end if;

  insert into public.knitting_grns (location_id, vendor_id, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, category_id, force_close, close_reason)
  values (v_loc, v_vendor, coalesce(nullif(p_header->>'receipt_date', '')::date, current_date),
          nullif(upper(btrim(coalesce(p_header->>'vendor_dc_no', ''))), ''),
          nullif(p_header->>'vendor_dc_date', '')::date,
          nullif(upper(btrim(coalesce(p_header->>'vehicle_no', ''))), ''),
          nullif(p_header->>'category_id', '')::uuid,
          coalesce(p_close, false),
          case when p_close then nullif(upper(btrim(coalesce(p_reason, ''))), '') end)
  returning id into v_grn;

  perform set_config('app.knit_grn_id', v_grn::text, true);
  perform set_config('app.knit_grn_multi', case when v_posting > 1 then 'on' else 'off' end, true);

  for r in select * from jsonb_array_elements(p_orders) loop
    continue when jsonb_array_length(coalesce(r->'fabrics', '[]'::jsonb)) = 0;
    perform public.knitting_receipt_post((r->>'order_id')::uuid, p_header, r->'fabrics', '[]'::jsonb);
  end loop;

  perform set_config('app.knit_grn_id', '', true);
  perform set_config('app.knit_grn_multi', '', true);

  if p_close then
    for r in select * from jsonb_array_elements(p_orders) loop
      perform public.knitting_order_close((r->>'order_id')::uuid, p_reason);
    end loop;
  end if;

  return v_grn;
end;
$$;
revoke all on function public.knitting_grn_post(jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.knitting_grn_post(jsonb, jsonb, boolean, text) to authenticated;
