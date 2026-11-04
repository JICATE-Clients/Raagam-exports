-- =============================================================================
-- Raagam ERP — 0808 Vehicle & Transport: the RETURN JOURNEY
-- =============================================================================
-- User 2026-11-04: "Return Trip Required — default Yes when dispatching from an
-- internal unit. The trip follows HO → Vendor → Return to HO, with the truck only
-- becoming Available once back inside the home fence. No = one-way, the truck is
-- released on unloading at the destination."
--
-- WHAT CHANGES
--   * transport_trips.return_trip + return_place_id — decided at dispatch, fixed
--     after it (like the vehicle). return_place_id is where the truck comes home to.
--   * a new status `returning` ("On the way back") for trips AND vehicles.
--   * the state machine, per trip:
--         one-way     … en_route → unloading → completed
--         round trip  … en_route → unloading → returning → completed
--     A round trip may NOT jump unloading → completed: the truck is not free
--     until it is home, which is the whole point of the toggle.
--   * the requests are DELIVERED when the truck leaves the destination, so they
--     turn `completed` on `returning` as well as on `completed`.
--   * transport_complete_trip accepts a returning trip (costs are entered when it
--     is home) and refuses costing a round trip still at the vendor.
--
-- Every function below starts from 0766's body (the latest definition — 0767
-- and 0768 touch grants only). `create or replace` keeps 0768's revokes on the
-- trigger functions; transport_dispatch changes signature, so it is dropped and
-- re-granted here.
--
-- Tables hold 0 rows on 2026-11-04, so the new NOT NULL default is free.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and the widened status vocabularies
-- ---------------------------------------------------------------------------
alter table public.transport_trips
  add column return_trip boolean not null default false,
  add column return_place_id uuid references public.transport_places (id);

alter table public.transport_trips
  add constraint transport_trips_return_place_chk check (return_trip = (return_place_id is not null));

comment on column public.transport_trips.return_trip is
  'Round trip (0808): the vehicle comes back to return_place_id and is free only once it is home.';

alter table public.transport_trips drop constraint transport_trips_trip_status_check;
alter table public.transport_trips add constraint transport_trips_trip_status_check
  check (trip_status in ('planned', 'loading', 'en_route', 'unloading', 'returning', 'completed', 'cancelled'));

alter table public.transport_vehicles drop constraint transport_vehicles_status_check;
alter table public.transport_vehicles add constraint transport_vehicles_status_check
  check (status in ('idle', 'loading', 'en_route', 'unloading', 'returning', 'maintenance'));

alter table public.transport_trip_events drop constraint transport_trip_events_from_status_check;
alter table public.transport_trip_events add constraint transport_trip_events_from_status_check
  check (from_status in ('planned', 'loading', 'en_route', 'unloading', 'returning', 'completed', 'cancelled'));
alter table public.transport_trip_events drop constraint transport_trip_events_to_status_check;
alter table public.transport_trip_events add constraint transport_trip_events_to_status_check
  check (to_status in ('planned', 'loading', 'en_route', 'unloading', 'returning', 'completed', 'cancelled'));

-- A returning trip still holds its vehicle — one open trip per vehicle.
drop index public.transport_trips_one_open_uidx;
create unique index transport_trips_one_open_uidx on public.transport_trips (vehicle_id)
  where trip_status in ('planned', 'loading', 'en_route', 'unloading', 'returning');

-- ---------------------------------------------------------------------------
-- 2. The state machine (mirror of ALLOWED / canTransition in logic.ts)
-- ---------------------------------------------------------------------------
create or replace function public.transport_trips_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.trip_status <> 'planned' then
      raise exception 'A trip starts Planned' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.trip_status is distinct from old.trip_status then
    if not (
         (old.trip_status = 'planned'   and new.trip_status in ('loading', 'en_route', 'cancelled'))
      or (old.trip_status = 'loading'   and new.trip_status in ('en_route', 'cancelled'))
      or (old.trip_status = 'en_route'  and new.trip_status = 'unloading')
      or (old.trip_status = 'unloading' and new.trip_status = 'completed' and not old.return_trip)
      or (old.trip_status = 'unloading' and new.trip_status = 'returning' and old.return_trip)
      or (old.trip_status = 'returning' and new.trip_status = 'completed')
    ) then
      if old.trip_status = 'unloading' and new.trip_status = 'completed' and old.return_trip then
        raise exception 'Trip % is a round trip — it completes when the vehicle is back home', old.trip_no
          using errcode = '23514';
      end if;
      raise exception 'A trip cannot move from % to %', old.trip_status, new.trip_status
        using errcode = '23514';
    end if;
    if new.trip_status = 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;
  if new.vehicle_id is distinct from old.vehicle_id or new.location_id is distinct from old.location_id
     or new.return_trip is distinct from old.return_trip or new.return_place_id is distinct from old.return_place_id then
    raise exception 'A trip''s vehicle, unit and return are fixed at dispatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.transport_trips_guard() from public, anon;

-- The vehicle and the requests follow the trip (0766, + returning).
create or replace function public.transport_trips_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.trip_status is not distinct from old.trip_status then
    return null;
  end if;
  update public.transport_vehicles v
     set status = case new.trip_status
                    when 'planned' then 'loading'
                    when 'loading' then 'loading'
                    when 'en_route' then 'en_route'
                    when 'unloading' then 'unloading'
                    when 'returning' then 'returning'
                    else 'idle'
                  end
   where v.id = new.vehicle_id;
  if new.trip_status in ('returning', 'completed') then
    -- Delivered: the truck has left the destination.
    update public.transport_requisitions r set status = 'completed'
     where r.trip_id = new.id and r.status = 'assigned';
  elsif new.trip_status = 'cancelled' then
    -- Back to the pool: the goods never left, so the request still needs a vehicle.
    update public.transport_requisitions r set status = 'pending', trip_id = null
     where r.trip_id = new.id and r.status = 'assigned';
  end if;
  return null;
end;
$$;
revoke all on function public.transport_trips_sync() from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Dispatch — takes the return decision
-- ---------------------------------------------------------------------------
drop function public.transport_dispatch(uuid, text, text, uuid[], numeric);

create function public.transport_dispatch(
  p_vehicle_id uuid,
  p_driver_name text,
  p_driver_phone text,
  p_requisition_ids uuid[],
  p_start_odometer_km numeric,
  p_return_trip boolean,
  p_return_place_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc uuid := public.current_location();
  v_veh public.transport_vehicles%rowtype;
  v_ids uuid[] := array(select distinct unnest(coalesce(p_requisition_ids, '{}')));
  v_found int;
  v_weight numeric;
  v_dest int;
  v_dest_id uuid;
  v_other_unit int;
  v_trip uuid;
begin
  if v_loc is null then
    raise exception 'Pick your working unit in the top bar first' using errcode = '23502';
  end if;
  if not public.has_permission('logistics', 'create') or not public.has_permission('logistics', 'edit') then
    raise exception 'You do not have permission to dispatch trips' using errcode = '42501';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'Tick at least one request' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('transport_vehicle'), hashtext(p_vehicle_id::text));
  select * into v_veh from public.transport_vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;
  if v_veh.inactive then
    raise exception 'Vehicle % is switched off', v_veh.vehicle_number using errcode = '23514';
  end if;
  if v_veh.status <> 'idle' then
    raise exception 'Vehicle % is not free (%)', v_veh.vehicle_number, replace(v_veh.status, '_', ' ')
      using errcode = '23514';
  end if;

  select count(*), coalesce(sum(r.material_weight_kg), 0), count(distinct r.destination_place_id),
         min(r.destination_place_id::text)::uuid,
         count(*) filter (where r.location_id <> v_loc)
    into v_found, v_weight, v_dest, v_dest_id, v_other_unit
    from (select * from public.transport_requisitions
           where id = any (v_ids) and status in ('pending', 'pooled') and trip_id is null
           for update) r;
  if v_found <> cardinality(v_ids) then
    raise exception 'One of the ticked requests has already been dispatched or cancelled — refresh the pool'
      using errcode = '40001';
  end if;
  if v_other_unit > 0 then
    raise exception 'A request from another unit cannot go on this trip' using errcode = '42501';
  end if;
  if v_dest <> 1 then
    raise exception 'A trip goes to ONE destination — tick requests for the same place' using errcode = '23514';
  end if;
  if v_weight > v_veh.max_payload_kg then
    raise exception 'Load % kg is over % kg, the payload of %', v_weight, v_veh.max_payload_kg, v_veh.vehicle_number
      using errcode = '23514';
  end if;

  if coalesce(p_return_trip, false) then
    if p_return_place_id is null then
      raise exception 'Pick where the vehicle returns to' using errcode = '23502';
    end if;
    if p_return_place_id = v_dest_id then
      raise exception 'The vehicle cannot return to the place it is delivering to' using errcode = '23514';
    end if;
    if not exists (select 1 from public.transport_places p where p.id = p_return_place_id and not p.inactive) then
      raise exception 'The return place is not an active transport place' using errcode = '23514';
    end if;
  end if;

  insert into public.transport_trips
    (location_id, vehicle_id, driver_name, driver_phone, total_loaded_weight_kg, start_odometer_km,
     return_trip, return_place_id)
  values
    (v_loc, p_vehicle_id, upper(btrim(p_driver_name)), nullif(btrim(coalesce(p_driver_phone, '')), ''),
     v_weight, p_start_odometer_km,
     coalesce(p_return_trip, false), case when coalesce(p_return_trip, false) then p_return_place_id end)
  returning id into v_trip;

  update public.transport_requisitions set status = 'assigned', trip_id = v_trip where id = any (v_ids);

  insert into public.transport_trip_events (trip_id, from_status, to_status, source, note)
  values (v_trip, null, 'planned', 'manual', case when coalesce(p_return_trip, false) then 'Dispatched · round trip' else 'Dispatched · one way' end);

  return v_trip;
end;
$$;
revoke all on function public.transport_dispatch(uuid, text, text, uuid[], numeric, boolean, uuid) from public, anon;
grant execute on function public.transport_dispatch(uuid, text, text, uuid[], numeric, boolean, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Complete — a round trip is costed once it is home
-- ---------------------------------------------------------------------------
create or replace function public.transport_complete_trip(
  p_trip_id uuid,
  p_end_odometer_km numeric,
  p_fuel_cost numeric,
  p_driver_allowance numeric,
  p_toll_cost numeric,
  p_other_cost numeric,
  p_allocations jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_trip public.transport_trips%rowtype;
  v_total numeric;
  v_reqs int;
  v_lines int;
  v_matched int;
  v_sum numeric;
begin
  select * into v_trip from public.transport_trips where id = p_trip_id for update;
  if not found then
    raise exception 'Trip not found, or you may not change it' using errcode = 'P0002';
  end if;
  if v_trip.return_trip and v_trip.trip_status = 'unloading' then
    raise exception 'Trip % is a round trip — start the return first, and complete it when the vehicle is home', v_trip.trip_no
      using errcode = '23514';
  end if;
  if v_trip.trip_status not in ('unloading', 'returning', 'completed') then
    raise exception 'Trip % has not reached its destination yet (%)', v_trip.trip_no, replace(v_trip.trip_status, '_', ' ')
      using errcode = '23514';
  end if;

  v_total := round(coalesce(p_fuel_cost, 0) + coalesce(p_driver_allowance, 0)
                 + coalesce(p_toll_cost, 0) + coalesce(p_other_cost, 0), 2);
  select count(*) into v_reqs from public.transport_requisitions where trip_id = p_trip_id;
  select count(*), coalesce(sum((a ->> 'allocated_cost')::numeric), 0)
    into v_lines, v_sum
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
  select count(*) into v_matched
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
    join public.transport_requisitions r on r.id = (a ->> 'requisition_id')::uuid and r.trip_id = p_trip_id;
  if v_lines <> v_reqs or v_matched <> v_reqs then
    raise exception 'The cost split does not match the requests on trip %', v_trip.trip_no using errcode = '23514';
  end if;
  if round(v_sum, 2) <> v_total then
    raise exception 'The cost split (%) does not add up to the trip cost (%)', v_sum, v_total using errcode = '23514';
  end if;

  update public.transport_trips
     set end_odometer_km = p_end_odometer_km,
         fuel_cost = coalesce(p_fuel_cost, 0),
         driver_allowance = coalesce(p_driver_allowance, 0),
         toll_cost = coalesce(p_toll_cost, 0),
         other_cost = coalesce(p_other_cost, 0)
   where id = p_trip_id;

  delete from public.transport_trip_allocations where trip_id = p_trip_id;
  insert into public.transport_trip_allocations
    (trip_id, requisition_id, source_kind, source_id, source_no, weight_kg, weight_pct, allocated_cost)
  select p_trip_id, r.id, r.source_kind, r.source_id, r.source_no, r.material_weight_kg,
         (a ->> 'weight_pct')::numeric, (a ->> 'allocated_cost')::numeric
    from jsonb_array_elements(p_allocations) a
    join public.transport_requisitions r on r.id = (a ->> 'requisition_id')::uuid and r.trip_id = p_trip_id;

  if v_trip.trip_status in ('unloading', 'returning') then
    perform public.transport_apply_event(p_trip_id, 'completed', 'manual', null, null, null, null,
      case when v_trip.trip_status = 'returning' then 'Back home · completed with costs' else 'Completed with costs' end);
  end if;
end;
$$;
revoke all on function public.transport_complete_trip(uuid, numeric, numeric, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.transport_complete_trip(uuid, numeric, numeric, numeric, numeric, numeric, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Verification — from the catalog
-- ---------------------------------------------------------------------------
do $assert$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'transport\_%'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0808: anon can execute %', v_bad;
  end if;
  if has_function_privilege('authenticated', 'public.transport_trips_sync()', 'execute') then
    raise exception '0808: transport_trips_sync is executable by authenticated again';
  end if;
  if (select count(*) from pg_proc where proname = 'transport_dispatch' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0808: more than one transport_dispatch overload';
  end if;
end;
$assert$;
