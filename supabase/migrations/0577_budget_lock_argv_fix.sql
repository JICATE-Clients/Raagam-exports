-- ============================================================================
-- Raagam ERP — 0577 The order lock's child triggers were no-ops: TG_ARGV is
-- ZERO-based
--
-- 0576 attached `trg_order_lock` to 44 child / BOM tables with the path from a
-- row to its order passed as trigger arguments, and `refuse_when_order_locked()`
-- hands `TG_ARGV` to `order_lock_row_order(p_row, p_path)`, which read
-- `p_path[1]`.
--
-- In PL/pgSQL `TG_ARGV` is a ZERO-based array — its first argument is
-- `TG_ARGV[0]`. So `p_path[1]` was the SECOND argument: NULL on every one-hop
-- path (`amendment_id`, `garment_order_id`) and the wrong column on every
-- deeper one. The walk returned NULL, `order_lock_message(NULL)` returned no
-- row, and every child and BOM write passed. Only `garment_order_amendments`
-- itself locked, because its branch reads the row's own id and never walks.
--
-- Found by a rolled-back behaviour test run against the live database right
-- after 0576 was applied (approve a throwaway budget, edit a style row — it was
-- NOT refused). No harm was possible: 0 budgets were approved, so nothing was
-- locked. 0576's $verify$ could not see it because it asserted the triggers
-- EXIST, not that they REFUSE — which is why this migration's $verify$ is a
-- behaviour test.
--
-- THE FIX re-bases the array to 1 inside the helper (`array(select unnest(…))`
-- keeps the order and starts at 1), so it is correct for any caller, zero-based
-- or not, rather than asking every trigger to remember the quirk.
-- `create or replace` keeps the function's owner and privileges; they are
-- revoked again anyway so the grant rule is restated where it is enforced.
-- ============================================================================

create or replace function public.order_lock_row_order(p_row jsonb, p_path text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- RE-BASED TO 1. The trigger passes TG_ARGV, which is zero-based (0577).
  v_path text[] := array(select unnest(p_path));
  v      text;
  i      int := 2;
begin
  v := p_row ->> v_path[1];
  while v is not null and i + 1 <= coalesce(array_length(v_path, 1), 0) loop
    execute format('select (%I)::text from public.%I where id = $1::uuid', v_path[i + 1], v_path[i])
      into v
      using v;
    i := i + 2;
  end loop;
  return v::uuid;
end;
$$;

revoke all on function public.order_lock_row_order(jsonb, text[]) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- A BEHAVIOUR test, not a presence test. Everything it writes is undone: the
-- inner block always ends by raising a sentinel, which rolls back to its
-- savepoint, and only then are the collected results judged.
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_zero   text[] := '[0:0]={amendment_id}'::text[];
  v_id     uuid := gen_random_uuid();
  x        uuid;
  st       uuid;
  loc      uuid;
  b        uuid;
  r_style  text := 'not run';
  r_parent text := 'not run';
begin
  -- 1. The helper reads a ZERO-based one-hop path.
  if public.order_lock_row_order(jsonb_build_object('amendment_id', v_id), v_zero) is distinct from v_id then
    raise exception '0577: order_lock_row_order still misreads a zero-based path';
  end if;

  -- 2. End to end, on a real order with styles — skipped on an empty database.
  select a.id into x from public.garment_order_amendments a
   where exists (select 1 from public.garment_order_amendment_styles s where s.amendment_id = a.id)
     and a.re_status = 'open'
   limit 1;
  select id into loc from public.locations limit 1;
  if x is null or loc is null then
    return;
  end if;
  select s.id into st from public.garment_order_amendment_styles s where s.amendment_id = x limit 1;

  begin
    insert into public.order_budgets (budget_date, status, location_id)
    values (current_date, 'draft', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal)
    values (b, x, '0577 verify');
    update public.order_budgets
       set status = 'approved', decided_at = now(), decided_by = gen_random_uuid()
     where id = b;

    begin
      update public.garment_order_amendment_styles
         set description = coalesce(description, '') || ' 0577'
       where id = st;
      r_style := 'NOT refused';
    exception when others then
      r_style := case when sqlerrm like '%is locked%' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    begin
      update public.garment_order_amendments set po_no = coalesce(po_no, '') || ' 0577' where id = x;
      r_parent := 'NOT refused';
    exception when others then
      r_parent := case when sqlerrm like '%is locked%' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    raise exception '0577_ROLLBACK';
  exception when others then
    if sqlerrm <> '0577_ROLLBACK' then
      raise;
    end if;
  end;

  if r_style <> 'refused' then
    raise exception '0577: a style row of an approved RE was %', r_style;
  end if;
  if r_parent <> 'refused' then
    raise exception '0577: the order row of an approved RE was %', r_parent;
  end if;
end $verify$;
