-- 0811 · Create one Storage store in several units with one Save (user 2026-11-05).
--
-- A pasted note asked for ONE store row shared by several units. That was declined:
-- a store's unit is the GST entity that owns the stock in it — bins inherit it (0800),
-- the stock ledger and Stock Transfer (0803) read it, and the client put stores on the
-- per-unit side (2026-08-31). What the note actually wanted — not typing "Yarn Store"
-- three times — is this: one form, the units ticked, one ordinary store row per unit.
--
-- Why a function: `stores_insert` checks is_current_location(location_id), so a plain
-- insert can only land in the unit the operator is in now. This definer function
-- re-checks the same two facts the policy would, per unit:
--   * has_permission('stores','create')
--   * has_location_access(unit) — the units the operator may SWITCH to (0680), never
--     a unit they could not otherwise reach.
-- It creates STORAGE stores only: the six system types are one per unit and are not
-- made from this form (0800).
--
-- All or nothing: a unit that already has a store of that name refuses the whole save,
-- naming the unit, so the operator is never left guessing which copies were made.

create or replace function public.create_store_in_units(
  p_name text,
  p_location_ids uuid[],
  p_bin_prefix text default null,
  p_is_active boolean default true
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := upper(btrim(coalesce(p_name, '')));
  v_loc record;
  v_base text;
  v_code text;
  v_n int;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  if v_name = '' then raise exception 'Store Name is required'; end if;
  if coalesce(array_length(p_location_ids, 1), 0) = 0 then raise exception 'Pick at least one unit'; end if;
  if not public.has_permission('stores', 'create') then
    raise exception 'You do not have permission to add a store';
  end if;

  for v_loc in
    select l.id, l.code, l.name
    from public.locations l
    where l.id = any (p_location_ids)
    order by l.code
  loop
    if not public.has_location_access(v_loc.id) then
      raise exception 'You are not allocated to %', v_loc.name;
    end if;
    if exists (select 1 from public.stores s
               where s.location_id = v_loc.id and upper(btrim(s.name)) = v_name) then
      raise exception '% already has a store named %', v_loc.name, v_name;
    end if;

    -- Same shape as createStore's generated code: unit code + name, letters and
    -- digits only, 12 long; a number on the end if taken (codes are unique globally).
    v_base := left(regexp_replace(upper(coalesce(v_loc.code, '') || v_name), '[^A-Z0-9]', '', 'g'), 12);
    v_code := v_base;
    v_n := 1;
    while exists (select 1 from public.stores s where s.code = v_code) loop
      v_n := v_n + 1;
      v_code := left(v_base, 12 - length(v_n::text)) || v_n::text;
    end loop;

    insert into public.stores (code, name, store_type, location_id, bin_prefix, is_active)
    values (v_code, v_name, 'storage', v_loc.id, nullif(upper(btrim(coalesce(p_bin_prefix, ''))), ''), p_is_active)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) <> array_length(p_location_ids, 1) then
    raise exception 'One of the chosen units was not found';
  end if;
  return v_ids;
end
$$;

revoke all on function public.create_store_in_units(text, uuid[], text, boolean) from public, anon;
grant execute on function public.create_store_in_units(text, uuid[], text, boolean) to authenticated;
