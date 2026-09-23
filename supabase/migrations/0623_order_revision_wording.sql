-- ============================================================================
-- Raagam ERP — 0623 "Order Revision": the operator's word for an amendment
--
-- Client (record-1790138281276.wav, user 2026-09-23): "Order Revision" and
-- "Order Amendment" mean the same thing; use whichever reads clearest. The
-- screens now say REVISION everywhere an operator reads it. LABELS ONLY:
-- tables, functions, routes and the AMD/26-27/0001 numbering are unchanged, so
-- every link and every entry already raised keeps working.
--
-- The two sentences the DATABASE raises are what an operator reads when a save
-- is refused, so they follow the screens:
--   - the lock sentence (`order_lock_message`) — its TS twin
--     `orderLockMessage` and `scripts/check-budget-amendment.mts` change with it;
--   - the out-of-scope refusal (`order_amendment_refusal`) — its TS twin is
--     `outOfScopeMessage`.
-- ============================================================================

create or replace function public.order_lock_message(p_order uuid, p_sales_order uuid default null)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select
    'Selected budget has been approved'
    || case when nullif(btrim(l.re_no), '') is not null
            then ' — RE ' || btrim(l.re_no) else '' end
    || case when nullif(btrim(l.budget_code), '') is not null
            then case when nullif(btrim(l.re_no), '') is not null then ', ' else ' — ' end
                 || 'budget ' || btrim(l.budget_code)
            else '' end
    || case when l.approved_at is not null
            then case when nullif(btrim(l.re_no), '') is not null
                        or nullif(btrim(l.budget_code), '') is not null
                      then ', ' else ' — ' end
                 || 'approved on ' || to_char(l.approved_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY')
            else '' end
    || '. Direct edits are disabled. Raise an Order Revision to change it.'
  from public.order_lock_of(p_order, p_sales_order) l;
$function$;

create or replace function public.order_amendment_refusal(
  p_entry_no text,
  p_label    text,
  p_scope    jsonb,
  p_table    name,
  p_op       text,
  p_changed  text[]
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_t       jsonb := p_scope -> p_table::text;
  v_cols    text[];
  v_outside text[];
  v_head    text;
begin
  v_head := 'This revision (' || coalesce(nullif(btrim(p_entry_no), ''), 'open') || ') covers '
            || coalesce(nullif(btrim(p_label), ''), 'other changes') || ' — ';

  if v_t is null then
    return v_head || public.order_amendment_area_label(p_table)
           || ' is not open to it. Use + Add module on the revision to open it.';
  end if;

  if p_op = 'INSERT' then
    if coalesce((v_t ->> 'insert')::boolean, false) then return null; end if;
    return v_head || 'a new ' || public.order_amendment_area_label(p_table)
           || ' row cannot be added under it.';
  elsif p_op = 'DELETE' then
    if coalesce((v_t ->> 'delete')::boolean, false) then return null; end if;
    return v_head || 'a ' || public.order_amendment_area_label(p_table)
           || ' row cannot be removed under it.';
  end if;

  if v_t -> 'columns' is null or jsonb_typeof(v_t -> 'columns') = 'null' then return null; end if;
  select array_agg(x) into v_cols from jsonb_array_elements_text(v_t -> 'columns') x;
  select array_agg(c order by c) into v_outside
    from unnest(coalesce(p_changed, array[]::text[])) c
   where not (c = any(coalesce(v_cols, array[]::text[])));
  if v_outside is null then return null; end if;

  return v_head || array_to_string(v_outside, ', ')
         || case when array_length(v_outside, 1) = 1 then ' is' else ' are' end
         || ' not open to it. Only ' || array_to_string(v_cols, ', ')
         || ' can be changed on ' || public.order_amendment_area_label(p_table) || '.';
end;
$function$;

revoke all on function public.order_lock_message(uuid, uuid) from public, anon;
revoke all on function public.order_amendment_refusal(text, text, jsonb, name, text, text[]) from public, anon;
grant execute on function public.order_lock_message(uuid, uuid) to authenticated;
grant execute on function public.order_amendment_refusal(text, text, jsonb, name, text, text[]) to authenticated;

do $verify$
begin
  if public.order_amendment_refusal('AMD/26-27/0009', 'Quantity Addition', '{}'::jsonb, 'order_fabric_boms', 'UPDATE', array['remark'])
     not like 'This revision (AMD/26-27/0009) covers Quantity Addition — the Fabric BOM is not open to it.%' then
    raise exception '0623: the refusal sentence did not change';
  end if;
  raise notice '0623: verified — revision wording';
end
$verify$;
