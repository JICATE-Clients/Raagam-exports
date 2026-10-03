-- ============================================================================
-- Raagam ERP — 0681 Reports and lookups answer for the CURRENT UNIT only
--
-- Second half of 0680 (client 2026-10-03: "normal user = allocated locations
-- only, super admin = all locations"). 0680 narrowed the TABLES. These
-- functions are SECURITY DEFINER — they read past RLS by design — so a table
-- policy does not reach them, and not one of the 17 that screens call to list
-- or total transactional rows asked which unit the caller is in:
--
--   * the item reports and the analytics dashboard take `p_location`, where
--     NULL means EVERY UNIT — and the screens pass NULL. A Unit 2 user's stock
--     report and sales chart counted Head Office's movements;
--   * five lookups take a document id (GRN, IWO, order, revision entry) and
--     answer for ANY id, including another unit's;
--   * the T&A KPI ranks staff from every unit.
--
-- ONE MECHANISM FOR ALL OF THEM: the body is renamed `<name>__all_units` and
-- withdrawn from `authenticated`; a wrapper with the ORIGINAL name and
-- signature calls it. No screen changes and no body is rewritten — rewriting
-- 17 report bodies to thread a unit through is 17 chances to miss a join.
--
--   * report / analytics: `p_location` is REPLACED by `current_location()`.
--     Not "honoured when it is one of mine": the app works in one unit at a
--     time (0487), and a caller-supplied unit is exactly the door this closes.
--   * no current unit -> NO ROWS. Never NULL passed through, because NULL is
--     "all units" to every one of these bodies — the failure would be the most
--     permissive answer, silently.
--   * id lookups: answered only when the document is visible in the current
--     unit (`has_amendment_access` / the 0680 `lv_<table>` predicates).
--   * staff_ta_kpi: rows for staff of the current unit only.
--
-- Super admins are narrowed too, to the unit they are IN: they can switch to
-- any unit, which is what "all locations" means everywhere else in the app.
--
-- Also: `current_location()` step 4 — a person allocated exactly ONE unit
-- lands on it. Before, a Unit-1-only operator whose home unit was left at Head
-- Office landed on nothing. Mirrors `resolveCurrentLocation()` in
-- lib/auth/location.ts; the two must never diverge.
-- ============================================================================

create or replace function public.current_location(uid uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
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
    (select a.id from allowed a, me m where a.id = m.current_location_id),
    (select a.id from allowed a, me m where a.id = m.default_location_id),
    (select a.id from allowed a where a.is_default limit 1),
    (select a.id from allowed a where (select count(*) from allowed) = 1)
  );
$function$;

do $$
declare
  -- name -> guard. '#loc' = replace p_location; anything else is a row/arg guard.
  v_spec constant jsonb := jsonb_build_object(
    'report_item_summary',             '#loc',
    'report_item_stock_as_of',         '#loc',
    'report_item_ledger',              '#loc',
    'analytics_monthly_sales',         '#loc',
    'analytics_top_customers',         '#loc',
    'analytics_top_products',          '#loc',
    'analytics_revenue_trend',         '#loc',
    'analytics_purchase_trend',        '#loc',
    'analytics_inventory_movement',    '#loc',
    'analytics_attendance',            '#loc',
    'analytics_production_efficiency', '#loc',
    'cad_style_states',                'public.has_amendment_access(p_order)',
    'stage_cumulative_good_qty',       'public.has_amendment_access(p_amendment_id)',
    'grn_over_tolerance_lines',        'public.lv_grns(p_grn_id)',
    'iwo_purchase_check',              'public.lv_internal_work_orders(p_iwo_id)',
    'order_amendment_changes',         'public.lv_order_budget_revisions(p_entry)',
    'staff_ta_kpi',                    '#row public.lv_staff(r.staff_id)'
  );
  k text; g text; f record; v_args text; v_call text; v_sql text; v_from text; v_where text;
begin
  for k, g in select * from jsonb_each_text(v_spec) loop
    select p.oid, p.proretset, pg_get_function_arguments(p.oid) as args,
           pg_get_function_identity_arguments(p.oid) as ident,
           pg_get_function_result(p.oid) as res,
           p.proargnames
      into f
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = k;
    if f.oid is null then raise exception '0681: % not found', k; end if;
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = k || '__all_units') then
      continue;   -- already wrapped
    end if;

    execute format('alter function public.%I(%s) rename to %I', k, f.ident, k || '__all_units');
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', k || '__all_units', f.ident);

    select string_agg(case when g = '#loc' and n = 'p_location' then 'public.current_location()' else quote_ident(n) end,
                      ', ' order by i)
      into v_call
      from unnest(f.proargnames) with ordinality as a(n, i)
     where i <= (select pronargs from pg_proc where oid = f.oid);

    v_from  := format('public.%I(%s)', k || '__all_units', v_call);
    v_where := case when g = '#loc' then 'public.current_location() is not null'
                    when g like '#row %' then substr(g, 6)
                    else g end;

    v_sql := case
      when f.proretset then format('select r.* from %s r where %s', v_from, v_where)
      else format('select %s where %s', v_from, v_where)
    end;

    execute format(
      'create function public.%I(%s) returns %s language sql stable security definer '
      'set search_path to '''' as $w$ %s $w$',
      k, f.args, f.res, v_sql);
    execute format('revoke all on function public.%I(%s) from public, anon', k, f.ident);
    execute format('grant execute on function public.%I(%s) to authenticated', k, f.ident);
    execute format('comment on function public.%I(%s) is %L', k, f.ident,
      'Current-unit wrapper (0681) over ' || k || '__all_units, which is not callable by users. '
      || case when g = '#loc' then 'p_location is replaced by current_location(); no unit -> no rows.'
              else 'Answers only when: ' || v_where || '.' end);
  end loop;
end $$;

-- Self-verification: every wrapped body is closed to users, every wrapper open.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like '%\_\_all\_units'
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad is not null then raise exception '0681: still callable by users: %', v_bad; end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like '%\_\_all\_units') <> 17 then
    raise exception '0681: expected 17 wrapped functions';
  end if;
end $$;
