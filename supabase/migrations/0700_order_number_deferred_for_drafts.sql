-- 0700 — A DRAFT ORDER DOES NOT TAKE AN RE No (user 2026-10-09).
--
-- Order Entry auto-saves half-finished work as a draft (2026-10-08), and the
-- first write of a new order inserts its `sales_orders` shell — which is where
-- `assign_order_number()` (0395) stamps the RE No. So a draft parked at RE 5
-- pushed the next order that was actually SAVED to RE 6, and a draft that was
-- later deleted left a hole. The user's rule: the number belongs to the order
-- that is recorded, in the order they are recorded.
--
-- THE SHELL IS STILL CREATED, unnumbered. It is what carries the draft's unit
-- (`has_order_access` reads `sales_orders.location_id`, and a NULL
-- `sales_order_id` there means "visible to every unit"), so dropping the shell
-- would have leaked every draft across units. Only the NUMBER waits.
--
-- `number_deferred = true` on insert skips numbering; clearing it (the first
-- real Save) numbers the row then, through the same function, so the format,
-- the per-unit counter and the fiscal-year rule still have one authority.
-- `next_sales_order_serial` counts numbers IN USE, so an unnumbered draft holds
-- nothing back.

alter table public.sales_orders
  add column if not exists number_deferred boolean not null default false;

comment on column public.sales_orders.number_deferred is
  'True while the order is a draft: no RE No yet. Cleared by the first real save, which numbers it (0700).';

create or replace function public.assign_order_number()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  -- 0700: a draft waits for its number; an UPDATE numbers only the moment the
  -- deferral is lifted, and never re-numbers a row that already has one.
  if new.number_deferred then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.number_deferred is not true then
    return new;
  end if;

  if new.order_number is not null and new.order_number <> '' then
    return new;
  end if;

  -- Refuse rather than invent a bucket. A shared fallback would collide with
  -- itself the moment a second location-less order was raised.
  if new.location_id is null then
    raise exception
      'An order needs a Location before it can be numbered — the SC No counts '
      'per location and restarts each April.'
      using errcode = '23502';
  end if;

  select l.code into v_loc
    from public.locations l
   where l.id = new.location_id;

  if v_loc is null or v_loc = '' then
    raise exception
      'Location % has no code, so it cannot start an SC No.', new.location_id
      using errcode = '23502';
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.order_date, current_date));

  -- Serialise the read-then-allocate per (document, location, year). Released
  -- on commit; two operators saving at once queue rather than collide.
  perform pg_advisory_xact_lock(
    hashtext('sales_order_no'),
    hashtext(new.location_id::text || v_fy)
  );

  v_next := public.next_sales_order_serial(new.location_id, v_fy);

  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, v_next)
  on conflict (location_id, fy) do update
    set last_no = excluded.last_no;

  new.order_number := public.sales_order_no_format(v_loc, v_fy, v_next);
  return new;
end;
$function$;

drop trigger if exists trg_so_code_on_record on public.sales_orders;
create trigger trg_so_code_on_record
  before update of number_deferred on public.sales_orders
  for each row
  when (old.number_deferred and not new.number_deferred)
  execute function public.assign_order_number();

-- `UPDATE OF order_number` fires only when the column is in the SET list, and
-- here a BEFORE trigger writes it — so the channel's RE No would never follow.
-- Any update that changes the number re-syncs it instead.
drop trigger if exists trg_soc_resync_re_number on public.sales_orders;
create trigger trg_soc_resync_re_number
  after update on public.sales_orders
  for each row
  when (new.order_number is distinct from old.order_number)
  execute function public.resync_order_channel_re_number();
