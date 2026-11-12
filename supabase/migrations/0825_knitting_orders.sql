-- 0825 · KNITTING ORDERS — Knitting Hub Phase 1 (doc/process/knitting-plan.md, user 2026-11-11).
--
-- A KNITTING ORDER IS A PROCESS ORDER OF TYPE knitting (plan §1), not a fourth job-work
-- path. Its Process DC, the stock moving "at vendor", the loss limit, the draft bill and the
-- Stock at Vendor / Process Loss reports all already work for a process order. What a
-- knitting order adds is two child tables:
--
--   process_order_knit_fabrics  one row per FABRIC × DIA × width form (the Tab 1 grid) —
--                               the cloth that comes back, its construction (GSM, Dia,
--                               Gauge, Loop Length, Ply), the programmed kg and the rate.
--   process_order_knit_yarns    one row per fabric × YARN (the explosion) — blend %,
--                               allowance %, required kg, bag weight. EACH ROW IS ALSO A
--                               process_order_lines ROW (item = the yarn, output = the
--                               fabric), so Process DC's own balance check works unchanged.
--
-- THE +1 BAG RULE (D2, user: refuse beyond it). The order line's `sent_qty` — the most a
-- Process DC may send on it (process_dc_dispatch, 0786) — is the required kg ROUNDED UP TO
-- WHOLE BAGS when a bag weight is given: ceil(required ÷ bag) × bag. So a store keeper can
-- send the last sealed bag, and the dispatch refuses anything past it with no new code.
--
-- KO NUMBER (D4): a knitting process order is numbered KO/<fy>/<n> (KO/26-27/0001), the
-- year tag computed the way 0624 computes REV numbers. Every other process type keeps PROC-.
--
-- `knitting_order_save(id, payload)` is the ONE writer of a knitting order's lines: header,
-- fabrics, yarns and the matching order lines in one transaction. SECURITY DEFINER because
-- the save deletes and re-inserts lines, and the lines' delete policy asks `stores:delete`
-- — an edit-only keeper's delete would come back as 0 rows and the insert would double
-- every line (the 0678 trap). The permission and the unit are checked here instead.
--
-- ALSO: dc_line_items gains `bags` + `bag_weight_kg` (Phase 2's Yarn DC counts bags).

-- ---------------------------------------------------------------------------
-- 1. KO numbering
-- ---------------------------------------------------------------------------
create or replace function public.next_knitting_order_no()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  with fy as (
    select case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
                then extract(year from (now() at time zone 'Asia/Kolkata'))::int
                else extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1
           end as y
  ),
  yy as (
    select to_char(y % 100, 'FM00') || '-' || to_char((y + 1) % 100, 'FM00') as tag from fy
  )
  select 'KO/' || yy.tag || '/'
         || to_char(coalesce(max(substring(p.code from '(\d+)$')::int), 0) + 1, 'FM0000')
    from yy
    left join public.process_orders p on p.code like 'KO/' || yy.tag || '/%'
   group by yy.tag;
$$;
revoke all on function public.next_knitting_order_no() from public, anon;
grant execute on function public.next_knitting_order_no() to authenticated;

create or replace function public.process_order_ko_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.process_type = 'knitting' and (new.code is null or new.code = '') then
    -- Two saves in the same instant must not mint the same number.
    perform pg_advisory_xact_lock(hashtext('knitting_order_no'));
    new.code := public.next_knitting_order_no();
  end if;
  return new;
end;
$$;
revoke all on function public.process_order_ko_code() from public, anon;

-- Named to sort BEFORE trg_proc_code (assign_code 'PROC'), which then sees a code and
-- leaves it alone. Postgres fires same-event triggers in name order.
drop trigger if exists trg_proc_a_ko_code on public.process_orders;
create trigger trg_proc_a_ko_code before insert on public.process_orders
  for each row execute function public.process_order_ko_code();

-- ---------------------------------------------------------------------------
-- 2. The two child tables
-- ---------------------------------------------------------------------------
create table if not exists public.process_order_knit_fabrics (
  id               uuid primary key default gen_random_uuid(),
  process_order_id uuid not null references public.process_orders(id) on delete cascade,
  sno              integer not null default 0,
  fabric_item_id   uuid not null references public.items(id),
  -- The Fabric BOM slice it was programmed from (fabric | DIA | width form), so the screen
  -- can say how much of the BOM's requirement is already on a knitting order.
  source_key       text,
  width_form       text check (width_form is null or width_form in ('open_width', 'tubular')),
  knit_dia         text,
  finished_dia     text,
  gsm              numeric(10,2),
  loop_length      numeric(10,3) check (loop_length is null or loop_length > 0),
  loop_length_ref  numeric(10,3) check (loop_length_ref is null or loop_length_ref > 0),
  gauge_id         uuid references public.config_lookups(id),
  ply              text,
  programmed_kg    numeric(14,3) not null check (programmed_kg > 0),
  roll_weight_kg   numeric(10,3) check (roll_weight_kg is null or roll_weight_kg > 0),
  expected_rolls   integer generated always as (
                     case when roll_weight_kg > 0 then ceil(programmed_kg / roll_weight_kg)::integer end
                   ) stored,
  rate_per_kg      numeric(14,4) not null default 0 check (rate_per_kg >= 0),
  created_at       timestamptz not null default now()
);
create index if not exists idx_pokf_order on public.process_order_knit_fabrics(process_order_id);
create index if not exists idx_pokf_item on public.process_order_knit_fabrics(fabric_item_id);

create table if not exists public.process_order_knit_yarns (
  id                    uuid primary key default gen_random_uuid(),
  knit_fabric_id        uuid not null references public.process_order_knit_fabrics(id) on delete cascade,
  sno                   integer not null default 0,
  yarn_item_id          uuid not null references public.items(id),
  blend_pct             numeric(7,3) not null check (blend_pct > 0 and blend_pct <= 100),
  allowance_pct         numeric(6,3) not null default 0 check (allowance_pct >= 0 and allowance_pct < 100),
  required_kg           numeric(14,3) not null check (required_kg >= 0),
  bag_weight_kg         numeric(10,3) check (bag_weight_kg is null or bag_weight_kg > 0),
  required_bags         integer generated always as (
                          case when bag_weight_kg > 0 then ceil(required_kg / bag_weight_kg)::integer end
                        ) stored,
  process_order_line_id uuid references public.process_order_lines(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_poky_fabric on public.process_order_knit_yarns(knit_fabric_id);
create index if not exists idx_poky_line on public.process_order_knit_yarns(process_order_line_id);

-- A detail table follows its document (AGENTS.md "Locations"): the yarn row's owner is the
-- knit fabric, whose owner is the process order.
create or replace function public.lv_process_order_knit_fabrics(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_id is null or exists (
    select 1 from public.process_order_knit_fabrics f
      join public.process_orders x on x.id = f.process_order_id
     where f.id = p_id and public.is_current_location(x.location_id))
$$;
revoke all on function public.lv_process_order_knit_fabrics(uuid) from public, anon;
grant execute on function public.lv_process_order_knit_fabrics(uuid) to authenticated;

-- READ-ONLY to the client: written only by knitting_order_save.
alter table public.process_order_knit_fabrics enable row level security;
alter table public.process_order_knit_yarns enable row level security;
drop policy if exists process_order_knit_fabrics_read on public.process_order_knit_fabrics;
create policy process_order_knit_fabrics_read on public.process_order_knit_fabrics
  for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_process_orders(process_order_id));
drop policy if exists process_order_knit_yarns_read on public.process_order_knit_yarns;
create policy process_order_knit_yarns_read on public.process_order_knit_yarns
  for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_process_order_knit_fabrics(knit_fabric_id));

-- ---------------------------------------------------------------------------
-- 3. Bags on a DC line (Phase 2's Yarn DC)
-- ---------------------------------------------------------------------------
alter table public.dc_line_items
  add column if not exists bags integer check (bags is null or bags >= 0),
  add column if not exists bag_weight_kg numeric(10,3) check (bag_weight_kg is null or bag_weight_kg > 0);

-- ---------------------------------------------------------------------------
-- 4. The one writer
-- ---------------------------------------------------------------------------
-- payload:
--   { vendor_id, sales_order_id, order_date, expected_date, allowed_loss_pct, notes,
--     fabrics: [ { fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm,
--                  loop_length, loop_length_ref, gauge_id, ply, programmed_kg,
--                  roll_weight_kg, rate_per_kg,
--                  yarns: [ { yarn_item_id, blend_pct, allowance_pct, bag_weight_kg } ] } ] }
-- Required kg is computed HERE, never taken from the browser.
create or replace function public.knitting_order_save(p_order_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc  uuid := public.current_location();
  v_id   uuid := p_order_id;
  v_kg   uuid;
  v_row  record;
  f      jsonb;
  y      jsonb;
  v_fab  uuid;
  v_line uuid;
  v_fi   integer := 0;
  v_yi   integer;
  v_sum  numeric;
  v_prog numeric;
  v_req  numeric;
  v_bag  numeric;
  v_cap  numeric;
  v_allow numeric;
  v_name text;
  v_fname text;
  v_total numeric := 0;
  v_seen text[] := '{}';
begin
  if v_id is null then
    if not public.has_permission('stores', 'create') then
      raise exception 'You do not have permission to raise a knitting order' using errcode = '42501';
    end if;
  elsif not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to change a knitting order' using errcode = '42501';
  end if;
  if v_loc is null then
    raise exception 'Pick your working unit in the top bar first' using errcode = 'P0001';
  end if;
  if nullif(p->>'vendor_id', '') is null then
    raise exception 'Pick the knitter' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p->'fabrics', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one fabric to knit' using errcode = 'P0001';
  end if;

  select id into v_kg from public.uoms where lower(code) = 'kg' order by is_active desc limit 1;

  if v_id is null then
    insert into public.process_orders
      (vendor_id, location_id, process_type, status, sales_order_id, order_date, expected_date,
       allowed_loss_pct, notes, total_amount)
    values
      ((p->>'vendor_id')::uuid, v_loc, 'knitting', 'draft', nullif(p->>'sales_order_id', '')::uuid,
       coalesce(nullif(p->>'order_date', '')::date, current_date), nullif(p->>'expected_date', '')::date,
       nullif(p->>'allowed_loss_pct', '')::numeric, nullif(p->>'notes', ''), 0)
    returning id into v_id;
  else
    select id, status, process_type, location_id into v_row from public.process_orders where id = v_id for update;
    if v_row.id is null or v_row.process_type <> 'knitting' or not public.is_current_location(v_row.location_id) then
      raise exception 'That knitting order is not in your unit' using errcode = 'P0001';
    end if;
    if v_row.status <> 'draft' then
      raise exception 'Only a draft knitting order can be changed — this one is already issued' using errcode = 'P0001';
    end if;
    update public.process_orders set
      vendor_id        = (p->>'vendor_id')::uuid,
      sales_order_id   = nullif(p->>'sales_order_id', '')::uuid,
      order_date       = coalesce(nullif(p->>'order_date', '')::date, order_date),
      expected_date    = nullif(p->>'expected_date', '')::date,
      allowed_loss_pct = nullif(p->>'allowed_loss_pct', '')::numeric,
      notes            = nullif(p->>'notes', '')
     where id = v_id;
    -- A draft has no DC (a Process DC needs an issued order), so its lines can be rewritten.
    delete from public.process_order_knit_fabrics where process_order_id = v_id;
    delete from public.process_order_lines where process_order_id = v_id;
  end if;

  for f in select * from jsonb_array_elements(p->'fabrics') loop
    v_fi := v_fi + 1;
    v_prog := nullif(f->>'programmed_kg', '')::numeric;
    select name into v_fname from public.items where id = nullif(f->>'fabric_item_id', '')::uuid;
    if v_fname is null then
      raise exception 'Fabric line %: pick the fabric', v_fi using errcode = 'P0001';
    end if;
    if v_prog is null or v_prog <= 0 then
      raise exception '%: enter the Program Qty (kg)', v_fname using errcode = 'P0001';
    end if;
    if coalesce(f->>'source_key', '') <> '' then
      if f->>'source_key' = any (v_seen) then
        raise exception '% is on this knitting order twice at the same dia', v_fname using errcode = 'P0001';
      end if;
      v_seen := v_seen || (f->>'source_key');
    end if;
    if jsonb_array_length(coalesce(f->'yarns', '[]'::jsonb)) = 0 then
      raise exception '%: no yarns — its fabric master has no composition', v_fname using errcode = 'P0001';
    end if;
    select coalesce(sum(nullif(x->>'blend_pct', '')::numeric), 0) into v_sum
      from jsonb_array_elements(f->'yarns') x;
    if abs(v_sum - 100) > 0.01 then
      raise exception '%: the yarn blend adds up to % %%, not 100 %%', v_fname, round(v_sum, 3) using errcode = 'P0001';
    end if;

    insert into public.process_order_knit_fabrics
      (process_order_id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm,
       loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, rate_per_kg)
    values
      (v_id, v_fi, (f->>'fabric_item_id')::uuid, nullif(f->>'source_key', ''),
       nullif(f->>'width_form', ''), nullif(trim(f->>'knit_dia'), ''), nullif(trim(f->>'finished_dia'), ''),
       nullif(f->>'gsm', '')::numeric, nullif(f->>'loop_length', '')::numeric,
       nullif(f->>'loop_length_ref', '')::numeric, nullif(f->>'gauge_id', '')::uuid,
       nullif(trim(f->>'ply'), ''), v_prog, nullif(f->>'roll_weight_kg', '')::numeric,
       coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0))
    returning id into v_fab;
    v_total := v_total + v_prog * coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0);

    v_yi := 0;
    for y in select * from jsonb_array_elements(f->'yarns') loop
      v_yi := v_yi + 1;
      select name into v_name from public.items where id = nullif(y->>'yarn_item_id', '')::uuid;
      if v_name is null then
        raise exception '%: yarn line % names no yarn', v_fname, v_yi using errcode = 'P0001';
      end if;
      v_allow := coalesce(nullif(y->>'allowance_pct', '')::numeric, 0);
      v_bag   := nullif(y->>'bag_weight_kg', '')::numeric;
      v_req   := round(v_prog * (y->>'blend_pct')::numeric / 100 * (1 + v_allow / 100), 3);
      v_cap   := case when v_bag > 0 then ceil(v_req / v_bag) * v_bag else v_req end;

      insert into public.process_order_lines
        (process_order_id, item_id, description, sent_qty, received_qty, uom_id, rate, amount,
         sort_order, output_item_id)
      values
        (v_id, (y->>'yarn_item_id')::uuid, v_name || ' — for ' || v_fname, v_cap, 0, v_kg, 0, 0,
         v_fi * 100 + v_yi, (f->>'fabric_item_id')::uuid)
      returning id into v_line;

      insert into public.process_order_knit_yarns
        (knit_fabric_id, sno, yarn_item_id, blend_pct, allowance_pct, required_kg, bag_weight_kg,
         process_order_line_id)
      values
        (v_fab, v_yi, (y->>'yarn_item_id')::uuid, (y->>'blend_pct')::numeric, v_allow, v_req, v_bag, v_line);
    end loop;
  end loop;

  update public.process_orders set total_amount = round(v_total, 2) where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.knitting_order_save(uuid, jsonb) from public, anon;
grant execute on function public.knitting_order_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if public.next_knitting_order_no() not like 'KO/__-__/____' then
    raise exception '0825: next_knitting_order_no() did not mint a KO number: %', public.next_knitting_order_no();
  end if;
end $$;
