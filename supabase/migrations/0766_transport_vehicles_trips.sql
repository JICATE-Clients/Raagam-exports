-- ============================================================================
-- Raagam ERP — 0766 Vehicle & Transport: vehicles, places, requests, trips
--
-- doc/vehicle program/plan.md (decisions D1–D10) over the client spec in
-- `vechicle fprogram.md` beside it. Logistics ▸ Transport, permission key
-- `logistics`.
--
--   transport_vehicles          SHARED master (no location_id — plan D8)
--   transport_places            SHARED master; location_id says WHICH unit a
--                               place is, never who may see it (exempt below)
--   transport_requisitions      unit-scoped, REQ number per unit per FY
--   transport_trips             unit-scoped, TRIP number per unit per FY
--   transport_trip_allocations  child of a trip (lv_transport_trips)
--   transport_trip_events       child of a trip — every status change (D7)
--
-- THE ORDER LINK IS A PAIR, NOT AN FK (D2): `source_kind` re | iwo | swo | ho.
-- re = garment_order_amendments.id, iwo = internal_work_orders.id, swo =
-- sample_product_groups.id (the SWO itself — Raise PO keys an SWO on its
-- accessories IWO instead), ho = a movement charged to no order (source_id NULL).
-- Resolved by orderSourceOptions in lib/logistics/transport/service.ts. An RE, an IWO and an SWO are
-- three different tables; one FK cannot point at all of them.
--
-- THE STATE MACHINE IS GUARDED HERE, NOT ONLY IN TS. `canTransition` in
-- lib/logistics/transport/logic.ts is the rule the screens read; the trigger
-- `transport_trips_guard` is the same table, so a stale tab, the GPS webhook
-- (service role, past RLS) and a hand-written PATCH are refused alike.
-- EDIT THE TWO TOGETHER.
--
-- TWO WRITES THAT MUST NOT HALF-HAPPEN ARE FUNCTIONS: `transport_dispatch`
-- (trip + its requests + the first event) and `transport_apply_event` (status
-- + event row). Both are SECURITY INVOKER — RLS and has_permission still
-- decide — and exist only so the writes share one transaction and one lock.
-- `transport_complete_trip` is the third: costs + allocations + the final move.
--
-- `transport_requisitions` has TWO FKs to `transport_places` (origin and
-- destination), so a bare `transport_places(name)` embed on it is ambiguous
-- (AGENTS.md "A SECOND FK"). The service reads the places separately and never
-- embeds; anyone who does must name the column (`!origin_place_id`).
--
-- WRITTEN, NOT APPLIED (plan D10). The user approves before it runs on
-- xcidbfgujrxginrgvbjw.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vehicles (shared master)
-- ---------------------------------------------------------------------------
create table public.transport_vehicles (
  id              uuid primary key default gen_random_uuid(),
  vehicle_number  text not null check (btrim(vehicle_number) <> ''),
  vehicle_type    text not null check (vehicle_type in ('pickup_truck', 'lorry', 'container', 'van')),
  max_payload_kg  numeric(12, 2) not null check (max_payload_kg > 0),
  gps_device_id   text check (gps_device_id is null or btrim(gps_device_id) <> ''),
  status          text not null default 'idle'
                  check (status in ('idle', 'loading', 'en_route', 'unloading', 'maintenance')),
  inactive        boolean not null default false,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index transport_vehicles_number_uidx on public.transport_vehicles (upper(btrim(vehicle_number)));
create unique index transport_vehicles_gps_uidx on public.transport_vehicles (gps_device_id) where gps_device_id is not null;
create index transport_vehicles_status_idx on public.transport_vehicles (status);
comment on table public.transport_vehicles is
  'Transport fleet (plan D8): SHARED master data, no unit. status idle/maintenance is set by hand; '
  'loading/en_route/unloading follow the trip the vehicle is on (transport_trips_sync).';

-- ---------------------------------------------------------------------------
-- 2. Places (shared master; geofences)
-- ---------------------------------------------------------------------------
create table public.transport_places (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> ''),
  kind         text not null check (kind in ('unit', 'vendor', 'other')),
  location_id  uuid references public.locations(id) on delete restrict,
  vendor_id    uuid references public.master_vendors(id) on delete restrict,
  lat          numeric(9, 6) check (lat between -90 and 90),
  lng          numeric(9, 6) check (lng between -180 and 180),
  radius_m     integer not null default 200 check (radius_m between 20 and 50000),
  inactive     boolean not null default false,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (kind <> 'unit' or location_id is not null),
  check (kind <> 'vendor' or vendor_id is not null)
);
create unique index transport_places_name_uidx on public.transport_places (upper(btrim(name)));
create index transport_places_location_idx on public.transport_places (location_id);
create index transport_places_vendor_idx on public.transport_places (vendor_id);
comment on table public.transport_places is
  'Pick-up and drop points with a geofence (plan D3). location-scope: exempt -- shared master '
  'data; location_id names WHICH unit a place is (kind = unit), never who may see it.';

-- ---------------------------------------------------------------------------
-- 3. Document numbers: <unit>/REQ/26-27/0001 and <unit>/TRIP/26-27/0001
--    (0745's PO mechanism: advisory lock per unit+FY, a counter row, a BEFORE
--    INSERT trigger that fills an empty number).
-- ---------------------------------------------------------------------------
create table public.transport_no_counters (
  location_id uuid not null references public.locations(id),
  series      text not null check (series in ('REQ', 'TRIP')),
  fy          text not null,
  last_no     integer not null default 0,
  primary key (location_id, series, fy)
);
alter table public.transport_no_counters enable row level security;   -- no client policy: trigger only
comment on table public.transport_no_counters is
  'REQ / TRIP number counters, keyed per unit + FY, written only by transport_assign_no. '
  'location-scope: exempt -- a counter, not data; no client policy at all.';

create or replace function public.transport_assign_no()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
-- One function, two tables. plpgsql compiles a trigger function per table, so
-- the branch that names the other table's column is never prepared here. (Not
-- to_jsonb(new): on transport_trips that would read total_cost, a generated
-- column, inside a BEFORE trigger.)
declare
  v_series text := tg_argv[0];     -- TG_ARGV is zero-based
  v_loc text;
  v_fy text;
  v_next integer;
  v_no text;
begin
  if tg_table_name = 'transport_trips' then
    if coalesce(new.trip_no, '') <> '' then return new; end if;
  else
    if coalesce(new.req_no, '') <> '' then return new; end if;
  end if;
  select l.code into v_loc from public.locations l where l.id = new.location_id;
  if v_loc is null or v_loc = '' then
    raise exception 'Pick your working unit in the top bar — a % number counts per unit', v_series
      using errcode = '23502';
  end if;
  v_fy := public.fiscal_year_segment(current_date);
  perform pg_advisory_xact_lock(hashtext('transport_no_' || v_series), hashtext(new.location_id::text || v_fy));
  insert into public.transport_no_counters as c (location_id, series, fy, last_no)
  values (new.location_id, v_series, v_fy, 1)
  on conflict (location_id, series, fy) do update set last_no = c.last_no + 1
  returning last_no into v_next;
  v_no := v_loc || '/' || v_series || '/' || public.fiscal_year_label(v_fy) || '/'
       || lpad(v_next::text, greatest(4, length(v_next::text)), '0');
  if tg_table_name = 'transport_trips' then
    new.trip_no := v_no;
  else
    new.req_no := v_no;
  end if;
  return new;
end;
$$;
revoke all on function public.transport_assign_no() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Trips (unit-scoped). Created before requisitions so trip_id can name it.
-- ---------------------------------------------------------------------------
create table public.transport_trips (
  id                      uuid primary key default gen_random_uuid(),
  trip_no                 text not null,
  location_id             uuid not null default public.current_location() references public.locations(id),
  vehicle_id              uuid not null references public.transport_vehicles(id) on delete restrict,
  driver_name             text not null check (btrim(driver_name) <> ''),
  driver_phone            text,
  total_loaded_weight_kg  numeric(12, 2) not null default 0 check (total_loaded_weight_kg >= 0),
  start_odometer_km       numeric(12, 1) check (start_odometer_km >= 0),
  end_odometer_km         numeric(12, 1) check (end_odometer_km >= 0),
  fuel_cost               numeric(14, 2) not null default 0 check (fuel_cost >= 0),
  driver_allowance        numeric(14, 2) not null default 0 check (driver_allowance >= 0),
  toll_cost               numeric(14, 2) not null default 0 check (toll_cost >= 0),
  other_cost              numeric(14, 2) not null default 0 check (other_cost >= 0),
  total_cost              numeric(14, 2) generated always as (fuel_cost + driver_allowance + toll_cost + other_cost) stored,
  trip_status             text not null default 'planned'
                          check (trip_status in ('planned', 'loading', 'en_route', 'unloading', 'completed', 'cancelled')),
  planned_at              timestamptz not null default now(),
  completed_at            timestamptz,
  created_by              uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (trip_no),
  check (end_odometer_km is null or start_odometer_km is null or end_odometer_km >= start_odometer_km)
);
create index transport_trips_location_status_idx on public.transport_trips (location_id, trip_status);
create index transport_trips_vehicle_idx on public.transport_trips (vehicle_id);
-- One open trip per vehicle, across every unit (vehicles are shared).
create unique index transport_trips_one_open_uidx on public.transport_trips (vehicle_id)
  where trip_status in ('planned', 'loading', 'en_route', 'unloading');
comment on table public.transport_trips is
  'A vehicle run (spec §2C). trip_status moves only by transport_trips_guard''s table '
  '(mirror of canTransition, lib/logistics/transport/logic.ts); total_cost is derived.';

-- ---------------------------------------------------------------------------
-- 5. Requisitions (unit-scoped)
-- ---------------------------------------------------------------------------
create table public.transport_requisitions (
  id                    uuid primary key default gen_random_uuid(),
  req_no                text not null,
  location_id           uuid not null default public.current_location() references public.locations(id),
  source_kind           text not null check (source_kind in ('re', 'iwo', 'swo', 'ho')),
  source_id             uuid,
  source_no             text,
  origin_place_id       uuid not null references public.transport_places(id) on delete restrict,
  destination_place_id  uuid not null references public.transport_places(id) on delete restrict,
  material_type         text not null check (btrim(material_type) <> ''),
  material_weight_kg    numeric(12, 2) not null check (material_weight_kg > 0),
  required_dispatch_at  timestamptz not null,
  status                text not null default 'pending'
                        check (status in ('pending', 'pooled', 'assigned', 'completed', 'cancelled')),
  trip_id               uuid references public.transport_trips(id) on delete set null,
  remarks               text,
  created_by            uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (req_no),
  check ((source_kind = 'ho') = (source_id is null)),
  check (origin_place_id <> destination_place_id),
  check ((status in ('assigned', 'completed')) = (trip_id is not null))
);
create index transport_requisitions_location_status_idx on public.transport_requisitions (location_id, status);
create index transport_requisitions_trip_idx on public.transport_requisitions (trip_id);
create index transport_requisitions_origin_idx on public.transport_requisitions (origin_place_id);
create index transport_requisitions_destination_idx on public.transport_requisitions (destination_place_id);
create index transport_requisitions_source_idx on public.transport_requisitions (source_id);
comment on table public.transport_requisitions is
  'A trip booking request (spec §2B). Order link is source_kind + source_id (plan D2; ho = no order). '
  'TWO FKs to transport_places — embed with !origin_place_id / !destination_place_id.';

-- ---------------------------------------------------------------------------
-- 6. Allocations and events (children of a trip)
-- ---------------------------------------------------------------------------
create table public.transport_trip_allocations (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.transport_trips(id) on delete cascade,
  requisition_id  uuid not null references public.transport_requisitions(id) on delete cascade,
  source_kind     text not null check (source_kind in ('re', 'iwo', 'swo', 'ho')),
  source_id       uuid,
  source_no       text,
  weight_kg       numeric(12, 2) not null check (weight_kg >= 0),
  weight_pct      numeric(7, 2) not null check (weight_pct between 0 and 100),
  allocated_cost  numeric(14, 2) not null check (allocated_cost >= 0),
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (requisition_id)
);
create index transport_trip_allocations_trip_idx on public.transport_trip_allocations (trip_id);
create index transport_trip_allocations_source_idx on public.transport_trip_allocations (source_id);
comment on table public.transport_trip_allocations is
  'Pro-rata trip cost per request / order (spec §3C, plan D5). Written by transport_complete_trip; '
  'Σ allocated_cost = the trip''s total_cost exactly (remainder to the largest line).';

create table public.transport_trip_events (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.transport_trips(id) on delete cascade,
  from_status  text check (from_status in ('planned', 'loading', 'en_route', 'unloading', 'completed', 'cancelled')),
  to_status    text not null check (to_status in ('planned', 'loading', 'en_route', 'unloading', 'completed', 'cancelled')),
  source       text not null check (source in ('gps', 'manual')),
  event_at     timestamptz not null default now(),
  lat          numeric(9, 6),
  lng          numeric(9, 6),
  place_id     uuid references public.transport_places(id) on delete set null,
  note         text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index transport_trip_events_trip_idx on public.transport_trip_events (trip_id, event_at);
create index transport_trip_events_place_idx on public.transport_trip_events (place_id);
comment on table public.transport_trip_events is
  'Every trip status change, GPS or manual (plan D7) — "why does it say En Route?". '
  'Written only through transport_dispatch / transport_apply_event / transport_complete_trip.';

-- ---------------------------------------------------------------------------
-- 7. Triggers
-- ---------------------------------------------------------------------------
create trigger transport_vehicles_updated_at before update on public.transport_vehicles
  for each row execute function public.set_updated_at();
create trigger transport_places_updated_at before update on public.transport_places
  for each row execute function public.set_updated_at();
create trigger transport_trips_updated_at before update on public.transport_trips
  for each row execute function public.set_updated_at();
create trigger transport_requisitions_updated_at before update on public.transport_requisitions
  for each row execute function public.set_updated_at();

create trigger transport_requisitions_a_no before insert on public.transport_requisitions
  for each row execute function public.transport_assign_no('REQ');
create trigger transport_trips_a_no before insert on public.transport_trips
  for each row execute function public.transport_assign_no('TRIP');

-- The state machine (mirror of ALLOWED in logic.ts) + completed_at.
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
      or (old.trip_status = 'unloading' and new.trip_status = 'completed')
    ) then
      raise exception 'A trip cannot move from % to %', old.trip_status, new.trip_status
        using errcode = '23514';
    end if;
    if new.trip_status = 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;
  if new.vehicle_id is distinct from old.vehicle_id or new.location_id is distinct from old.location_id then
    raise exception 'A trip''s vehicle and unit are fixed at dispatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.transport_trips_guard() from public, anon;

create trigger transport_trips_guard before insert or update on public.transport_trips
  for each row execute function public.transport_trips_guard();

-- The vehicle and the requests follow the trip. DEFINER: a dispatcher moving a
-- trip need not hold edit on the shared vehicle master to free the vehicle.
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
                    else 'idle'
                  end
   where v.id = new.vehicle_id;
  if new.trip_status = 'completed' then
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

create trigger transport_trips_sync after insert or update of trip_status on public.transport_trips
  for each row execute function public.transport_trips_sync();

-- A booked request changes only while it is still waiting for a vehicle.
create or replace function public.transport_requisitions_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status not in ('pending', 'pooled') and (
       new.source_kind, new.source_id, new.origin_place_id, new.destination_place_id,
       new.material_type, new.material_weight_kg, new.required_dispatch_at, new.location_id
     ) is distinct from (
       old.source_kind, old.source_id, old.origin_place_id, old.destination_place_id,
       old.material_type, old.material_weight_kg, old.required_dispatch_at, old.location_id
     ) then
    raise exception 'Request % is % — it can no longer be changed', old.req_no, old.status
      using errcode = '23514';
  end if;
  if old.status in ('completed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Request % is already %', old.req_no, old.status using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.transport_requisitions_guard() from public, anon;

create trigger transport_requisitions_guard before update on public.transport_requisitions
  for each row execute function public.transport_requisitions_guard();

-- ---------------------------------------------------------------------------
-- 8. Unit predicates for the children (0680's generated shape, written by hand
--    because 0680 only generated for tables that existed then).
-- ---------------------------------------------------------------------------
create or replace function public.lv_transport_trips(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select p_id is null or exists (select 1 from public.transport_trips x where x.id = p_id
    and public.is_current_location(x.location_id))
$f$;
revoke all on function public.lv_transport_trips(uuid) from public, anon;
grant execute on function public.lv_transport_trips(uuid) to authenticated;
comment on function public.lv_transport_trips(uuid) is
  'Is this transport_trips row in the current unit? 0680 shape (0766) — answers WHICH UNIT only, never a module permission.';

create or replace function public.lv_transport_requisitions(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select p_id is null or exists (select 1 from public.transport_requisitions x where x.id = p_id
    and public.is_current_location(x.location_id))
$f$;
revoke all on function public.lv_transport_requisitions(uuid) from public, anon;
grant execute on function public.lv_transport_requisitions(uuid) to authenticated;
comment on function public.lv_transport_requisitions(uuid) is
  'Is this transport_requisitions row in the current unit? 0680 shape (0766) — answers WHICH UNIT only, never a module permission.';

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
alter table public.transport_vehicles enable row level security;
alter table public.transport_places enable row level security;
alter table public.transport_trips enable row level security;
alter table public.transport_requisitions enable row level security;
alter table public.transport_trip_allocations enable row level security;
alter table public.transport_trip_events enable row level security;

-- Shared masters: module permission only.
create policy transport_vehicles_select on public.transport_vehicles for select to authenticated
  using (public.has_permission('logistics', 'view'));
create policy transport_vehicles_insert on public.transport_vehicles for insert to authenticated
  with check (public.has_permission('logistics', 'create'));
create policy transport_vehicles_update on public.transport_vehicles for update to authenticated
  using (public.has_permission('logistics', 'edit'))
  with check (public.has_permission('logistics', 'edit'));
create policy transport_vehicles_delete on public.transport_vehicles for delete to authenticated
  using (public.has_permission('logistics', 'delete'));

create policy transport_places_select on public.transport_places for select to authenticated
  using (public.has_permission('logistics', 'view'));
create policy transport_places_insert on public.transport_places for insert to authenticated
  with check (public.has_permission('logistics', 'create'));
create policy transport_places_update on public.transport_places for update to authenticated
  using (public.has_permission('logistics', 'edit'))
  with check (public.has_permission('logistics', 'edit'));
create policy transport_places_delete on public.transport_places for delete to authenticated
  using (public.has_permission('logistics', 'delete'));

-- Unit-scoped documents.
create policy transport_trips_select on public.transport_trips for select to authenticated
  using (public.has_permission('logistics', 'view') and public.is_current_location(location_id));
create policy transport_trips_insert on public.transport_trips for insert to authenticated
  with check (public.has_permission('logistics', 'create') and public.is_current_location(location_id));
create policy transport_trips_update on public.transport_trips for update to authenticated
  using (public.has_permission('logistics', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('logistics', 'edit') and public.is_current_location(location_id));
create policy transport_trips_delete on public.transport_trips for delete to authenticated
  using (public.has_permission('logistics', 'delete') and public.is_current_location(location_id));

create policy transport_requisitions_select on public.transport_requisitions for select to authenticated
  using (public.has_permission('logistics', 'view') and public.is_current_location(location_id));
create policy transport_requisitions_insert on public.transport_requisitions for insert to authenticated
  with check (public.has_permission('logistics', 'create') and public.is_current_location(location_id));
-- The booker edits their own pending request with `create`; dispatch needs `edit`.
create policy transport_requisitions_update on public.transport_requisitions for update to authenticated
  using ((public.has_permission('logistics', 'edit')
          or (public.has_permission('logistics', 'create') and created_by = auth.uid()))
         and public.is_current_location(location_id))
  with check ((public.has_permission('logistics', 'edit')
          or (public.has_permission('logistics', 'create') and created_by = auth.uid()))
         and public.is_current_location(location_id));
create policy transport_requisitions_delete on public.transport_requisitions for delete to authenticated
  using (public.has_permission('logistics', 'delete') and public.is_current_location(location_id));

-- Children: through their trip (and request). A line is deletable by `edit`
-- (AGENTS.md, 0678: a save that replaces lines must be able to delete them).
create policy transport_trip_allocations_select on public.transport_trip_allocations for select to authenticated
  using (public.has_permission('logistics', 'view')
         and public.lv_transport_trips(trip_id) and public.lv_transport_requisitions(requisition_id));
create policy transport_trip_allocations_insert on public.transport_trip_allocations for insert to authenticated
  with check (public.has_permission('logistics', 'edit')
         and public.lv_transport_trips(trip_id) and public.lv_transport_requisitions(requisition_id));
create policy transport_trip_allocations_update on public.transport_trip_allocations for update to authenticated
  using (public.has_permission('logistics', 'edit')
         and public.lv_transport_trips(trip_id) and public.lv_transport_requisitions(requisition_id))
  with check (public.has_permission('logistics', 'edit')
         and public.lv_transport_trips(trip_id) and public.lv_transport_requisitions(requisition_id));
create policy transport_trip_allocations_delete on public.transport_trip_allocations for delete to authenticated
  using ((public.has_permission('logistics', 'edit') or public.has_permission('logistics', 'delete'))
         and public.lv_transport_trips(trip_id) and public.lv_transport_requisitions(requisition_id));

create policy transport_trip_events_select on public.transport_trip_events for select to authenticated
  using (public.has_permission('logistics', 'view') and public.lv_transport_trips(trip_id));
-- Events are append-only: no update or delete policy at all.
create policy transport_trip_events_insert on public.transport_trip_events for insert to authenticated
  with check ((public.has_permission('logistics', 'create') or public.has_permission('logistics', 'edit'))
         and public.lv_transport_trips(trip_id));

-- ---------------------------------------------------------------------------
-- 10. The three atomic writes (SECURITY INVOKER — RLS still decides)
-- ---------------------------------------------------------------------------

-- Dispatch (spec §4 POST /dispatch): one trip, its requests, the first event.
create or replace function public.transport_dispatch(
  p_vehicle_id uuid,
  p_driver_name text,
  p_driver_phone text,
  p_requisition_ids uuid[],
  p_start_odometer_km numeric
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

  -- One dispatch per vehicle at a time; the partial unique index is the backstop.
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
         count(*) filter (where r.location_id <> v_loc)
    into v_found, v_weight, v_dest, v_other_unit
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

  insert into public.transport_trips
    (location_id, vehicle_id, driver_name, driver_phone, total_loaded_weight_kg, start_odometer_km)
  values
    (v_loc, p_vehicle_id, upper(btrim(p_driver_name)), nullif(btrim(coalesce(p_driver_phone, '')), ''),
     v_weight, p_start_odometer_km)
  returning id into v_trip;

  update public.transport_requisitions set status = 'assigned', trip_id = v_trip where id = any (v_ids);

  insert into public.transport_trip_events (trip_id, from_status, to_status, source, note)
  values (v_trip, null, 'planned', 'manual', 'Dispatched');

  return v_trip;
end;
$$;
revoke all on function public.transport_dispatch(uuid, text, text, uuid[], numeric) from public, anon;
grant execute on function public.transport_dispatch(uuid, text, text, uuid[], numeric) to authenticated, service_role;

-- THE one state-machine door (plan D6): the board's buttons and the GPS webhook.
-- Same status again = an idempotent retry, answered { ignored: true }.
create or replace function public.transport_apply_event(
  p_trip_id uuid,
  p_to_status text,
  p_source text,
  p_at timestamptz default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_place_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_from text;
begin
  if p_source not in ('gps', 'manual') then
    raise exception 'Unknown event source %', p_source using errcode = '22023';
  end if;
  select trip_status into v_from from public.transport_trips where id = p_trip_id for update;
  if not found then
    raise exception 'Trip not found, or you may not change it' using errcode = 'P0002';
  end if;
  if v_from = p_to_status then
    return jsonb_build_object('ignored', true, 'from', v_from, 'to', p_to_status);
  end if;
  -- transport_trips_guard refuses an illegal move with its own message.
  update public.transport_trips set trip_status = p_to_status where id = p_trip_id;
  insert into public.transport_trip_events (trip_id, from_status, to_status, source, event_at, lat, lng, place_id, note)
  values (p_trip_id, v_from, p_to_status, p_source, coalesce(p_at, now()), p_lat, p_lng, p_place_id,
          nullif(btrim(coalesce(p_note, '')), ''));
  return jsonb_build_object('ignored', false, 'from', v_from, 'to', p_to_status);
end;
$$;
revoke all on function public.transport_apply_event(uuid, text, text, timestamptz, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.transport_apply_event(uuid, text, text, timestamptz, numeric, numeric, uuid, text)
  to authenticated, service_role;

-- Complete (spec §4 POST /trips/{id}/complete): costs, allocations, final move.
-- The split is computed in TS (allocateCost) and VERIFIED here: one line per
-- request on the trip, and Σ allocated_cost = total_cost to the paisa.
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
  if v_trip.trip_status not in ('unloading', 'completed') then
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

  if v_trip.trip_status = 'unloading' then
    perform public.transport_apply_event(p_trip_id, 'completed', 'manual', null, null, null, null, 'Completed with costs');
  end if;
end;
$$;
revoke all on function public.transport_complete_trip(uuid, numeric, numeric, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.transport_complete_trip(uuid, numeric, numeric, numeric, numeric, numeric, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Verification — from the catalog
-- ---------------------------------------------------------------------------
do $assert$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('transport_vehicles', 'transport_places', 'transport_trips', 'transport_requisitions',
                       'transport_trip_allocations', 'transport_trip_events', 'transport_no_counters')
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception '0766: RLS is off on %', v_bad;
  end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'transport\_%' or p.proname like 'lv\_transport\_%')
     and (has_function_privilege('anon', p.oid, 'execute'));
  if v_bad is not null then
    raise exception '0766: anon can execute %', v_bad;
  end if;
end $assert$;
