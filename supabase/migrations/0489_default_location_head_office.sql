-- ============================================================================
-- Raagam ERP — 0489 Land on Head Office by default
--
-- User decision 2026-08-31: "Default load the head office, if may need user
-- will update."
--
-- This REVERSES the fail-closed landing 0483 shipped, and does so deliberately.
-- That design refused to choose a unit when the profile named none, on the
-- grounds that picking one answers "which company's books?" on the operator's
-- behalf. The objection was put to the user; the user chose the default anyway,
-- and the later instruction wins. A reader who finds the fail-closed reasoning
-- quoted in `lib/auth/location.ts` is holding something this supersedes —
-- restoring it needs a new decision, not a tidy-up.
--
-- What made the original objection weaker here is worth recording: the risk was
-- never "a default exists", it was "the default is a GUESS". `allowed[0]` is a
-- guess — array order deciding a GST entity. A location explicitly FLAGGED as
-- the house default is a stated fact, and Head Office is the entity this
-- business has been running on alone until now.
--
--
-- ## THE FLAG, NOT THE STRING 'HO'
--
-- `locations.is_default`, with a partial unique index so exactly one row can
-- hold it. Matching on `code = 'HO'` would have worked today and hard-coded a
-- business fact into a function: the day Head Office is renamed, merged or
-- retired, the fallback silently resolves to nothing and every operator without
-- a home unit lands on an empty screen. A flag is a fact the client can move
-- without a migration.
--
--
-- ## THE FALLBACK CHAIN IS DUPLICATED ON PURPOSE, AND MUST STAY IDENTICAL
--
--   1. profiles.current_location_id  — what they last switched to
--   2. profiles.default_location_id  — their home unit, an admin's statement
--   3. the location flagged is_default — Head Office
--
-- and EVERY step is filtered through the same set: active locations this user
-- may reach. `lib/auth/location.ts` computes exactly this over `allowed`, the
-- array `my_locations()` returns.
--
-- That duplication is the whole lesson of 0487a. When only one side knew about
-- a fallback, the Location box named a unit the policies did not serve, and the
-- operator read "Head Office" above an empty screen with nothing to explain it.
-- So this function is written as a set operation over the SAME rows
-- `my_locations()` returns, rather than as a `coalesce` over the profile
-- columns — a coalesce would skip the access and is_active filters at steps 1
-- and 2, and re-open exactly that gap for a user whose stored unit was since
-- deactivated or revoked.
-- ============================================================================

-- ==========================================================================
-- 1. The flag
-- ==========================================================================
alter table public.locations
  add column if not exists is_default boolean not null default false;

comment on column public.locations.is_default is
  'The house default unit — where an operator lands when their profile names none. Exactly one row may hold it (uq_locations_single_default). Read by current_location() as the LAST fallback, and only ever after the operator''s own stored and home units. 0489.';

-- Exactly one, enforced rather than agreed. Two defaults would make
-- current_location()'s third branch order-dependent, which is the `allowed[0]`
-- guess this flag exists to replace.
create unique index if not exists uq_locations_single_default
  on public.locations ((true)) where is_default;

update public.locations set is_default = true  where code = 'HO';
update public.locations set is_default = false where code <> 'HO';

-- ==========================================================================
-- 2. my_locations() carries the flag, so the client can compute the SAME
--    fallback without a second query — and therefore cannot compute a
--    different one.
--
--    DROP + CREATE rather than CREATE OR REPLACE: the return type changes, and
--    Postgres refuses to replace a function's OUT columns in place.
-- ==========================================================================
drop function if exists public.my_locations();

create function public.my_locations()
returns table(id uuid, code text, name text, is_default boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.code, l.name, l.is_default
  from public.locations l
  where l.is_active
    and public.has_location_access(l.id)
  order by l.code;
$$;

comment on function public.my_locations() is
  'Active locations the caller may act in, with the house-default flag. Delegates to has_location_access() — NOT is_current_location() — so the switcher offers every reachable unit; narrowing it here would leave the operator unable to switch away from the unit they are on. 0483, extended 0489.';

revoke all on function public.my_locations() from public, anon;
grant execute on function public.my_locations() to authenticated;

-- ==========================================================================
-- 3. current_location() gains the third branch
-- ==========================================================================
create or replace function public.current_location(uid uuid default auth.uid())
returns uuid language sql stable security definer set search_path = '' as $$
  with allowed as (
    select l.id, l.is_default
    from public.locations l
    where l.is_active
      and public.has_location_access(l.id, uid)
  ), me as (
    select p.current_location_id, p.default_location_id
    from public.profiles p
    where p.id = uid
  )
  select coalesce(
    -- 1. what they last switched to
    (select a.id from allowed a, me m where a.id = m.current_location_id),
    -- 2. their home unit
    (select a.id from allowed a, me m where a.id = m.default_location_id),
    -- 3. the house default (Head Office)
    (select a.id from allowed a where a.is_default limit 1)
  );
$$;

comment on function public.current_location(uid uuid) is
  'The unit the caller is working in now. Falls back current_location_id -> default_location_id -> the is_default location (Head Office), every step filtered to ACTIVE locations the caller may reach. lib/auth/location.ts computes this same chain over the same rows my_locations() returns — they must never diverge, or the Location box names one unit while the policies serve another (0487a). 0489.';

-- ==========================================================================
-- 4. Verification — FROM THE CATALOG AND THE DATA
-- ==========================================================================
do $$
declare
  v_n     int;
  v_uid   uuid;
  v_ho    uuid;
  v_got   uuid;
begin
  -- 4a. Exactly one default, and it is Head Office.
  select count(*) into v_n from public.locations where is_default;
  if v_n <> 1 then
    raise exception '0489: expected exactly 1 default location, found %', v_n;
  end if;

  select id into v_ho from public.locations where code = 'HO';
  if v_ho is null then
    raise exception '0489: no location with code HO — nothing to default to';
  end if;
  if not exists (select 1 from public.locations where is_default and id = v_ho) then
    raise exception '0489: the default flag is not on Head Office';
  end if;

  -- 4b. Head Office must be ACTIVE, or the fallback resolves to nothing and
  --     every operator without a home unit lands on an empty screen.
  if not exists (select 1 from public.locations where id = v_ho and is_active) then
    raise exception '0489: Head Office is inactive — the default would resolve to nothing';
  end if;

  -- 4c. THE POINT OF THE WHOLE FILE: a user with neither a stored nor a home
  --     unit now lands on Head Office. Asserted against a real profile rather
  --     than reasoned about — this is the behaviour the user asked for, and it
  --     is the one that was previously NULL.
  select id into v_uid from public.profiles
   where current_location_id is null and default_location_id is null
   order by id limit 1;

  if v_uid is not null then
    select public.current_location(v_uid) into v_got;
    if v_got is distinct from v_ho then
      raise exception '0489: a profile with no stored or home unit resolved to % — expected Head Office (%)', coalesce(v_got::text,'NULL'), v_ho;
    end if;
  end if;

  -- 4d. my_locations() still answers "may reach", not "am in now". If it ever
  --     narrows to the current unit the dropdown shows one option and the
  --     operator can never leave the unit they are on.
  if pg_get_functiondef('public.my_locations()'::regprocedure) not like '%has_location_access%' then
    raise exception '0489 CHECK: my_locations() no longer uses has_location_access — the switcher could never leave its current unit';
  end if;
end $$;
