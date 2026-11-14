-- 0847 · KNITTING — PARTIAL RE ALLOCATION + SHORT CLOSE (user 2026-11-14, screenshot 4182)
--
-- THE PROBLEM. 0835 ("one program per fabric", user 2026-11-12) locked an RE's fabric slice the
-- moment ANY placed Knitting Order held it — 1,000 kg placed of a 1,157.2 kg BOM left 157.2 kg that
-- no second KO could take ("Program Placed — KO/26-27/0001"). The user reverses that rule here:
--
--   * A slice stays pickable while its BALANCE (BOM kg − kg on placed KOs) is above zero. A second,
--     third … KO may take what is left. Program Qty may not exceed that balance — checked by the
--     save and issue actions (lib/production/knitting-actions.ts), because the BOM requirement of a
--     slice is assembled in TypeScript from the Fabric BOM (getKnitCandidates), not in SQL.
--   * SHORT CLOSE: a balance too small to knit is closed by hand, with a reason. The slice then
--     reads Fully Placed and the database refuses any new program on it — that is what
--     `knitting_fabric_placed_by` now means (it used to mean "any placed KO holds it").
--
-- `knitting_fabric_placed_by` keeps its signature, so its two callers — `knitting_order_save` and
-- the trigger `process_order_one_knit_program` — need no change.

create table if not exists public.knit_slice_short_closes (
  id               uuid primary key default gen_random_uuid(),
  sales_order_id   uuid not null references public.sales_orders(id) on delete cascade,
  -- knit_fabric_key(): the line's BOM slice key, "<fabric>|<FIN DIA>|<form>".
  slice_key        text not null,
  fabric_item_id   uuid references public.items(id),
  -- What was left unprogrammed when it was closed (for the record; the balance is not stored).
  short_closed_kg  numeric(14,3) not null check (short_closed_kg >= 0),
  reason           text not null check (btrim(reason) <> ''),
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now(),
  unique (sales_order_id, slice_key)
);
-- location-scope: exempt -- keyed on the RE, which every unit's Knitting Orders may draw on (as the Fabric BOM is).
alter table public.knit_slice_short_closes enable row level security;
drop policy if exists knit_slice_short_closes_read on public.knit_slice_short_closes;
create policy knit_slice_short_closes_read on public.knit_slice_short_closes
  for select to authenticated using (public.has_permission('stores', 'view'));
-- Written only by the two functions below.

-- ---------------------------------------------------------------------------
-- The guard — now "short-closed", not "already on a placed KO"
-- ---------------------------------------------------------------------------
create or replace function public.knitting_fabric_placed_by(p_sales_order_id uuid, p_key text, p_except uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select format('%s is short-closed for this RE (%s) — nothing more can be programmed on it',
                coalesce(i.name, 'This fabric'), sc.reason)
    from public.knit_slice_short_closes sc
    left join public.items i on i.id = sc.fabric_item_id
   where sc.sales_order_id = p_sales_order_id and sc.slice_key = p_key
   limit 1
$$;
revoke all on function public.knitting_fabric_placed_by(uuid, text, uuid) from public, anon;
grant execute on function public.knitting_fabric_placed_by(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Short close / reopen
-- ---------------------------------------------------------------------------
create or replace function public.knitting_short_close(p_sales_order_id uuid, p_slice_key text, p_fabric_item_id uuid, p_kg numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to short close a knitting balance' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the balance is short-closed' using errcode = 'P0001';
  end if;
  insert into public.knit_slice_short_closes (sales_order_id, slice_key, fabric_item_id, short_closed_kg, reason)
  values (p_sales_order_id, p_slice_key, p_fabric_item_id, greatest(coalesce(p_kg, 0), 0), btrim(p_reason))
  on conflict (sales_order_id, slice_key) do nothing;
end;
$$;
revoke all on function public.knitting_short_close(uuid, text, uuid, numeric, text) from public, anon;
grant execute on function public.knitting_short_close(uuid, text, uuid, numeric, text) to authenticated;

create or replace function public.knitting_short_close_undo(p_sales_order_id uuid, p_slice_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to reopen a knitting balance' using errcode = '42501';
  end if;
  delete from public.knit_slice_short_closes where sales_order_id = p_sales_order_id and slice_key = p_slice_key;
end;
$$;
revoke all on function public.knitting_short_close_undo(uuid, text) from public, anon;
grant execute on function public.knitting_short_close_undo(uuid, text) to authenticated;
